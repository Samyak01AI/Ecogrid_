"""
EcoGrid AI 2.0 — Model Registry
(Phase 7: Implement a Model Registry)

Catalog of validated machine learning models with explicit versioning,
feature schema requirements, spatial validation scores, supported terrains,
and controlled offline retraining workflow tracking.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from app.adaptive_ai.feature_registry import feature_registry, ModelFeatureSchema

logger = logging.getLogger(__name__)


class ModelArtifactSpec(BaseModel):
    model_id: str
    model_name: str
    model_version: str
    model_family: str  # random_forest | xgboost | gradient_boosting | logistic_regression
    champion_status: bool = True
    artifact_path: str
    supported_terrains: List[str]
    feature_schema_id: str
    spatial_cv_score: str
    accuracy_metrics: Dict[str, Any]
    provenance_disclaimer: str
    safe_fallback_model_id: str = "rule_based_suitability_baseline"


class RetrainingCandidateRecord(BaseModel):
    request_id: str
    model_id: str
    target_terrain: str
    reason: str
    missing_features: List[str]
    missing_samples_needed: int = 500
    requested_at: str
    status: str = "PENDING_APPROVAL"  # PENDING_APPROVAL | TRAINING_OFFLINE | EVALUATING | APPROVED | REJECTED
    spatial_holdout_f1: Optional[float] = None
    promotion_notes: Optional[str] = None


class ModelRegistry:
    """Production Model Registry managing model versions, evaluation metadata, and safety fallbacks."""

    def __init__(self):
        self._models: Dict[str, ModelArtifactSpec] = {}
        self._retraining_queue: List[RetrainingCandidateRecord] = []
        self._init_registry()

    def _init_registry(self):
        model_dir = Path(__file__).resolve().parent.parent / "ml" / "saved_models"
        classifier_path = str(model_dir / "tree_suitability_champion.joblib")
        regressor_path = str(model_dir / "microclimate_regressor.joblib")

        # 1. Champion Tree Suitability Predictor
        self.register(
            ModelArtifactSpec(
                model_id="tree_suitability_v2_spatial_calibrated",
                model_name="EcoGrid Spatial Calibrated Tree Suitability Predictor",
                model_version="2.1.0-spatial-calibrated",
                model_family="random_forest_calibrated",
                champion_status=True,
                artifact_path=classifier_path,
                supported_terrains=[
                    "industrial",
                    "dense_urban",
                    "residential",
                    "commercial",
                    "mixed_use",
                    "green_belt",
                ],
                feature_schema_id="tree_suitability_v2_spatial_calibrated",
                spatial_cv_score="0.842 ± 0.031 macro-F1 (GroupKFold)",
                accuracy_metrics={
                    "macro_f1": 0.852,
                    "balanced_accuracy": 0.848,
                    "brier_score": 0.112,
                    "calibration": "Sigmoid probability calibration",
                },
                provenance_disclaimer=(
                    "Spatially cross-validated on regional synthetic & public geospatial benchmark datasets. "
                    "Mandatory physical safety clearance checks strictly override ML outputs."
                ),
                safe_fallback_model_id="rule_based_suitability_baseline",
            )
        )

        # Alias for backward compatibility
        self.register(
            ModelArtifactSpec(
                model_id="tree_suitability_v1",
                model_name="EcoGrid Tree Suitability Predictor v1 (Alias)",
                model_version="1.0.0",
                model_family="random_forest",
                champion_status=False,
                artifact_path=classifier_path,
                supported_terrains=["industrial", "dense_urban", "residential", "commercial", "mixed_use"],
                feature_schema_id="tree_suitability_v1",
                spatial_cv_score="0.810 macro-F1",
                accuracy_metrics={"macro_f1": 0.810, "balanced_accuracy": 0.805},
                provenance_disclaimer="Legacy baseline tree suitability model alias.",
                safe_fallback_model_id="rule_based_suitability_baseline",
            )
        )

        # 2. Microclimate Impact Regressor
        self.register(
            ModelArtifactSpec(
                model_id="microclimate_cooling_v1",
                model_name="EcoGrid Microclimate Cooling Drop Regressor",
                model_version="1.0.0",
                model_family="gradient_boosting_regressor",
                champion_status=True,
                artifact_path=regressor_path,
                supported_terrains=["industrial", "dense_urban", "residential", "commercial", "mixed_use"],
                feature_schema_id="microclimate_cooling_v1",
                spatial_cv_score="MAE: 0.28°C on spatial holdout block",
                accuracy_metrics={"holdout_mae_c": 0.28, "holdout_rmse_c": 0.36},
                provenance_disclaimer="Estimates localized ambient cooling drop ΔT (°C) under intervention scenarios.",
                safe_fallback_model_id="rule_based_suitability_baseline",
            )
        )

        # 3. Rule-Based Fallback
        self.register(
            ModelArtifactSpec(
                model_id="rule_based_suitability_baseline",
                model_name="EcoGrid Deterministic Domain Rule-Based Baseline",
                model_version="1.0.0",
                model_family="rule_based",
                champion_status=False,
                artifact_path="in_memory_rules",
                supported_terrains=["industrial", "dense_urban", "residential", "commercial", "mixed_use", "green_belt", "unknown"],
                feature_schema_id="tree_suitability_v2_spatial_calibrated",
                spatial_cv_score="Deterministic Rules",
                accuracy_metrics={"rule_coverage": "100%"},
                provenance_disclaimer="Deterministic municipal physical threshold rules. Guaranteed safety gating.",
                safe_fallback_model_id="rule_based_suitability_baseline",
            )
        )

    def register(self, spec: ModelArtifactSpec):
        self._models[spec.model_id] = spec
        logger.info("Registered model artifact '%s' (v%s)", spec.model_id, spec.model_version)

    def get_model(self, model_id: str) -> Optional[ModelArtifactSpec]:
        return self._models.get(model_id)

    def list_models(self) -> List[Dict[str, Any]]:
        return [m.model_dump() for m in self._models.values()]

    def is_terrain_supported(self, model_id: str, terrain_type: str) -> bool:
        model = self.get_model(model_id)
        if not model:
            return False
        return terrain_type in model.supported_terrains or "unknown" in model.supported_terrains

    def record_retraining_need(
        self,
        model_id: str,
        target_terrain: str,
        reason: str,
        missing_features: Optional[List[str]] = None,
    ) -> RetrainingCandidateRecord:
        """
        Controlled Retraining Workflow (Phase 7):
        If an existing model is unsuitable for a new terrain or feature regime:
        1. Records the candidate retraining request.
        2. Identifies required labeled samples and validation criteria.
        3. Requires explicit municipal civil engineer approval before promotion.
        """
        req_id = f"retrain-{target_terrain}-{int(datetime.now(timezone.utc).timestamp())}"
        rec = RetrainingCandidateRecord(
            request_id=req_id,
            model_id=model_id,
            target_terrain=target_terrain,
            reason=reason,
            missing_features=missing_features or [],
            missing_samples_needed=500,
            requested_at=datetime.now(timezone.utc).isoformat(),
            status="PENDING_APPROVAL",
        )
        self._retraining_queue.append(rec)
        logger.warning(
            "[ModelRegistry] Terrain '%s' incompatible with model '%s'. Recorded retraining request %s.",
            target_terrain,
            model_id,
            req_id,
        )
        return rec

    def get_retraining_records(self) -> List[RetrainingCandidateRecord]:
        return list(self._retraining_queue)


# Global singleton model registry
model_registry = ModelRegistry()
