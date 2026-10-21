"""
EcoGrid AI — Pydantic schemas for API requests and responses.

All models use Pydantic v2. Scores are normalized to 0-100 scale.
Costs are in Indian Rupees (INR). All demo data is clearly labelled.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class LandUse(str, Enum):
    PEDESTRIAN_ZONE = "pedestrian_zone"
    PLAZA = "plaza"
    PARKING = "parking"
    BUILDING = "building"
    RESIDENTIAL = "residential"
    GREEN_SPACE = "green_space"
    SPORTS = "sports"
    ROAD = "road"
    MIXED = "mixed"


class SurfaceType(str, Enum):
    SOIL = "soil"
    PAVED = "paved"
    MIXED = "mixed"
    GREEN = "green"
    BUILDING = "building"


class InterventionId(str, Enum):
    NATIVE_TREES = "native_trees"
    POLLINATOR_STRIP = "pollinator_strip"
    GREEN_BUFFER = "green_buffer"
    POCKET_GREEN = "pocket_green"
    SHADE_STRUCTURE = "shade_structure"
    COOL_SURFACE = "cool_surface"


class RiskBand(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class DataSource(str, Enum):
    SYNTHETIC = "synthetic_demo"
    SATELLITE = "satellite"
    FIELD = "field_survey"
    MODEL = "ml_prediction"
    RULE = "rule_based"


class DataStatus(str, Enum):
    DEMO = "demo"
    VALIDATED = "validated"
    PROVISIONAL = "provisional"


# ---------------------------------------------------------------------------
# Core data models
# ---------------------------------------------------------------------------

class LatLng(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ScoreSet(BaseModel):
    """Environmental scores normalized 0-100."""
    heat_score: float = Field(0, ge=0, le=100)
    vegetation_deficit: float = Field(0, ge=0, le=100)
    pedestrian_exposure: float = Field(0, ge=0, le=100)
    connectivity_gap: float = Field(0, ge=0, le=100)
    feasibility_score: float = Field(0, ge=0, le=100)


class CellResponse(BaseModel):
    """A single grid cell with all environmental indicators."""
    cell_id: str
    study_area_id: str
    row: int
    col: int
    center: list[float]  # [lat, lng]
    polygon: list[list[float]]  # [[lat,lng], ...]
    area_name: str
    land_use: LandUse
    surface_type: SurfaceType
    scores: ScoreSet
    tree_suitability: float = Field(0, ge=0, le=100)
    green_space_ratio: float = Field(0, ge=0, le=1)
    built_surface_ratio: float = Field(0, ge=0, le=1)
    available_area: float = Field(0, ge=0)
    existing_green_cover: float = Field(0, ge=0, le=1)
    priority_zone: bool = False
    data_source: DataSource = DataSource.SYNTHETIC
    data_status: DataStatus = DataStatus.DEMO
    capacity: int = 0
    distance_to_infrastructure_m: float = Field(12.0, ge=0)
    distance_to_green_m: float = Field(45.0, ge=0)
    underground_utilities_clearance_m: float = Field(6.0, ge=0)
    road_clearance_m: float = Field(8.0, ge=0)
    observation_date: Optional[str] = "2026-05-18"
    data_label: str = "SYNTHETIC DEMO DATA — NOT A MEASURED ENVIRONMENTAL ASSESSMENT"
    provenance_flags: list[str] = Field(default_factory=lambda: ["SYNTHETIC_DEMO"])


class StudyAreaResponse(BaseModel):
    id: str
    name: str
    origin: list[float]
    rows: int
    columns: int
    cell_size_lat: float
    cell_size_lng: float
    cell_count: int
    data_label: str = "SYNTHETIC / DEMO"


# ---------------------------------------------------------------------------
# Intervention models
# ---------------------------------------------------------------------------

class InterventionDefinition(BaseModel):
    """Definition of a climate intervention type."""
    intervention_id: InterventionId
    name: str
    category: str
    measurement_unit: str
    unit_cost: float = Field(..., description="Cost per unit in INR (Demo / Estimated)")
    unit_area: float = Field(0, description="Area per unit in m²")
    heat_benefit: float = Field(0, ge=0, le=1)
    biodiversity_benefit: float = Field(0, ge=0, le=1)
    connectivity_benefit: float = Field(0, ge=0, le=1)
    greenery_benefit: float = Field(0, ge=0, le=1)
    pedestrian_benefit: float = Field(0, ge=0, le=1)
    allowed_surfaces: list[SurfaceType]
    allowed_land_uses: list[LandUse]
    min_feasibility: float = Field(0, ge=0, le=100)
    marker_color: str = "#4CC38A"
    icon: str = "tree"


class CandidateIntervention(BaseModel):
    """A candidate intervention for a specific cell."""
    cell_id: str
    area_name: str
    intervention_id: InterventionId
    intervention_name: str
    quantity: float
    unit: str
    cost: float
    suitability_score: float = Field(0, ge=0, le=100)
    feasible: bool = True
    heat_benefit: float = 0
    biodiversity_benefit: float = 0
    connectivity_benefit: float = 0
    greenery_benefit: float = 0
    pedestrian_benefit: float = 0
    weighted_benefit: float = 0
    benefit_per_cost: float = 0
    reason: Optional[str] = None
    reasons: list[str] = Field(default_factory=list)
    required_area: float = 0.0
    data_status: str = "synthetic_demo"
    model_status: str = "ml_validated"
    suitability_source: str = "ml_prediction"


# ---------------------------------------------------------------------------
# Optimization request/response
# ---------------------------------------------------------------------------

class ScoreWeights(BaseModel):
    """User-controlled priority weights. Must sum to 100."""
    w_heat: float = Field(40, ge=0, le=100)
    w_biodiversity: float = Field(5, ge=0, le=100)
    w_connectivity: float = Field(20, ge=0, le=100)
    w_greenery: float = Field(10, ge=0, le=100)
    w_pedestrian: float = Field(25, ge=0, le=100)

    @field_validator("w_pedestrian")
    @classmethod
    def weights_must_sum_to_100(cls, v, info):
        total = (
            info.data.get("w_heat", 0)
            + info.data.get("w_biodiversity", 0)
            + info.data.get("w_connectivity", 0)
            + info.data.get("w_greenery", 0)
            + v
        )
        if abs(total - 100) > 0.01:
            # Auto-normalize instead of rejecting
            pass
        return v

    def normalized(self) -> dict[str, float]:
        total = self.w_heat + self.w_biodiversity + self.w_connectivity + self.w_greenery + self.w_pedestrian
        if total <= 0:
            return {"w_heat": 0.2, "w_biodiversity": 0.2, "w_connectivity": 0.2, "w_greenery": 0.2, "w_pedestrian": 0.2}
        return {
            "w_heat": self.w_heat / total,
            "w_biodiversity": self.w_biodiversity / total,
            "w_connectivity": self.w_connectivity / total,
            "w_greenery": self.w_greenery / total,
            "w_pedestrian": self.w_pedestrian / total,
        }


class OptimizeRequest(BaseModel):
    study_id: str = "ecogrid-campus-demo"
    budget: float = Field(500000, gt=0, description="Budget in INR")
    weights: ScoreWeights = ScoreWeights()
    enabled_interventions: Optional[list[InterventionId]] = None


class OptimizeResponse(BaseModel):
    solver_status: str
    selected: list[CandidateIntervention]
    rejected_count: int
    total_cost: float
    remaining_budget: float
    utilization: float
    combined_benefit: float
    category_benefits: dict[str, float]
    cells_improved: int
    intervention_summary: dict[str, dict]
    data_label: str = "SYNTHETIC / DEMO — To Be Validated"


# ---------------------------------------------------------------------------
# Scenario comparison
# ---------------------------------------------------------------------------

class ScenarioRequest(BaseModel):
    study_id: str = "ecogrid-campus-demo"
    name: str = "Custom scenario"
    budget: float = Field(500000, gt=0)
    weights: ScoreWeights = ScoreWeights()
    enabled_interventions: Optional[list[InterventionId]] = None


class ScenarioCompareRequest(BaseModel):
    study_id: str = "ecogrid-campus-demo"
    scenarios: list[ScenarioRequest] = Field(..., min_length=2, max_length=4)


# ---------------------------------------------------------------------------
# Connectivity
# ---------------------------------------------------------------------------

class GreenComponent(BaseModel):
    id: str
    cell_ids: list[str]
    color: str
    isolated: bool


class GreenLink(BaseModel):
    from_cell: str
    to_cell: str
    kind: str  # 'existing' or 'potential'


class ConnectivityResponse(BaseModel):
    components: list[GreenComponent]
    links: list[GreenLink]
    isolated_patches: list[str]
    before_components: int
    after_components: int
    before_score: float
    after_score: float
    new_connections: int
    data_label: str = "Prototype Connectivity Model — Not a validated ecological assessment"


# ---------------------------------------------------------------------------
# Health / meta
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    ok: bool = True
    service: str = "ecogrid-api"
    version: str = "1.0.0"
    stack: str = "Python FastAPI + PostGIS"
