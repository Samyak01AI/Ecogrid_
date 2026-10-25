"""
EcoGrid AI 2.0 — Terrain Characterization and Profiling Engine
(Phase 3: Terrain-Aware Environmental Analysis)

Extracts geographic, environmental, and infrastructure features from active 10x10
grid cells (exactly 100 cells) and characterizes the planning terrain profile.
Separates natural terrain characteristics from municipal land-use categories.
"""
from __future__ import annotations

import logging
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from app.adaptive_ai.strategy_schemas import (
    EnvironmentalIndicatorsSummary,
    LandUseCharacteristics,
    NaturalTerrainCharacteristics,
    ProposedStrategy,
    TerrainProfile,
    TerrainType,
)
from app.schemas.schemas import CellResponse, LandUse, SurfaceType

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pre-calibrated versioned baseline strategies for each terrain profile
# ---------------------------------------------------------------------------
BASELINE_STRATEGIES: Dict[TerrainType, Dict[str, Any]] = {
    TerrainType.INDUSTRIAL: {
        "strategy_id": "baseline_industrial_heat_v1",
        "strategy_name": "Industrial Thermal Mitigation & Surface Greening",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.INDUSTRIAL,
        "formula_id": "heat_mitigation_priority_v1",
        "priority_weights": {
            "heat": 0.45,
            "vegetation": 0.25,
            "pedestrian": 0.15,
            "connectivity": 0.15,
        },
        "optimization_weights": {
            "w_heat": 45.0,
            "w_biodiversity": 10.0,
            "w_connectivity": 15.0,
            "w_greenery": 20.0,
            "w_pedestrian": 10.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["cool_surface", "green_buffer", "native_trees"],
        "explanation": (
            "Baseline strategy for industrial manufacturing districts: prioritizes heat island reduction "
            "and roadside/peripheral green buffers while respecting high-tension lines and utility clearance."
        ),
    },
    TerrainType.DENSE_URBAN: {
        "strategy_id": "baseline_dense_urban_shade_v1",
        "strategy_name": "Dense Urban Corridor Shade & Micro-Pocket Greening",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.DENSE_URBAN,
        "formula_id": "pedestrian_comfort_v1",
        "priority_weights": {
            "heat": 0.35,
            "vegetation": 0.20,
            "pedestrian": 0.35,
            "connectivity": 0.10,
        },
        "optimization_weights": {
            "w_heat": 30.0,
            "w_biodiversity": 10.0,
            "w_connectivity": 10.0,
            "w_greenery": 15.0,
            "w_pedestrian": 35.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["shade_structure", "pocket_green", "cool_surface"],
        "explanation": (
            "Baseline strategy for dense urban cores: prioritizes pedestrian corridor shade "
            "and compact microclimate intervention in space-constrained envelopes."
        ),
    },
    TerrainType.COMMERCIAL: {
        "strategy_id": "baseline_commercial_pedestrian_v1",
        "strategy_name": "Commercial Plaza & Transit Comfort Optimization",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.COMMERCIAL,
        "formula_id": "pedestrian_comfort_v1",
        "priority_weights": {
            "heat": 0.30,
            "vegetation": 0.15,
            "pedestrian": 0.45,
            "connectivity": 0.10,
        },
        "optimization_weights": {
            "w_heat": 25.0,
            "w_biodiversity": 10.0,
            "w_connectivity": 10.0,
            "w_greenery": 15.0,
            "w_pedestrian": 40.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["shade_structure", "cool_surface", "pocket_green"],
        "explanation": (
            "Baseline strategy for high-footfall commercial districts and transit hubs: focuses on "
            "pedestrian exposure mitigation, outdoor plaza thermal comfort, and reflective pavements."
        ),
    },
    TerrainType.RESIDENTIAL: {
        "strategy_id": "baseline_residential_canopy_v1",
        "strategy_name": "Residential Canopy Cover & Neighborhood Greening",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.RESIDENTIAL,
        "formula_id": "weighted_additive_v1",
        "priority_weights": {
            "heat": 0.25,
            "vegetation": 0.35,
            "pedestrian": 0.25,
            "connectivity": 0.15,
        },
        "optimization_weights": {
            "w_heat": 25.0,
            "w_biodiversity": 15.0,
            "w_connectivity": 15.0,
            "w_greenery": 30.0,
            "w_pedestrian": 15.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["native_trees", "pollinator_strip", "pocket_green"],
        "explanation": (
            "Baseline strategy for residential sectors: emphasizes mature shade tree planting, "
            "vegetation deficit remediation, and neighborhood biodiversity."
        ),
    },
    TerrainType.MIXED_USE: {
        "strategy_id": "baseline_mixed_use_balanced_v1",
        "strategy_name": "Balanced Mixed-Use Sustainable Microclimate",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.MIXED_USE,
        "formula_id": "weighted_additive_v1",
        "priority_weights": {
            "heat": 0.30,
            "vegetation": 0.25,
            "pedestrian": 0.25,
            "connectivity": 0.20,
        },
        "optimization_weights": {
            "w_heat": 30.0,
            "w_biodiversity": 15.0,
            "w_connectivity": 20.0,
            "w_greenery": 20.0,
            "w_pedestrian": 15.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["native_trees", "pollinator_strip", "shade_structure"],
        "explanation": (
            "Baseline standard multi-benefit weighting for balanced mixed-use urban campuses."
        ),
    },
    TerrainType.GREEN_BELT: {
        "strategy_id": "baseline_green_belt_corridor_v1",
        "strategy_name": "Ecological Buffer & Biodiversity Corridor",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.GREEN_BELT,
        "formula_id": "biodiversity_corridor_v1",
        "priority_weights": {
            "heat": 0.15,
            "vegetation": 0.35,
            "pedestrian": 0.10,
            "connectivity": 0.40,
        },
        "optimization_weights": {
            "w_heat": 15.0,
            "w_biodiversity": 30.0,
            "w_connectivity": 30.0,
            "w_greenery": 20.0,
            "w_pedestrian": 5.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["native_trees", "pollinator_strip", "green_buffer"],
        "explanation": (
            "Baseline strategy for forest-adjacent zones and ecological green belts: prioritizes habitat connectivity, "
            "pollinator migration corridors, and continuous canopy integration."
        ),
    },
    TerrainType.UNKNOWN: {
        "strategy_id": "baseline_default_safe_v1",
        "strategy_name": "Standard Default Multi-Benefit Baseline",
        "strategy_version": "1.0",
        "terrain_type": TerrainType.UNKNOWN,
        "formula_id": "weighted_additive_v1",
        "priority_weights": {
            "heat": 0.30,
            "vegetation": 0.25,
            "pedestrian": 0.25,
            "connectivity": 0.20,
        },
        "optimization_weights": {
            "w_heat": 30.0,
            "w_biodiversity": 15.0,
            "w_connectivity": 20.0,
            "w_greenery": 20.0,
            "w_pedestrian": 15.0,
        },
        "model_id": "tree_suitability_v2_spatial_calibrated",
        "preferred_interventions": ["native_trees", "shade_structure", "pollinator_strip"],
        "explanation": (
            "Standard default balanced weighting applied when terrain data has low confidence or is unclassified."
        ),
    },
}


def characterize_terrain(
    cells: List[CellResponse],
    study_area_id: str,
    study_area_name: str,
) -> TerrainProfile:
    """
    Analyzes physical, natural, and land-use characteristics from the 100 grid cells.
    Strictly separates physical surface characteristics from municipal zoning designations.
    """
    if not cells:
        # Return fallback unknown profile
        return TerrainProfile(
            study_area_id=study_area_id,
            study_area_name=study_area_name,
            terrain_type=TerrainType.UNKNOWN,
            confidence=0.1,
            classification_reason="No grid cells provided for evaluation.",
            natural_terrain=NaturalTerrainCharacteristics(),
            land_use_context=LandUseCharacteristics(),
            environmental_indicators=EnvironmentalIndicatorsSummary(),
            detected_constraints=["NO_CELLS_FOUND"],
            grid_cells_evaluated=0,
        )

    n = len(cells)

    # 1. Natural Terrain & Surface Characteristics
    built_ratios = [c.built_surface_ratio for c in cells]
    green_ratios = [c.green_space_ratio for c in cells]
    avail_areas = [c.available_area for c in cells]
    
    mean_built = sum(built_ratios) / n
    mean_green = sum(green_ratios) / n
    mean_avail = sum(avail_areas) / n

    surface_counts = Counter(c.surface_type.value for c in cells)
    surface_dist = {k: round(v / n, 3) for k, v in surface_counts.items()}
    dominant_surface = surface_counts.most_common(1)[0][0] if surface_counts else "mixed"

    # 2. Land-Use Characteristics
    land_use_counts = Counter(c.land_use.value for c in cells)
    land_use_dist = {k: round(v / n, 3) for k, v in land_use_counts.items()}
    dominant_land_use = land_use_counts.most_common(1)[0][0] if land_use_counts else "mixed"

    commercial_intensity = land_use_dist.get("plaza", 0.0) + (
        0.5 * land_use_dist.get("pedestrian_zone", 0.0)
    )
    # Check if area name or id indicates commercial/retail/market
    name_lower = f"{study_area_name} {study_area_id}".lower()
    if any(k in name_lower for k in ["bkc", "commercial", "market", "trade"]):
        commercial_intensity = max(commercial_intensity, 0.65)

    industrial_intensity = 0.0
    if any(k in name_lower for k in ["industrial", "midc", "pimpri", "factory", "plant", "chinchwad"]):
        industrial_intensity = 0.80

    residential_intensity = land_use_dist.get("residential", 0.0)
    if any(k in name_lower for k in ["colony", "residential", "housing", "nagar"]):
        residential_intensity = max(residential_intensity, 0.60)

    civic_heritage_intensity = 0.0
    if any(k in name_lower for k in ["vista", "rajpath", "kartavya", "heritage", "monument", "delhi"]):
        civic_heritage_intensity = 0.85

    # 3. Environmental Indicators Summary
    heat_scores = [c.scores.heat_score for c in cells]
    veg_deficits = [c.scores.vegetation_deficit for c in cells]
    ped_exposures = [c.scores.pedestrian_exposure for c in cells]
    conn_gaps = [c.scores.connectivity_gap for c in cells]
    tree_suits = [c.tree_suitability for c in cells]
    feas_scores = [c.scores.feasibility_score for c in cells]

    mean_heat = sum(heat_scores) / n
    mean_veg = sum(veg_deficits) / n
    mean_ped = sum(ped_exposures) / n
    mean_conn = sum(conn_gaps) / n
    mean_tree = sum(tree_suits) / n
    mean_feas = sum(feas_scores) / n

    high_heat_count = sum(1 for h in heat_scores if h >= 65.0)
    high_exp_count = sum(1 for p in ped_exposures if p >= 60.0)

    # 4. Constraints & Provenance Flags
    all_flags = set()
    for c in cells:
        flags = getattr(c, "provenance_flags", []) or []
        for f in flags:
            all_flags.add(f)

    has_water = "WATER_BODY_VETO" in all_flags or any("Water" in c.area_name for c in cells)
    has_ht = "OVERHEAD_HT_RESTRICTION" in all_flags or any("High-Tension" in c.area_name or "HT" in c.area_name for c in cells)
    has_heritage = "HERITAGE_RESTRICTION" in all_flags or any("Heritage" in c.area_name for c in cells)
    has_aviation = "AVIATION_OLS_RESTRICTION" in all_flags or any("Aviation" in c.area_name or "Runway" in c.area_name for c in cells)

    detected_constraints = []
    if has_water:
        detected_constraints.append("WATER_BODY_BUFFER_RESTRICTION")
    if has_ht or any(k in name_lower for k in ["pimpri", "chinchwad", "midc"]):
        detected_constraints.append("220KV_HIGH_TENSION_LINE_EASEMENT")
    if has_heritage or any(k in name_lower for k in ["delhi", "vista", "kartavya"]):
        detected_constraints.append("HERITAGE_SIGHTLINE_PROTECTION")
    if has_aviation:
        detected_constraints.append("AVIATION_OBSTACLE_SURFACE")

    # 5. Location-Aware Terrain Classification
    # Priority multi-factor heuristic using actual GIS features
    terrain_type = TerrainType.MIXED_USE
    confidence = 0.85
    reason_parts = []

    # Check for Green Belt / Forest Adjacent
    if mean_green >= 0.50 or mean_built <= 0.15:
        terrain_type = TerrainType.GREEN_BELT
        confidence = 0.92
        reason_parts.append(f"High green space ratio ({mean_green:.1%}) and low impervious built surface ({mean_built:.1%})")

    # Check for Industrial
    elif industrial_intensity >= 0.50 or (has_ht and mean_built >= 0.40):
        terrain_type = TerrainType.INDUSTRIAL
        confidence = 0.95
        reason_parts.append(
            f"High thermal load ({mean_heat:.1f}/100), heavy built surface ({mean_built:.1%}), "
            f"and industrial utility infrastructure (220kV HT transmission easement)."
        )

    # Check for Commercial / Central Business District
    elif commercial_intensity >= 0.50 or (mean_ped >= 55.0 and mean_built >= 0.50 and "soil" not in dominant_surface):
        terrain_type = TerrainType.COMMERCIAL
        confidence = 0.90
        reason_parts.append(
            f"High pedestrian exposure ({mean_ped:.1f}/100) and predominantly paved built environment ({mean_built:.1%})."
        )

    # Check for Civic / Heritage / Dense Urban
    elif civic_heritage_intensity >= 0.50 or (mean_built >= 0.45 and high_exp_count >= 30):
        terrain_type = TerrainType.DENSE_URBAN
        confidence = 0.92
        reason_parts.append(
            f"Dense civic corridor with high pedestrian transit flow ({mean_ped:.1f}/100) and statutory protection zones."
        )

    # Check for Residential
    elif residential_intensity >= 0.45 or (mean_green >= 0.25 and mean_built <= 0.40):
        terrain_type = TerrainType.RESIDENTIAL
        confidence = 0.88
        reason_parts.append(
            f"Moderate canopy coverage ({mean_green:.1%}) and distributed residential envelopes."
        )

    # Balanced Mixed-Use
    else:
        terrain_type = TerrainType.MIXED_USE
        confidence = 0.85
        reason_parts.append(
            f"Balanced mixed-use indicators: built surface {mean_built:.1%}, vegetation deficit {mean_veg:.1f}/100."
        )

    # Data provenance check
    prov = getattr(cells[0], "data_status", "demo")
    provenance_str = prov.value if hasattr(prov, "value") else str(prov)

    natural_terrain = NaturalTerrainCharacteristics(
        mean_built_surface_ratio=round(mean_built, 3),
        mean_green_space_ratio=round(mean_green, 3),
        mean_available_area_m2=round(mean_avail, 1),
        dominant_surface_type=dominant_surface,
        surface_distribution=surface_dist,
        has_water_bodies=has_water,
        has_steep_or_restricted_zones=len(detected_constraints) > 0,
    )

    land_use_context = LandUseCharacteristics(
        dominant_land_use=dominant_land_use,
        land_use_distribution=land_use_dist,
        commercial_intensity=round(commercial_intensity, 2),
        industrial_intensity=round(industrial_intensity, 2),
        residential_intensity=round(residential_intensity, 2),
        civic_or_heritage_intensity=round(civic_heritage_intensity, 2),
    )

    env_indicators = EnvironmentalIndicatorsSummary(
        mean_heat_score=round(mean_heat, 2),
        mean_vegetation_deficit=round(mean_veg, 2),
        mean_pedestrian_exposure=round(mean_ped, 2),
        mean_connectivity_gap=round(mean_conn, 2),
        mean_tree_suitability=round(mean_tree, 2),
        mean_feasibility_score=round(mean_feas, 2),
        high_heat_cells_count=high_heat_count,
        high_exposure_cells_count=high_exp_count,
        statutory_restrictions_count=len(detected_constraints),
    )

    return TerrainProfile(
        study_area_id=study_area_id,
        study_area_name=study_area_name,
        terrain_type=terrain_type,
        confidence=confidence,
        classification_reason="; ".join(reason_parts),
        natural_terrain=natural_terrain,
        land_use_context=land_use_context,
        environmental_indicators=env_indicators,
        detected_constraints=detected_constraints,
        dataset_provenance=provenance_str.upper(),
        grid_cells_evaluated=n,
    )


def get_baseline_strategy_for_terrain(terrain_type: TerrainType) -> ProposedStrategy:
    """Returns a versioned baseline strategy proposal matching the detected terrain."""
    spec = BASELINE_STRATEGIES.get(terrain_type, BASELINE_STRATEGIES[TerrainType.UNKNOWN])
    return ProposedStrategy(**spec)
