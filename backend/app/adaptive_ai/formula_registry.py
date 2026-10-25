"""
EcoGrid AI 2.0 — Mathematical Formula Registry
(Phase 8: Implement a Formula Registry)

Strict registry of verified mathematical scoring formulations.
STRICT SAFETY ENFORCEMENT:
Never evaluate arbitrary strings or expressions via `eval()`, `exec()`, or dynamic interpretation.
All formulas are statically compiled, pure Python functions with bounded normalized inputs.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

from app.schemas.schemas import ScoreSet

logger = logging.getLogger(__name__)


class FormulaDefinition(BaseModel):
    formula_id: str
    name: str
    description: str
    version: str = "1.0"
    required_parameters: List[str]
    parameter_bounds: Dict[str, List[float]]  # [min, max]
    sum_constraint: Optional[float] = 1.0  # None or sum value (e.g. 1.0)
    tolerance: float = 0.005


# ---------------------------------------------------------------------------
# Statically verified mathematical evaluators (No eval() or exec())
# ---------------------------------------------------------------------------

def evaluate_weighted_additive_v1(scores: ScoreSet, params: Dict[str, float]) -> float:
    """
    Standard linear weighted additive scoring:
    S = w_heat * heat + w_veg * veg + w_ped * ped + w_conn * conn
    All scores are normalized in [0, 100]. Returns score in [0, 100].
    """
    w_heat = params.get("heat", 0.30)
    w_veg = params.get("vegetation", 0.25)
    w_ped = params.get("pedestrian", 0.25)
    w_conn = params.get("connectivity", 0.20)

    val = (
        scores.heat_score * w_heat
        + scores.vegetation_deficit * w_veg
        + scores.pedestrian_exposure * w_ped
        + scores.connectivity_gap * w_conn
    )
    return max(0.0, min(100.0, round(val, 1)))


def evaluate_heat_mitigation_priority_v1(scores: ScoreSet, params: Dict[str, float]) -> float:
    """
    Thermal resilience scoring with quadratic heat amplification above 65° critical threshold:
    Reflects municipal heat island urgency when ambient heat is high.
    S_base = sum(w_i * S_i)
    S_heat_boost = S_base * (1.0 + 0.15 * max(0, (heat - 65) / 35))
    """
    base_score = evaluate_weighted_additive_v1(scores, params)
    heat = scores.heat_score
    if heat > 65.0:
        boost = 1.0 + 0.15 * ((heat - 65.0) / 35.0)
        final_score = base_score * boost
    else:
        final_score = base_score
    return max(0.0, min(100.0, round(final_score, 1)))


def evaluate_biodiversity_corridor_v1(scores: ScoreSet, params: Dict[str, float]) -> float:
    """
    Ecological patch-corridor connectivity formulation:
    Amplifies connectivity score when vegetation deficit is co-located with a corridor gap:
    Interaction term = 0.10 * (conn_gap * veg_deficit) / 100
    """
    base_score = evaluate_weighted_additive_v1(scores, params)
    interaction = 0.10 * ((scores.connectivity_gap * scores.vegetation_deficit) / 100.0)
    final_score = base_score + interaction
    return max(0.0, min(100.0, round(final_score, 1)))


def evaluate_pedestrian_comfort_v1(scores: ScoreSet, params: Dict[str, float]) -> float:
    """
    Pedestrian outdoor thermal comfort (Universal Thermal Climate Index proxy):
    Couples pedestrian exposure with heat load:
    Exposure_Heat_Product = w_exposure * ped * (1 + 0.20 * (heat / 100))
    """
    w_heat = params.get("heat", 0.30)
    w_veg = params.get("vegetation", 0.15)
    w_ped = params.get("pedestrian", 0.45)
    w_conn = params.get("connectivity", 0.10)

    # Thermal comfort burden on pedestrians
    ped_thermal_burden = scores.pedestrian_exposure * (1.0 + 0.20 * (scores.heat_score / 100.0))
    # Bound ped_thermal_burden to 100 max for calculation
    ped_term = min(100.0, ped_thermal_burden)

    val = (
        scores.heat_score * w_heat
        + scores.vegetation_deficit * w_veg
        + ped_term * w_ped
        + scores.connectivity_gap * w_conn
    )
    return max(0.0, min(100.0, round(val, 1)))


def evaluate_multi_objective_pareto_v1(scores: ScoreSet, params: Dict[str, float]) -> float:
    """
    Normalized multi-objective composite priority for Pareto scalarization.
    """
    return evaluate_weighted_additive_v1(scores, params)


# ---------------------------------------------------------------------------
# Formula Registry
# ---------------------------------------------------------------------------

class FormulaRegistry:
    """Registry of registered mathematical scoring formulas and dispatchers."""

    def __init__(self):
        self._formulas: Dict[str, FormulaDefinition] = {}
        self._evaluators: Dict[str, Callable[[ScoreSet, Dict[str, float]], float]] = {}
        self._init_defaults()

    def _init_defaults(self):
        # 1. Weighted Additive v1
        self.register(
            FormulaDefinition(
                formula_id="weighted_additive_v1",
                name="Linear Weighted Additive Multi-Benefit Scoring",
                description="Standard linear combination of heat, vegetation deficit, pedestrian exposure, and connectivity need.",
                version="1.0",
                required_parameters=["heat", "vegetation", "pedestrian", "connectivity"],
                parameter_bounds={"heat": [0.0, 1.0], "vegetation": [0.0, 1.0], "pedestrian": [0.0, 1.0], "connectivity": [0.0, 1.0]},
                sum_constraint=1.0,
                tolerance=0.005,
            ),
            evaluate_weighted_additive_v1,
        )

        # 2. Heat Mitigation Priority v1
        self.register(
            FormulaDefinition(
                formula_id="heat_mitigation_priority_v1",
                name="Thermal Resilience & Heat-Amplified Scoring",
                description="Thermal resilience formulation emphasizing critical urban heat island hotspots with non-linear penalty above 65°C index.",
                version="1.0",
                required_parameters=["heat", "vegetation", "pedestrian", "connectivity"],
                parameter_bounds={"heat": [0.0, 1.0], "vegetation": [0.0, 1.0], "pedestrian": [0.0, 1.0], "connectivity": [0.0, 1.0]},
                sum_constraint=1.0,
                tolerance=0.005,
            ),
            evaluate_heat_mitigation_priority_v1,
        )

        # 3. Biodiversity Corridor v1
        self.register(
            FormulaDefinition(
                formula_id="biodiversity_corridor_v1",
                name="Ecological Patch-Corridor Connectivity Scoring",
                description="Ecological connectivity formulation amplifying areas where vegetation gaps intersect ecological stepping stones.",
                version="1.0",
                required_parameters=["heat", "vegetation", "pedestrian", "connectivity"],
                parameter_bounds={"heat": [0.0, 1.0], "vegetation": [0.0, 1.0], "pedestrian": [0.0, 1.0], "connectivity": [0.0, 1.0]},
                sum_constraint=1.0,
                tolerance=0.005,
            ),
            evaluate_biodiversity_corridor_v1,
        )

        # 4. Pedestrian Comfort v1
        self.register(
            FormulaDefinition(
                formula_id="pedestrian_comfort_v1",
                name="Pedestrian Microclimate Exposure & Comfort Scoring",
                description="Pedestrian comfort formulation evaluating outdoor thermal stress along transit nodes and active pedestrian sidewalks.",
                version="1.0",
                required_parameters=["heat", "vegetation", "pedestrian", "connectivity"],
                parameter_bounds={"heat": [0.0, 1.0], "vegetation": [0.0, 1.0], "pedestrian": [0.0, 1.0], "connectivity": [0.0, 1.0]},
                sum_constraint=1.0,
                tolerance=0.005,
            ),
            evaluate_pedestrian_comfort_v1,
        )

        # 5. Multi-Objective Pareto v1
        self.register(
            FormulaDefinition(
                formula_id="multi_objective_pareto_v1",
                name="Multi-Objective Pareto Scalarization Scoring",
                description="Scalarized multi-objective objective weighting for NSGA-II frontier exploration.",
                version="1.0",
                required_parameters=["heat", "vegetation", "pedestrian", "connectivity"],
                parameter_bounds={"heat": [0.0, 1.0], "vegetation": [0.0, 1.0], "pedestrian": [0.0, 1.0], "connectivity": [0.0, 1.0]},
                sum_constraint=1.0,
                tolerance=0.005,
            ),
            evaluate_multi_objective_pareto_v1,
        )

    def register(
        self,
        defn: FormulaDefinition,
        evaluator_fn: Callable[[ScoreSet, Dict[str, float]], float],
    ):
        self._formulas[defn.formula_id] = defn
        self._evaluators[defn.formula_id] = evaluator_fn
        logger.info("Registered formula '%s' (v%s)", defn.formula_id, defn.version)

    def get_formula(self, formula_id: str) -> Optional[FormulaDefinition]:
        return self._formulas.get(formula_id)

    def list_formulas(self) -> List[Dict[str, Any]]:
        return [f.model_dump() for f in self._formulas.values()]

    def evaluate(self, formula_id: str, scores: ScoreSet, params: Dict[str, float]) -> float:
        """
        Safely dispatches to the statically verified Python evaluator function.
        Never calls eval() or exec().
        """
        evaluator = self._evaluators.get(formula_id)
        if not evaluator:
            # Fall back to weighted additive if unregistered
            logger.warning("Unregistered formula '%s'; falling back to weighted_additive_v1", formula_id)
            return evaluate_weighted_additive_v1(scores, params)
        return evaluator(scores, params)


# Global singleton formula registry
formula_registry = FormulaRegistry()
