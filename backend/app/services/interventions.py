"""
EcoGrid AI — Intervention Catalogue

Defines all supported climate interventions with structured data.
All costs are Demo / Estimated in Indian Rupees (INR).
Benefit coefficients are prototype estimates, not validated field measurements.
"""
from __future__ import annotations

from app.schemas.schemas import (
    InterventionDefinition,
    InterventionId,
    LandUse,
    SurfaceType,
)


INTERVENTIONS: list[InterventionDefinition] = [
    InterventionDefinition(
        intervention_id=InterventionId.NATIVE_TREES,
        name="Native Tree Planting",
        category="vegetation",
        measurement_unit="tree",
        unit_cost=420.0,
        unit_area=12.0,
        heat_benefit=0.28,
        biodiversity_benefit=0.22,
        connectivity_benefit=0.14,
        greenery_benefit=0.34,
        pedestrian_benefit=0.16,
        allowed_surfaces=[SurfaceType.SOIL, SurfaceType.MIXED, SurfaceType.GREEN],
        allowed_land_uses=[
            LandUse.PEDESTRIAN_ZONE, LandUse.PLAZA, LandUse.RESIDENTIAL,
            LandUse.GREEN_SPACE, LandUse.SPORTS, LandUse.MIXED,
        ],
        min_feasibility=32.0,
        marker_color="#4CC38A",
        icon="tree",
    ),
    InterventionDefinition(
        intervention_id=InterventionId.POLLINATOR_STRIP,
        name="Pollinator Corridor Planting",
        category="biodiversity",
        measurement_unit="link segment",
        unit_cost=760.0,
        unit_area=1.0,
        heat_benefit=0.13,
        biodiversity_benefit=0.39,
        connectivity_benefit=0.39,
        greenery_benefit=0.31,
        pedestrian_benefit=0.08,
        allowed_surfaces=[SurfaceType.SOIL, SurfaceType.MIXED, SurfaceType.GREEN],
        allowed_land_uses=[
            LandUse.PEDESTRIAN_ZONE, LandUse.PLAZA, LandUse.RESIDENTIAL,
            LandUse.GREEN_SPACE, LandUse.SPORTS, LandUse.MIXED,
        ],
        min_feasibility=48.0,
        marker_color="#90E0B0",
        icon="flower",
    ),
    InterventionDefinition(
        intervention_id=InterventionId.GREEN_BUFFER,
        name="Street-Edge Green Buffer",
        category="vegetation",
        measurement_unit="buffer segment",
        unit_cost=980.0,
        unit_area=1.0,
        heat_benefit=0.23,
        biodiversity_benefit=0.19,
        connectivity_benefit=0.19,
        greenery_benefit=0.25,
        pedestrian_benefit=0.19,
        allowed_surfaces=[SurfaceType.SOIL, SurfaceType.MIXED],
        allowed_land_uses=[
            LandUse.ROAD, LandUse.PARKING, LandUse.PEDESTRIAN_ZONE,
            LandUse.RESIDENTIAL, LandUse.MIXED,
        ],
        min_feasibility=50.0,
        marker_color="#2C9B78",
        icon="sprout",
    ),
    InterventionDefinition(
        intervention_id=InterventionId.POCKET_GREEN,
        name="Pocket / Micro Green Space",
        category="greenery",
        measurement_unit="m²",
        unit_cost=850.0,
        unit_area=1.0,
        heat_benefit=0.20,
        biodiversity_benefit=0.25,
        connectivity_benefit=0.22,
        greenery_benefit=0.40,
        pedestrian_benefit=0.15,
        allowed_surfaces=[SurfaceType.SOIL, SurfaceType.MIXED, SurfaceType.PAVED],
        allowed_land_uses=[
            LandUse.PLAZA, LandUse.PARKING, LandUse.PEDESTRIAN_ZONE,
            LandUse.RESIDENTIAL, LandUse.MIXED,
        ],
        min_feasibility=40.0,
        marker_color="#77DDB1",
        icon="park",
    ),
    InterventionDefinition(
        intervention_id=InterventionId.SHADE_STRUCTURE,
        name="Modular Shade Structure",
        category="pedestrian_comfort",
        measurement_unit="structure",
        unit_cost=1650.0,
        unit_area=25.0,
        heat_benefit=0.36,
        biodiversity_benefit=0.04,
        connectivity_benefit=0.06,
        greenery_benefit=0.04,
        pedestrian_benefit=0.30,
        allowed_surfaces=[SurfaceType.PAVED, SurfaceType.MIXED],
        allowed_land_uses=[
            LandUse.PEDESTRIAN_ZONE, LandUse.PLAZA, LandUse.PARKING,
            LandUse.RESIDENTIAL, LandUse.SPORTS, LandUse.ROAD, LandUse.MIXED,
        ],
        min_feasibility=42.0,
        marker_color="#B7F7D0",
        icon="umbrella",
    ),
    InterventionDefinition(
        intervention_id=InterventionId.COOL_SURFACE,
        name="Reflective / Cool Surface",
        category="heat_mitigation",
        measurement_unit="100 m²",
        unit_cost=510.0,
        unit_area=1.0,
        heat_benefit=0.33,
        biodiversity_benefit=0.02,
        connectivity_benefit=0.01,
        greenery_benefit=0.02,
        pedestrian_benefit=0.17,
        allowed_surfaces=[SurfaceType.PAVED, SurfaceType.MIXED],
        allowed_land_uses=[
            LandUse.PLAZA, LandUse.PARKING, LandUse.BUILDING,
            LandUse.PEDESTRIAN_ZONE, LandUse.ROAD, LandUse.MIXED,
        ],
        min_feasibility=58.0,
        marker_color="#F3B44E",
        icon="sun",
    ),
]

INTERVENTION_BY_ID = {i.intervention_id: i for i in INTERVENTIONS}
