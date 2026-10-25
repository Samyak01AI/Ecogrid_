"""
EcoGrid AI 2.0 — Adaptive AI Strategy Engine
(Phase 4, 10, 11, 14: Grok Strategy Recommendation, Scoring, Optimization, and Comparison)

Orchestrates:
1. Geographic feature extraction & terrain profiling
2. Grok structured AI strategy proposal generation
3. Mathematical validation gateway enforcement
4. Compatible ML model inference & adaptive scoring
5. Constrained OR-Tools CP-SAT optimization
6. Standard vs AI-Adaptive comparison with shared evaluation metrics
7. Input-sensitive caching and versioning
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from app.adaptive_ai.formula_registry import formula_registry
from app.adaptive_ai.model_registry import model_registry
from app.adaptive_ai.strategy_schemas import (
    AdaptiveComparisonResult,
    ProposedStrategy,
    SharedEvaluationMetrics,
    StrategyValidationError,
    TerrainProfile,
    TerrainType,
    ValidatedStrategy,
    ValidationStatus,
)
from app.adaptive_ai.strategy_validator import StrategyValidator
from app.adaptive_ai.terrain_profiles import (
    BASELINE_STRATEGIES,
    characterize_terrain,
    get_baseline_strategy_for_terrain,
)
from app.optimization.optimizer import optimize_plan, _generate_candidates
from app.optimization.validator import validate_plan_constraints
from app.schemas.schemas import (
    CandidateIntervention,
    CellResponse,
    InterventionId,
    OptimizeResponse,
    ScoreSet,
    ScoreWeights,
)
from app.services.grok_pool import grok_pool
from app.services.interventions import INTERVENTIONS

logger = logging.getLogger(__name__)

# In-memory execution cache for reproducibility (Phase 14)
_strategy_cache: Dict[str, ValidatedStrategy] = {}
_comparison_cache: Dict[str, AdaptiveComparisonResult] = {}


class AdaptiveStrategyEngine:
    """Core terrain-adaptive decision engine uniting Grok, ML models, and OR-Tools CP-SAT."""

    @staticmethod
    def _make_strategy_cache_key(
        study_area_id: str,
        budget: float,
        user_priorities: Optional[Dict[str, float]],
        focus_objective: Optional[str],
    ) -> str:
        payload = {
            "study_area_id": study_area_id,
            "budget": round(budget, 2),
            "user_priorities": user_priorities or {},
            "focus_objective": focus_objective or "balanced",
            "version": "2.0.0",
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()

    async def recommend_strategy(
        self,
        cells: List[CellResponse],
        study_area_id: str,
        study_area_name: str,
        budget: float = 1000000.0,
        user_priorities: Optional[Dict[str, float]] = None,
        focus_objective: Optional[str] = None,
        force_fallback: bool = False,
    ) -> ValidatedStrategy:
        """
        Extracts GIS features, characterizes terrain, invokes Grok API via multi-key pool,
        and runs proposal through the strict Mathematical Validation Gateway.
        """
        # Step 1: Characterize terrain using actual empirical GIS features
        terrain = characterize_terrain(cells, study_area_id, study_area_name)

        # Check cache if not forced
        cache_key = self._make_strategy_cache_key(study_area_id, budget, user_priorities, focus_objective)
        if not force_fallback and cache_key in _strategy_cache:
            logger.info("Serving validated adaptive strategy from cache for study area '%s'", study_area_id)
            return _strategy_cache[cache_key]

        if force_fallback:
            baseline_proposal = get_baseline_strategy_for_terrain(terrain.terrain_type)
            validated = StrategyValidator.validate_proposal(baseline_proposal, terrain, budget)
            _strategy_cache[cache_key] = validated
            return validated

        # Step 2: Build structured context for Grok
        registered_models = model_registry.list_models()
        registered_formulas = formula_registry.list_formulas()
        allowed_interventions = [i.intervention_id.value for i in INTERVENTIONS]
        baseline_for_terrain = get_baseline_strategy_for_terrain(terrain.terrain_type)

        system_prompt = (
            "You are EcoGrid AI Strategy Engine — an expert urban microclimate planner, municipal civil engineer, "
            "and mathematical optimization specialist. Your role is to recommend a tailored, location-aware environmental "
            "planning strategy based on empirical GIS indicators.\n\n"
            "CRITICAL OPERATIONAL RULES:\n"
            "1. Output ONLY a valid JSON object matching the exact schema requested. Do not include introductory text, markdown code fence blocks outside of json, or code execution.\n"
            "2. Weights MUST be numeric, positive, and finite. Priority weights MUST sum to 1.000 (tolerance ±0.005).\n"
            "3. Optimization weights (w_heat, w_biodiversity, w_connectivity, w_greenery, w_pedestrian) MUST sum to 100.0.\n"
            "4. Only select from the registered formula IDs and registered model IDs provided in the context.\n"
            "5. Only recommend intervention IDs registered in the EcoGrid catalog.\n"
            "6. You cannot modify trained model weights or alter the municipal budget.\n"
        )

        user_content = {
            "study_area": {
                "id": study_area_id,
                "name": study_area_name,
                "classified_terrain": terrain.terrain_type.value,
                "confidence": terrain.confidence,
                "reason": terrain.classification_reason,
            },
            "environmental_indicators": terrain.environmental_indicators.model_dump(),
            "natural_terrain": terrain.natural_terrain.model_dump(),
            "land_use_context": terrain.land_use_context.model_dump(),
            "detected_constraints": terrain.detected_constraints,
            "budget_inr": budget,
            "user_priorities": user_priorities or {},
            "focus_objective": focus_objective or "balanced",
            "registered_formulas": [
                {"id": f["formula_id"], "name": f["name"], "params": f["required_parameters"]}
                for f in registered_formulas
            ],
            "registered_models": [
                {"id": m["model_id"], "version": m["model_version"], "supported_terrains": m["supported_terrains"]}
                for m in registered_models
            ],
            "allowed_interventions": allowed_interventions,
            "default_baseline_weights": {
                "priority_weights": baseline_for_terrain.priority_weights,
                "optimization_weights": baseline_for_terrain.optimization_weights,
                "formula_id": baseline_for_terrain.formula_id,
                "model_id": baseline_for_terrain.model_id,
            },
            "required_json_format": {
                "strategy_id": "string",
                "strategy_name": "string",
                "strategy_version": "1.0",
                "terrain_type": terrain.terrain_type.value,
                "formula_id": baseline_for_terrain.formula_id,
                "priority_weights": {
                    "heat": 0.40,
                    "vegetation": 0.25,
                    "pedestrian": 0.20,
                    "connectivity": 0.15,
                },
                "optimization_weights": {
                    "w_heat": 40.0,
                    "w_biodiversity": 15.0,
                    "w_connectivity": 15.0,
                    "w_greenery": 15.0,
                    "w_pedestrian": 15.0,
                },
                "model_id": "tree_suitability_v2_spatial_calibrated",
                "preferred_interventions": ["native_trees", "cool_surface", "green_buffer"],
                "explanation": "Detailed professional rationale grounded in the above indicators.",
                "data_limitations": ["Sensor ground-truthing required prior to civil construction"],
            },
        }

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this geographic area and recommend a validated strategy in JSON:\n{json.dumps(user_content, indent=2)}"},
        ]

        logger.info(
            "[AdaptiveAI] Requesting Grok recommendation for '%s' (Terrain: %s, Budget: ₹%s)...",
            study_area_name,
            terrain.terrain_type.value,
            f"{budget:,.0f}",
        )

        try:
            completion = await grok_pool.generate_completion(
                messages=messages,
                temperature=0.2,
                max_tokens=900,
                response_format={"type": "json_object"},
            )

            raw_text = completion.get("content", "").strip()
            if not completion.get("success") or not raw_text:
                raise ValueError(completion.get("error") or "Grok pool returned empty completion")

            # Parse JSON
            # Strip markdown fences if present
            if raw_text.startswith("```"):
                lines = raw_text.splitlines()
                raw_text = "\n".join(l for l in lines if not l.startswith("```"))

            parsed_json = json.loads(raw_text)

            # Ensure terrain_type matches enum
            if "terrain_type" in parsed_json:
                try:
                    parsed_json["terrain_type"] = TerrainType(parsed_json["terrain_type"].lower())
                except ValueError:
                    parsed_json["terrain_type"] = terrain.terrain_type
            else:
                parsed_json["terrain_type"] = terrain.terrain_type

            proposal = ProposedStrategy(**parsed_json)

        except Exception as exc:
            logger.warning(
                "[AdaptiveAI] Grok strategy generation failed (%s). Triggering safe baseline fallback.",
                exc,
            )
            # Safe Fallback Proposal
            baseline = get_baseline_strategy_for_terrain(terrain.terrain_type)
            validated_fallback = StrategyValidator.validate_proposal(baseline, terrain, budget)
            validated_fallback.fallback_applied = True
            validated_fallback.fallback_reason = f"Grok API completion unavailable or malformed ({exc})"
            _strategy_cache[cache_key] = validated_fallback
            return validated_fallback

        # Step 3: Strictly validate Grok proposal via Mathematical Validation Gateway
        validated_strategy = StrategyValidator.validate_proposal(proposal, terrain, budget)
        _strategy_cache[cache_key] = validated_strategy
        return validated_strategy

    def calculate_adaptive_priorities(
        self,
        cells: List[CellResponse],
        strategy: ValidatedStrategy,
    ) -> List[Dict[str, Any]]:
        """
        Recalculates cell priority scores using the validated formula and weights.
        Preserves existing fixed-weight scoring as reference.
        """
        results = []
        for c in cells:
            adaptive_score = formula_registry.evaluate(
                formula_id=strategy.formula_id,
                scores=c.scores,
                params=strategy.priority_weights,
            )
            # Existing baseline calculation
            standard_score = formula_registry.evaluate(
                formula_id="weighted_additive_v1",
                scores=c.scores,
                params={"heat": 0.30, "vegetation": 0.25, "pedestrian": 0.25, "connectivity": 0.20},
            )
            results.append({
                "cell_id": c.cell_id,
                "area_name": c.area_name,
                "standard_priority": standard_score,
                "adaptive_priority": adaptive_score,
                "delta": round(adaptive_score - standard_score, 1),
                "formula_used": strategy.formula_id,
            })
        return results

    def run_adaptive_optimization(
        self,
        cells: List[CellResponse],
        strategy: ValidatedStrategy,
        budget: float,
        enabled_interventions: Optional[List[InterventionId]] = None,
        time_limit_seconds: float = 10.0,
    ) -> OptimizeResponse:
        """
        Runs OR-Tools CP-SAT using validated optimization weights.
        Enforces all physical, setback, underground utility, and budget constraints.
        """
        opt_w = strategy.optimization_weights
        weights_obj = ScoreWeights(
            w_heat=opt_w.get("w_heat", 30.0),
            w_biodiversity=opt_w.get("w_biodiversity", 15.0),
            w_connectivity=opt_w.get("w_connectivity", 20.0),
            w_greenery=opt_w.get("w_greenery", 20.0),
            w_pedestrian=opt_w.get("w_pedestrian", 15.0),
        )

        response = optimize_plan(
            cells=cells,
            budget=budget,
            weights=weights_obj,
            enabled_interventions=enabled_interventions,
            time_limit_seconds=time_limit_seconds,
        )

        # Independent constraint revalidation
        validation_report = validate_plan_constraints(
            cells=cells,
            selected=response.selected,
            budget=budget,
        )

        if not validation_report["valid"]:
            logger.error("[AdaptiveOptimizer] Post-optimization constraint violation detected: %s", validation_report["violations"])

        return response

    @staticmethod
    def compute_shared_metrics(
        plan: OptimizeResponse,
        budget: float,
        cells: List[CellResponse],
    ) -> SharedEvaluationMetrics:
        """
        Independent, shared evaluation metrics applied identically to both
        Standard and Adaptive plans to ensure objective, un-skewed comparison.
        """
        selected = plan.selected
        total_spent = sum(c.cost for c in selected)
        headroom = max(0.0, budget - total_spent)

        thermal_sum = sum(c.heat_benefit for c in selected)
        canopy_sum = sum(c.greenery_benefit for c in selected)
        ped_sum = sum(c.pedestrian_benefit for c in selected)
        conn_sum = sum(c.connectivity_benefit for c in selected)

        # Cost efficiency: composite benefit per 10,000 INR
        total_benefit = thermal_sum + canopy_sum + ped_sum + conn_sum
        cost_eff = (total_benefit / max(total_spent, 1000.0)) * 10000.0

        return SharedEvaluationMetrics(
            thermal_mitigation_index=round(thermal_sum, 3),
            canopy_deficit_closed=round(canopy_sum, 3),
            pedestrian_comfort_benefit=round(ped_sum, 3),
            connectivity_improvement=round(conn_sum, 3),
            cost_efficiency_ratio=round(cost_eff, 4),
            total_interventions_count=len(selected),
            cells_improved_count=plan.cells_improved,
            budget_spent=round(total_spent, 2),
            budget_headroom=round(headroom, 2),
        )

    async def compare_standard_vs_adaptive(
        self,
        cells: List[CellResponse],
        study_area_id: str,
        study_area_name: str,
        budget: float = 1000000.0,
        enabled_interventions: Optional[List[InterventionId]] = None,
    ) -> AdaptiveComparisonResult:
        """
        Phase 11: Side-by-side comparison of Standard Baseline vs AI-Adaptive Mode.
        Evaluates both with identical solver constraints, grid, and shared metrics.
        """
        cache_key = f"comp-{study_area_id}-{int(budget)}-{len(enabled_interventions or [])}"
        if cache_key in _comparison_cache:
            return _comparison_cache[cache_key]

        terrain = characterize_terrain(cells, study_area_id, study_area_name)

        # 1. Standard Mode (fixed baseline weights)
        standard_weights = ScoreWeights(
            w_heat=40.0,
            w_biodiversity=5.0,
            w_connectivity=20.0,
            w_greenery=10.0,
            w_pedestrian=25.0,
        )
        standard_plan = optimize_plan(
            cells=cells,
            budget=budget,
            weights=standard_weights,
            enabled_interventions=enabled_interventions,
        )
        standard_metrics = self.compute_shared_metrics(standard_plan, budget, cells)

        # 2. Adaptive Mode (Grok recommended + validated)
        adaptive_strategy = await self.recommend_strategy(
            cells=cells,
            study_area_id=study_area_id,
            study_area_name=study_area_name,
            budget=budget,
        )
        adaptive_plan = self.run_adaptive_optimization(
            cells=cells,
            strategy=adaptive_strategy,
            budget=budget,
            enabled_interventions=enabled_interventions,
        )
        adaptive_metrics = self.compute_shared_metrics(adaptive_plan, budget, cells)

        # 3. Calculate Deltas
        delta = {
            "thermal_mitigation_delta_pct": round(
                ((adaptive_metrics.thermal_mitigation_index - standard_metrics.thermal_mitigation_index)
                / max(standard_metrics.thermal_mitigation_index, 0.001))
                * 100,
                1,
            ),
            "canopy_closed_delta_pct": round(
                ((adaptive_metrics.canopy_deficit_closed - standard_metrics.canopy_deficit_closed)
                / max(standard_metrics.canopy_deficit_closed, 0.001))
                * 100,
                1,
            ),
            "pedestrian_comfort_delta_pct": round(
                ((adaptive_metrics.pedestrian_comfort_benefit - standard_metrics.pedestrian_comfort_benefit)
                / max(standard_metrics.pedestrian_comfort_benefit, 0.001))
                * 100,
                1,
            ),
            "cost_efficiency_delta_pct": round(
                ((adaptive_metrics.cost_efficiency_ratio - standard_metrics.cost_efficiency_ratio)
                / max(standard_metrics.cost_efficiency_ratio, 0.001))
                * 100,
                1,
            ),
            "cells_improved_diff": adaptive_metrics.cells_improved_count - standard_metrics.cells_improved_count,
            "cost_diff_inr": round(adaptive_metrics.budget_spent - standard_metrics.budget_spent, 2),
        }

        # 4. Generate comparison summary
        explanation = (
            f"Comparison for {study_area_name} ({terrain.terrain_type.value} profile):\n"
            f"- Standard Plan allocated {standard_metrics.total_interventions_count} interventions across {standard_metrics.cells_improved_count} cells (₹{standard_metrics.budget_spent:,.0f}).\n"
            f"- AI-Adaptive Plan allocated {adaptive_metrics.total_interventions_count} interventions across {adaptive_metrics.cells_improved_count} cells (₹{adaptive_metrics.budget_spent:,.0f}) using strategy '{adaptive_strategy.strategy_name}'.\n"
            f"- Terrain-adaptive shift achieved {delta['thermal_mitigation_delta_pct']:+.1f}% thermal mitigation delta and {delta['pedestrian_comfort_delta_pct']:+.1f}% pedestrian comfort delta relative to standard baseline."
        )

        result = AdaptiveComparisonResult(
            study_area_id=study_area_id,
            study_area_name=study_area_name,
            terrain_type=terrain.terrain_type,
            budget=budget,
            standard_plan=standard_plan.model_dump(),
            adaptive_plan=adaptive_plan.model_dump(),
            standard_strategy={
                "strategy_id": "standard_fixed_weights",
                "name": "Standard Fixed Municipal Baseline",
                "priority_weights": {"heat": 0.30, "vegetation": 0.25, "pedestrian": 0.25, "connectivity": 0.20},
                "optimization_weights": standard_weights.model_dump(),
                "formula_id": "weighted_additive_v1",
            },
            adaptive_strategy=adaptive_strategy,
            standard_metrics=standard_metrics,
            adaptive_metrics=adaptive_metrics,
            delta=delta,
            explanation=explanation,
        )

        _comparison_cache[cache_key] = result
        return result


# Global singleton instance
adaptive_strategy_engine = AdaptiveStrategyEngine()
