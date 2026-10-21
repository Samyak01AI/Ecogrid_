"""
EcoGrid AI — Environmental Scoring Engine

Calculates or derives:
- Heat priority
- Vegetation deficit
- Pedestrian exposure
- Green-space connectivity gap
- Intervention suitability
- Site feasibility

Uses deterministic rules for the baseline prototype.
Thresholds are configurable and assumptions are documented.

All scores use consistent 0-100 normalized scale.
"""
from __future__ import annotations

from app.schemas.schemas import CellResponse, InterventionId, ScoreSet


# ---------------------------------------------------------------------------
# Scoring thresholds (configurable)
# ---------------------------------------------------------------------------
HIGH_HEAT_THRESHOLD = 65.0
HIGH_VEG_DEFICIT_THRESHOLD = 60.0
HIGH_PEDESTRIAN_THRESHOLD = 60.0
HIGH_CONNECTIVITY_GAP_THRESHOLD = 55.0
MIN_FEASIBILITY = 30.0
MIN_TREE_SUITABILITY = 40.0
MIN_AVAILABLE_AREA = 50.0  # m²


def combined_priority(scores: ScoreSet, weights: dict[str, float] | None = None) -> float:
    """
    Calculate combined priority score (0-100) from environmental indicators.
    
    Default weights:
    - Heat: 30%
    - Vegetation deficit: 25%
    - Pedestrian exposure: 25%
    - Connectivity need: 20%
    """
    if weights is None:
        weights = {"heat": 0.30, "vegetation": 0.25, "pedestrian": 0.25, "connectivity": 0.20}

    total = (
        scores.heat_score * weights.get("heat", 0.30)
        + scores.vegetation_deficit * weights.get("vegetation", 0.25)
        + scores.pedestrian_exposure * weights.get("pedestrian", 0.25)
        + scores.connectivity_gap * weights.get("connectivity", 0.20)
    )
    return max(0, min(100, round(total, 1)))


def risk_band(score: float) -> str:
    """Map a 0-100 score to a risk band."""
    if score <= 30:
        return "LOW"
    elif score <= 60:
        return "MODERATE"
    elif score <= 80:
        return "HIGH"
    return "CRITICAL"


# ---------------------------------------------------------------------------
# Intervention suitability scoring
# ---------------------------------------------------------------------------

def evaluate_tree_suitability(cell: CellResponse) -> dict:
    """
    Environmental tree suitability evaluation integrating calibrated ML predictions
    with hard physical and safety constraints.
    
    Combines:
    - ML Tree Suitability Prediction (cell.tree_suitability)
    - Heat exposure priority
    - Vegetation deficit
    - Planting envelope area
    - Strict gating: Underground utility and sightline safety
    """
    from app.ml.tree_suitability import evaluate_tree_safety_and_feasibility

    is_safe, violations = evaluate_tree_safety_and_feasibility(cell)
    reasons = []

    if not is_safe:
        return {
            "score": 0.0,
            "reasons": violations,
            "feasible": False,
            "model_status": "ml_safety_override",
            "safety_passed": False,
            "violations": violations,
        }

    score = 0.0
    if cell.scores.heat_score >= HIGH_HEAT_THRESHOLD:
        score += 25
        reasons.append(f"High heat exposure ({cell.scores.heat_score:.0f}/100)")
    elif cell.scores.heat_score >= 45.0:
        score += 15
        reasons.append(f"Moderate heat mitigation need ({cell.scores.heat_score:.0f}/100)")

    if cell.scores.vegetation_deficit >= HIGH_VEG_DEFICIT_THRESHOLD:
        score += 25
        reasons.append(f"High vegetation deficit ({cell.scores.vegetation_deficit:.0f}/100)")
    elif cell.scores.vegetation_deficit >= 40.0:
        score += 15
        reasons.append(f"Vegetation deficit present ({cell.scores.vegetation_deficit:.0f}/100)")

    # Direct integration of ML suitability
    if cell.tree_suitability >= 60.0:
        score += 25
        reasons.append(f"High ML suitability ({cell.tree_suitability:.0f}/100)")
    elif cell.tree_suitability >= MIN_TREE_SUITABILITY:
        score += 20
        reasons.append(f"Good tree suitability ({cell.tree_suitability:.0f}/100)")

    if cell.available_area >= MIN_AVAILABLE_AREA:
        score += 15
        reasons.append(f"Adequate planting area ({cell.available_area:.0f} m²)")
    elif cell.available_area >= 20.0:
        score += 10
        reasons.append(f"Viable planting space ({cell.available_area:.0f} m²)")

    if cell.scores.feasibility_score >= MIN_FEASIBILITY:
        score += 10
        reasons.append(f"Feasible site ({cell.scores.feasibility_score:.0f}/100)")

    final_score = min(100.0, score)
    return {
        "score": final_score,
        "reasons": reasons,
        "feasible": final_score >= 40.0 and cell.tree_suitability >= 30.0,
        "model_status": "ml_validated",
        "safety_passed": True,
        "violations": [],
    }


def evaluate_pollinator_strip(cell: CellResponse) -> dict:
    """
    Connectivity Gap + Suitable Corridor Geometry + Biodiversity Priority
    = Strong Pollinator Strip Candidate
    """
    reasons = []
    score = 0.0

    if cell.scores.connectivity_gap >= HIGH_CONNECTIVITY_GAP_THRESHOLD:
        score += 30
        reasons.append(f"High connectivity gap ({cell.scores.connectivity_gap:.0f}/100)")
    if cell.scores.vegetation_deficit >= 45:
        score += 20
        reasons.append("Corridor needs vegetation")
    if cell.available_area >= 30:
        score += 20
        reasons.append(f"Available strip area ({cell.available_area:.0f} m²)")
    if cell.scores.feasibility_score >= MIN_FEASIBILITY:
        score += 15
        reasons.append("Site feasibility OK")
    if cell.green_space_ratio < 0.4:
        score += 15
        reasons.append("Low existing green cover — high biodiversity opportunity")

    return {"score": min(100, score), "reasons": reasons, "feasible": score >= 35}


def evaluate_shade_structure(cell: CellResponse) -> dict:
    """
    High Pedestrian Exposure + Limited Planting Suitability
    = Potential Shade Structure Candidate
    """
    reasons = []
    score = 0.0

    if cell.scores.pedestrian_exposure >= HIGH_PEDESTRIAN_THRESHOLD:
        score += 35
        reasons.append(f"High pedestrian exposure ({cell.scores.pedestrian_exposure:.0f}/100)")
    if cell.scores.heat_score >= HIGH_HEAT_THRESHOLD:
        score += 25
        reasons.append(f"High heat load ({cell.scores.heat_score:.0f}/100)")
    if cell.tree_suitability < MIN_TREE_SUITABILITY:
        score += 20
        reasons.append("Limited tree planting suitability — shade structure viable")
    if cell.scores.feasibility_score >= 40:
        score += 10
        reasons.append("Adequate structural feasibility")
    if cell.capacity >= 1:
        score += 10
        reasons.append("Installation capacity available")

    return {"score": min(100, score), "reasons": reasons, "feasible": score >= 35}


def evaluate_cool_surface(cell: CellResponse) -> dict:
    """
    High Thermal Load + Suitable Paved Surface
    = Potential Cool Surface Candidate
    """
    reasons = []
    score = 0.0

    if cell.scores.heat_score >= HIGH_HEAT_THRESHOLD:
        score += 35
        reasons.append(f"High thermal load ({cell.scores.heat_score:.0f}/100)")
    if cell.surface_type.value in ["paved", "mixed"]:
        score += 30
        reasons.append(f"Paved/mixed surface suitable for reflective treatment")
    if cell.built_surface_ratio >= 0.4:
        score += 15
        reasons.append(f"High built surface ratio ({cell.built_surface_ratio:.1%})")
    if cell.scores.pedestrian_exposure >= 40:
        score += 10
        reasons.append("Pedestrian benefit from cooler surface")
    if cell.scores.feasibility_score >= 50:
        score += 10
        reasons.append("Site feasibility adequate")

    return {"score": min(100, score), "reasons": reasons, "feasible": score >= 40}


def evaluate_green_buffer(cell: CellResponse) -> dict:
    """Evaluate suitability for a street-edge green buffer."""
    reasons = []
    score = 0.0

    if cell.land_use.value in ["road", "parking", "pedestrian_zone"]:
        score += 25
        reasons.append(f"Road-adjacent land use ({cell.land_use.value})")
    if cell.scores.heat_score >= 50:
        score += 20
        reasons.append("Elevated heat exposure")
    if cell.scores.vegetation_deficit >= 50:
        score += 20
        reasons.append("Vegetation deficit present")
    if cell.available_area >= 20:
        score += 15
        reasons.append(f"Buffer area available ({cell.available_area:.0f} m²)")
    if cell.scores.feasibility_score >= MIN_FEASIBILITY:
        score += 10
        reasons.append("Feasibility check passed")
    if cell.scores.pedestrian_exposure >= 40:
        score += 10
        reasons.append("Pedestrian comfort benefit")

    return {"score": min(100, score), "reasons": reasons, "feasible": score >= 30}


def evaluate_pocket_green(cell: CellResponse) -> dict:
    """Evaluate suitability for a pocket/micro green space."""
    reasons = []
    score = 0.0

    if cell.green_space_ratio < 0.3:
        score += 25
        reasons.append(f"Low existing green cover ({cell.green_space_ratio:.1%})")
    if cell.scores.vegetation_deficit >= 55:
        score += 20
        reasons.append("Significant vegetation deficit")
    if cell.available_area >= 40:
        score += 20
        reasons.append(f"Area suitable for pocket park ({cell.available_area:.0f} m²)")
    if cell.scores.connectivity_gap >= 45:
        score += 15
        reasons.append("Would improve green connectivity")
    if cell.scores.feasibility_score >= MIN_FEASIBILITY:
        score += 10
        reasons.append("Feasibility adequate")
    if cell.scores.heat_score >= 50:
        score += 10
        reasons.append("Heat mitigation co-benefit")

    return {"score": min(100, score), "reasons": reasons, "feasible": score >= 30}


SUITABILITY_EVALUATORS = {
    InterventionId.NATIVE_TREES: evaluate_tree_suitability,
    InterventionId.POLLINATOR_STRIP: evaluate_pollinator_strip,
    InterventionId.SHADE_STRUCTURE: evaluate_shade_structure,
    InterventionId.COOL_SURFACE: evaluate_cool_surface,
    InterventionId.GREEN_BUFFER: evaluate_green_buffer,
    InterventionId.POCKET_GREEN: evaluate_pocket_green,
}


def evaluate_all_interventions(cell: CellResponse) -> dict[str, dict]:
    """Evaluate all intervention types for a given cell."""
    results = {}
    for intervention_id, evaluator in SUITABILITY_EVALUATORS.items():
        results[intervention_id.value] = evaluator(cell)
    return results
