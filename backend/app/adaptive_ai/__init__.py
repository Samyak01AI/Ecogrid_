"""
EcoGrid AI 2.0 — Grok-Powered Terrain-Adaptive AI Decision Engine
"""
from app.adaptive_ai.feature_registry import feature_registry
from app.adaptive_ai.formula_registry import formula_registry
from app.adaptive_ai.model_registry import model_registry
from app.adaptive_ai.strategy_engine import adaptive_strategy_engine
from app.adaptive_ai.strategy_schemas import (
    AdaptiveComparisonResult,
    AdaptiveOptimizationRequest,
    ProposedStrategy,
    SharedEvaluationMetrics,
    StrategyRecommendationRequest,
    StrategyValidationError,
    TerrainProfile,
    TerrainType,
    ValidatedStrategy,
    ValidationStatus,
)
from app.adaptive_ai.strategy_validator import StrategyValidator
from app.adaptive_ai.terrain_profiles import characterize_terrain, get_baseline_strategy_for_terrain

__all__ = [
    "feature_registry",
    "formula_registry",
    "model_registry",
    "adaptive_strategy_engine",
    "StrategyValidator",
    "characterize_terrain",
    "get_baseline_strategy_for_terrain",
    "TerrainType",
    "TerrainProfile",
    "ProposedStrategy",
    "ValidatedStrategy",
    "ValidationStatus",
    "StrategyValidationError",
    "StrategyRecommendationRequest",
    "AdaptiveOptimizationRequest",
    "AdaptiveComparisonResult",
    "SharedEvaluationMetrics",
]
