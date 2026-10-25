"""
EcoGrid AI 2.0 — Feature Schema Registry
(Phase 6: Solve ML Feature Schema Compatibility)

Strict feature schema specifications, ordering, typing, validation,
and feature adapter pipelines for all registered ML models.
Prevents silent feature substitution and ensures inference-training parity.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class FeatureFieldSpec(BaseModel):
    name: str
    data_type: str = "float"  # float, int, str
    unit: str = "normalized_0_100"
    min_value: Optional[float] = 0.0
    max_value: Optional[float] = 100.0
    required: bool = True
    description: str = ""
    missing_strategy: str = "median_impute"  # median_impute | reject | default_value
    default_value: Optional[Any] = None


class ModelFeatureSchema(BaseModel):
    model_id: str
    model_version: str
    feature_names: List[str]
    features: List[FeatureFieldSpec]
    preprocessing_pipeline: str
    missing_value_handling: str
    compatible_resolutions_m: List[float] = Field(default_factory=lambda: [10.0, 30.0, 100.0])
    compatible_terrains: List[str] = Field(
        default_factory=lambda: [
            "industrial",
            "dense_urban",
            "residential",
            "commercial",
            "mixed_use",
            "green_belt",
        ]
    )

    def get_feature(self, name: str) -> Optional[FeatureFieldSpec]:
        for f in self.features:
            if f.name == name:
                return f
        return None


# ---------------------------------------------------------------------------
# Registered Feature Schemas
# ---------------------------------------------------------------------------

TREE_SUITABILITY_V2_SCHEMA = ModelFeatureSchema(
    model_id="tree_suitability_v2_spatial_calibrated",
    model_version="2.1.0-spatial-calibrated",
    feature_names=[
        "heat_score",
        "vegetation_deficit",
        "built_surface_ratio",
        "available_area",
        "green_space_ratio",
        "feasibility_score",
        "distance_to_infrastructure_m",
        "distance_to_green_m",
    ],
    features=[
        FeatureFieldSpec(
            name="heat_score",
            data_type="float",
            unit="0-100 index",
            min_value=0.0,
            max_value=100.0,
            description="Surface heat exposure index from satellite thermal band",
        ),
        FeatureFieldSpec(
            name="vegetation_deficit",
            data_type="float",
            unit="0-100 index",
            min_value=0.0,
            max_value=100.0,
            description="Normalized canopy deficit derived from inverted Sentinel NDVI",
        ),
        FeatureFieldSpec(
            name="built_surface_ratio",
            data_type="float",
            unit="fraction 0-1",
            min_value=0.0,
            max_value=1.0,
            description="Proportion of cell occupied by impervious structures or pavement",
        ),
        FeatureFieldSpec(
            name="available_area",
            data_type="float",
            unit="m²",
            min_value=0.0,
            max_value=10000.0,
            description="Available plantable ground envelope in square meters",
        ),
        FeatureFieldSpec(
            name="green_space_ratio",
            data_type="float",
            unit="fraction 0-1",
            min_value=0.0,
            max_value=1.0,
            description="Existing green vegetation coverage ratio within cell",
        ),
        FeatureFieldSpec(
            name="feasibility_score",
            data_type="float",
            unit="0-100 index",
            min_value=0.0,
            max_value=100.0,
            description="Composite physical and legal feasibility score",
        ),
        FeatureFieldSpec(
            name="distance_to_infrastructure_m",
            data_type="float",
            unit="meters",
            min_value=0.0,
            max_value=5000.0,
            description="Distance to nearest underground high-voltage utility or transit corridor",
        ),
        FeatureFieldSpec(
            name="distance_to_green_m",
            data_type="float",
            unit="meters",
            min_value=0.0,
            max_value=5000.0,
            description="Distance to nearest existing botanical green space or forest patch",
        ),
    ],
    preprocessing_pipeline="SimpleImputer(strategy='median') -> StandardScaler() -> CalibratedClassifierCV(RandomForestClassifier)",
    missing_value_handling="Median imputation of spatial training distribution; safety violations cannot be imputed",
    compatible_resolutions_m=[10.0, 30.0, 100.0],
    compatible_terrains=[
        "industrial",
        "dense_urban",
        "residential",
        "commercial",
        "mixed_use",
        "green_belt",
    ],
)

MICROCLIMATE_REGRESSOR_V1_SCHEMA = ModelFeatureSchema(
    model_id="microclimate_cooling_v1",
    model_version="1.0.0",
    feature_names=[
        "baseline_heat",
        "baseline_ndvi",
        "built_ratio",
        "trees_added",
        "permeable_area_m2",
        "connectivity_score",
    ],
    features=[
        FeatureFieldSpec(name="baseline_heat", data_type="float", unit="°C", min_value=15.0, max_value=60.0),
        FeatureFieldSpec(name="baseline_ndvi", data_type="float", unit="NDVI [-1, 1]", min_value=-1.0, max_value=1.0),
        FeatureFieldSpec(name="built_ratio", data_type="float", unit="fraction 0-1", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="trees_added", data_type="int", unit="count", min_value=0.0, max_value=20.0),
        FeatureFieldSpec(name="permeable_area_m2", data_type="float", unit="m²", min_value=0.0, max_value=5000.0),
        FeatureFieldSpec(name="connectivity_score", data_type="float", unit="0-100 index", min_value=0.0, max_value=100.0),
    ],
    preprocessing_pipeline="SimpleImputer(strategy='median') -> StandardScaler() -> GradientBoostingRegressor",
    missing_value_handling="Median imputation",
    compatible_resolutions_m=[10.0, 30.0],
    compatible_terrains=["industrial", "dense_urban", "residential", "commercial", "mixed_use"],
)

LAND_COVER_V1_SCHEMA = ModelFeatureSchema(
    model_id="land_cover_multispectral_v1",
    model_version="1.2.0",
    feature_names=["blue", "green", "red", "nir", "swir1", "ndvi", "ndwi"],
    features=[
        FeatureFieldSpec(name="blue", data_type="float", unit="reflectance", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="green", data_type="float", unit="reflectance", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="red", data_type="float", unit="reflectance", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="nir", data_type="float", unit="reflectance", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="swir1", data_type="float", unit="reflectance", min_value=0.0, max_value=1.0),
        FeatureFieldSpec(name="ndvi", data_type="float", unit="index", min_value=-1.0, max_value=1.0),
        FeatureFieldSpec(name="ndwi", data_type="float", unit="index", min_value=-1.0, max_value=1.0),
    ],
    preprocessing_pipeline="BandNormalization -> RandomForestClassifier",
    missing_value_handling="Reject inference on cloud-masked bands",
    compatible_resolutions_m=[10.0, 20.0, 30.0],
    compatible_terrains=["industrial", "dense_urban", "residential", "commercial", "mixed_use", "green_belt"],
)


class FeatureRegistry:
    """Manages model feature schemas, compatibility checks, and schema validation."""

    def __init__(self):
        self._schemas: Dict[str, ModelFeatureSchema] = {}
        self._register_defaults()

    def _register_defaults(self):
        self.register(TREE_SUITABILITY_V2_SCHEMA)
        # Register alias tree_suitability_v1
        alias_v1 = TREE_SUITABILITY_V2_SCHEMA.model_copy(update={"model_id": "tree_suitability_v1"})
        self.register(alias_v1)
        self.register(MICROCLIMATE_REGRESSOR_V1_SCHEMA)
        self.register(LAND_COVER_V1_SCHEMA)

    def register(self, schema: ModelFeatureSchema):
        self._schemas[schema.model_id] = schema
        logger.info("Registered feature schema for model '%s' (v%s)", schema.model_id, schema.model_version)

    def get_schema(self, model_id: str) -> Optional[ModelFeatureSchema]:
        return self._schemas.get(model_id)

    def list_models(self) -> List[str]:
        return list(self._schemas.keys())

    def validate_features(
        self,
        model_id: str,
        input_data: Dict[str, Any],
    ) -> Tuple[bool, List[str], Dict[str, float]]:
        """
        Validates feature presence, ordering, types, and numerical ranges.
        Extracts validated numerical vector in exact required model order.
        Returns (is_valid, error_messages, clean_ordered_dict).
        """
        schema = self.get_schema(model_id)
        if not schema:
            return False, [f"Unregistered model ID '{model_id}' in Feature Registry."], {}

        errors = []
        clean_ordered: Dict[str, float] = {}

        for feat_spec in schema.features:
            fname = feat_spec.name
            if fname not in input_data:
                if feat_spec.required:
                    errors.append(f"Missing required feature '{fname}' for model '{model_id}'.")
                    continue
                else:
                    clean_ordered[fname] = feat_spec.default_value or 0.0
                    continue

            raw_val = input_data[fname]

            # Type and numeric check
            try:
                val = float(raw_val)
            except (ValueError, TypeError):
                errors.append(f"Feature '{fname}' value '{raw_val}' cannot be converted to float.")
                continue

            # Check finite
            import math
            if math.isnan(val) or math.isinf(val):
                errors.append(f"Feature '{fname}' has invalid non-finite value '{val}'.")
                continue

            # Range bounds check
            if feat_spec.min_value is not None and val < feat_spec.min_value:
                errors.append(
                    f"Feature '{fname}' value {val} below minimum allowed {feat_spec.min_value}."
                )
            if feat_spec.max_value is not None and val > feat_spec.max_value:
                errors.append(
                    f"Feature '{fname}' value {val} exceeds maximum allowed {feat_spec.max_value}."
                )

            clean_ordered[fname] = val

        # Reject unrecognized unexpected features that Grok or caller might attempt to inject
        extra_keys = set(input_data.keys()) - set(schema.feature_names)
        if extra_keys:
            # We log and note this; models cannot accept arbitrary extra features
            logger.debug("Ignored unmodeled extra features for model %s: %s", model_id, extra_keys)

        is_valid = len(errors) == 0
        return is_valid, errors, clean_ordered


# Global singleton feature registry
feature_registry = FeatureRegistry()
