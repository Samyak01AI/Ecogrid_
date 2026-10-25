"""
EcoGrid AI 2.0 — Strategy Schemas for Grok-Powered Terrain-Adaptive AI Decision Engine
(Phase 2: Adaptive AI Architecture)
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class TerrainType(str, Enum):
    INDUSTRIAL = "industrial"
    DENSE_URBAN = "dense_urban"
    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    MIXED_USE = "mixed_use"
    GREEN_BELT = "green_belt"
    UNKNOWN = "unknown"


class NaturalTerrainCharacteristics(BaseModel):
    mean_built_surface_ratio: float = Field(0.0, ge=0.0, le=1.0)
    mean_green_space_ratio: float = Field(0.0, ge=0.0, le=1.0)
    mean_available_area_m2: float = Field(0.0, ge=0.0)
    dominant_surface_type: str = "mixed"
    surface_distribution: Dict[str, float] = Field(default_factory=dict)
    has_water_bodies: bool = False
    has_steep_or_restricted_zones: bool = False


class LandUseCharacteristics(BaseModel):
    dominant_land_use: str = "mixed"
    land_use_distribution: Dict[str, float] = Field(default_factory=dict)
    commercial_intensity: float = Field(0.0, ge=0.0, le=1.0)
    industrial_intensity: float = Field(0.0, ge=0.0, le=1.0)
    residential_intensity: float = Field(0.0, ge=0.0, le=1.0)
    civic_or_heritage_intensity: float = Field(0.0, ge=0.0, le=1.0)


class EnvironmentalIndicatorsSummary(BaseModel):
    mean_heat_score: float = Field(0.0, ge=0.0, le=100.0)
    mean_vegetation_deficit: float = Field(0.0, ge=0.0, le=100.0)
    mean_pedestrian_exposure: float = Field(0.0, ge=0.0, le=100.0)
    mean_connectivity_gap: float = Field(0.0, ge=0.0, le=100.0)
    mean_tree_suitability: float = Field(0.0, ge=0.0, le=100.0)
    mean_feasibility_score: float = Field(0.0, ge=0.0, le=100.0)
    high_heat_cells_count: int = 0
    high_exposure_cells_count: int = 0
    statutory_restrictions_count: int = 0


class TerrainProfile(BaseModel):
    study_area_id: str
    study_area_name: str
    terrain_type: TerrainType
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    classification_reason: str
    natural_terrain: NaturalTerrainCharacteristics
    land_use_context: LandUseCharacteristics
    environmental_indicators: EnvironmentalIndicatorsSummary
    detected_constraints: List[str] = Field(default_factory=list)
    dataset_provenance: str = "EMPIRICAL_GIS"
    grid_cells_evaluated: int = 100


class StrategyRecommendationRequest(BaseModel):
    study_area_id: str
    budget: float = Field(1000000.0, ge=10000.0)
    user_priorities: Optional[Dict[str, float]] = None
    focus_objective: Optional[str] = None
    force_fallback: bool = False


class ProposedStrategy(BaseModel):
    strategy_id: str
    strategy_name: str
    strategy_version: str = "1.0"
    terrain_type: TerrainType
    formula_id: str
    priority_weights: Dict[str, float]
    optimization_weights: Dict[str, float]
    model_id: str
    preferred_interventions: List[str] = Field(default_factory=list)
    explanation: str
    data_limitations: List[str] = Field(default_factory=list)


class ValidationStatus(str, Enum):
    VALIDATED = "VALIDATED"
    FALLBACK_APPLIED = "FALLBACK_APPLIED"
    REJECTED = "REJECTED"


class StrategyValidationError(BaseModel):
    field: str
    code: str
    message: str
    invalid_value: Optional[Any] = None


class ValidatedStrategy(BaseModel):
    strategy_id: str
    strategy_name: str
    strategy_version: str = "1.0"
    terrain_type: TerrainType
    formula_id: str
    priority_weights: Dict[str, float]
    optimization_weights: Dict[str, float]
    model_id: str
    model_version: str = "2.1.0"
    preferred_interventions: List[str]
    explanation: str
    validation_status: ValidationStatus
    fallback_applied: bool = False
    fallback_reason: Optional[str] = None
    validation_errors: List[StrategyValidationError] = Field(default_factory=list)
    checked_rules: List[str] = Field(default_factory=list)
    parameter_hash: str = ""
    timestamp: str = ""
    provenance: str = "EcoGrid-AdaptiveAI-Gateway"


class AdaptiveOptimizationRequest(BaseModel):
    study_area_id: str
    budget: float = Field(1000000.0, ge=10000.0)
    mode: str = Field("adaptive", description="'standard' or 'adaptive'")
    custom_strategy: Optional[Dict[str, Any]] = None
    enabled_interventions: Optional[List[str]] = None


class SharedEvaluationMetrics(BaseModel):
    thermal_mitigation_index: float
    canopy_deficit_closed: float
    pedestrian_comfort_benefit: float
    connectivity_improvement: float
    cost_efficiency_ratio: float
    total_interventions_count: int
    cells_improved_count: int
    budget_spent: float
    budget_headroom: float


class AdaptiveComparisonResult(BaseModel):
    study_area_id: str
    study_area_name: str
    terrain_type: TerrainType
    budget: float
    standard_plan: Dict[str, Any]
    adaptive_plan: Dict[str, Any]
    standard_strategy: Dict[str, Any]
    adaptive_strategy: ValidatedStrategy
    standard_metrics: SharedEvaluationMetrics
    adaptive_metrics: SharedEvaluationMetrics
    delta: Dict[str, Any]
    explanation: str
    fairness_disclaimer: str = (
        "Plans are evaluated on identical shared objective metrics in addition to individual optimization priorities. "
        "Neither standard nor adaptive mode is inherently superior; suitability depends on localized urban microclimate objectives."
    )
