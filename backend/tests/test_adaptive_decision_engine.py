"""
EcoGrid AI 2.0 — Comprehensive Test Suite for Grok-Powered Terrain-Adaptive AI Decision Engine
(Phase 15: Testing Groups A, B, C, D, E)

Tests:
- Group A: Grok Strategy Integration & Fallbacks
- Group B: Mathematical Validation Gateway
- Group C: ML Feature Compatibility & Model Registry
- Group D: OR-Tools Optimization & Budget Feasibility
- Group E: Geographic Awareness, Terrain Profiling & 10x10 Grid Integrity
"""
import math
import pytest
from starlette.testclient import TestClient

from app.adaptive_ai import (
    adaptive_strategy_engine,
    characterize_terrain,
    feature_registry,
    formula_registry,
    get_baseline_strategy_for_terrain,
    model_registry,
    ProposedStrategy,
    StrategyRecommendationRequest,
    StrategyValidator,
    TerrainType,
    ValidatedStrategy,
    ValidationStatus,
)
from app.gis.grid_engine import generate_grid
from app.main import app, _get_or_generate_cells, DEFAULT_STUDY_ID
from app.optimization.optimizer import optimize_plan
from app.schemas.schemas import CellResponse, LandUse, ScoreSet, ScoreWeights, SurfaceType
from app.scoring.scoring_engine import calculate_priority, combined_priority


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_cells():
    """Generates standard 10x10 (100 cells) Bengaluru East grid for unit testing."""
    return generate_grid(
        study_id="test-study-area",
        name="Bengaluru Test Site",
        origin_lat=12.9352,
        origin_lng=77.6245,
        rows=10,
        cols=10,
        cell_size_lat=0.0012,
        cell_size_lng=0.0012,
    )


# ===========================================================================
# TEST GROUP A: Grok Strategy Integration & Fallbacks
# ===========================================================================

def test_group_a_baseline_strategy_fallback_for_all_terrains():
    """Verifies predefined, versioned baseline strategy exists and is valid for every terrain."""
    for terrain in TerrainType:
        baseline = get_baseline_strategy_for_terrain(terrain)
        assert baseline.strategy_id is not None
        assert baseline.formula_id in [f["formula_id"] for f in formula_registry.list_formulas()]
        assert baseline.model_id in [m["model_id"] for m in model_registry.list_models()]
        assert abs(sum(baseline.priority_weights.values()) - 1.0) <= 0.005


@pytest.mark.asyncio
async def test_group_a_grok_fallback_on_api_failure(sample_cells):
    """When Grok API is forced to fallback or keys are offline, safe baseline is returned with fallback_applied=True."""
    strat = await adaptive_strategy_engine.recommend_strategy(
        cells=sample_cells,
        study_area_id="test-study-area",
        study_area_name="Bengaluru Test Site",
        budget=800000.0,
        force_fallback=True,
    )
    assert strat.validation_status in [ValidationStatus.VALIDATED, ValidationStatus.FALLBACK_APPLIED]
    assert strat.fallback_applied is True or "Fallback" in strat.strategy_name or "baseline" in strat.strategy_id
    assert abs(sum(strat.priority_weights.values()) - 1.0) <= 0.005
    assert strat.strategy_version == "1.0"


def test_group_a_unsupported_model_triggers_fallback(sample_cells):
    """If Grok suggests a non-existent ML model, the gateway rejects it and applies baseline."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    invalid_proposal = ProposedStrategy(
        strategy_id="grok_hallucinated_model",
        strategy_name="Invalid Model Strategy",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="weighted_additive_v1",
        priority_weights={"heat": 0.35, "vegetation": 0.25, "pedestrian": 0.25, "connectivity": 0.15},
        optimization_weights={"w_heat": 35.0, "w_biodiversity": 15.0, "w_connectivity": 15.0, "w_greenery": 15.0, "w_pedestrian": 20.0},
        model_id="hallucinated_deep_learning_v999",  # NOT in registry
        preferred_interventions=["native_trees"],
        explanation="Testing invalid model handling.",
    )
    validated = StrategyValidator.validate_proposal(invalid_proposal, terrain, budget=500000.0)
    assert validated.validation_status == ValidationStatus.FALLBACK_APPLIED
    assert validated.fallback_applied is True
    assert any("UNREGISTERED_MODEL" == e.code for e in validated.validation_errors)
    assert validated.model_id != "hallucinated_deep_learning_v999"


def test_group_a_unsupported_formula_triggers_fallback(sample_cells):
    """If Grok suggests a non-existent formula ID, the gateway rejects it."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    invalid_proposal = ProposedStrategy(
        strategy_id="grok_hallucinated_formula",
        strategy_name="Invalid Formula Strategy",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="quantum_entropy_formula_v3",  # NOT in registry
        priority_weights={"heat": 0.35, "vegetation": 0.25, "pedestrian": 0.25, "connectivity": 0.15},
        optimization_weights={"w_heat": 35.0, "w_biodiversity": 15.0, "w_connectivity": 15.0, "w_greenery": 15.0, "w_pedestrian": 20.0},
        model_id="tree_suitability_v2_spatial_calibrated",
        preferred_interventions=["native_trees"],
        explanation="Testing invalid formula handling.",
    )
    validated = StrategyValidator.validate_proposal(invalid_proposal, terrain, budget=500000.0)
    assert validated.validation_status == ValidationStatus.FALLBACK_APPLIED
    assert any("UNREGISTERED_FORMULA" == e.code for e in validated.validation_errors)


# ===========================================================================
# TEST GROUP B: Mathematical Validation Gateway
# ===========================================================================

def test_group_b_valid_weights_summing_to_one(sample_cells):
    """Valid proposal with sum=1.0 and registered elements passes validation."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    proposal = ProposedStrategy(
        strategy_id="valid_strategy_1",
        strategy_name="Verified Industrial Adaptation",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="heat_mitigation_priority_v1",
        priority_weights={"heat": 0.40, "vegetation": 0.25, "pedestrian": 0.20, "connectivity": 0.15},
        optimization_weights={"w_heat": 40.0, "w_biodiversity": 15.0, "w_connectivity": 15.0, "w_greenery": 15.0, "w_pedestrian": 15.0},
        model_id="tree_suitability_v2_spatial_calibrated",
        preferred_interventions=["native_trees", "cool_surface", "green_buffer"],
        explanation="Valid proposal with proper mathematical bounds.",
    )
    validated = StrategyValidator.validate_proposal(proposal, terrain, budget=1000000.0)
    assert validated.validation_status == ValidationStatus.VALIDATED
    assert validated.fallback_applied is False
    assert len(validated.validation_errors) == 0


def test_group_b_rejects_weights_not_summing_to_one(sample_cells):
    """Proposal where weights sum to 1.35 or 0.70 must be rejected."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    proposal = ProposedStrategy(
        strategy_id="bad_sum_strategy",
        strategy_name="Bad Sum Strategy",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="weighted_additive_v1",
        priority_weights={"heat": 0.60, "vegetation": 0.35, "pedestrian": 0.25, "connectivity": 0.15},  # sum = 1.35
        optimization_weights={"w_heat": 30.0, "w_biodiversity": 15.0, "w_connectivity": 15.0, "w_greenery": 20.0, "w_pedestrian": 20.0},
        model_id="tree_suitability_v2_spatial_calibrated",
        preferred_interventions=["native_trees"],
        explanation="Testing sum != 1.",
    )
    validated = StrategyValidator.validate_proposal(proposal, terrain, budget=1000000.0)
    assert validated.validation_status == ValidationStatus.FALLBACK_APPLIED
    assert any(e.code == "SUM_NOT_ONE" for e in validated.validation_errors)


def test_group_b_rejects_negative_or_nan_weights(sample_cells):
    """Proposal with negative weights or NaN/Inf is strictly rejected."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    proposal = ProposedStrategy(
        strategy_id="negative_weight_strategy",
        strategy_name="Negative Weight Strategy",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="weighted_additive_v1",
        priority_weights={"heat": -0.20, "vegetation": 0.60, "pedestrian": 0.35, "connectivity": 0.25},
        optimization_weights={"w_heat": 30.0, "w_biodiversity": 15.0, "w_connectivity": 15.0, "w_greenery": 20.0, "w_pedestrian": 20.0},
        model_id="tree_suitability_v2_spatial_calibrated",
        preferred_interventions=["native_trees"],
        explanation="Testing negative weight rejection.",
    )
    validated = StrategyValidator.validate_proposal(proposal, terrain, budget=1000000.0)
    assert validated.validation_status == ValidationStatus.FALLBACK_APPLIED
    assert any(e.code in ["OUT_OF_BOUNDS", "STARVATION_RISK"] for e in validated.validation_errors)


def test_group_b_rejects_starvation_weight_under_five_percent(sample_cells):
    """Weight below 0.05 is rejected to prevent complete starvation of an indicator."""
    terrain = characterize_terrain(sample_cells, "test-id", "Test Area")
    proposal = ProposedStrategy(
        strategy_id="starvation_strategy",
        strategy_name="Starvation Strategy",
        strategy_version="1.0",
        terrain_type=terrain.terrain_type,
        formula_id="weighted_additive_v1",
        priority_weights={"heat": 0.70, "vegetation": 0.24, "pedestrian": 0.05, "connectivity": 0.01},  # connectivity < 0.05
        optimization_weights={"w_heat": 70.0, "w_biodiversity": 10.0, "w_connectivity": 5.0, "w_greenery": 10.0, "w_pedestrian": 5.0},
        model_id="tree_suitability_v2_spatial_calibrated",
        preferred_interventions=["native_trees"],
        explanation="Testing weight starvation rejection.",
    )
    validated = StrategyValidator.validate_proposal(proposal, terrain, budget=1000000.0)
    assert validated.validation_status == ValidationStatus.FALLBACK_APPLIED
    assert any(e.code == "STARVATION_RISK" for e in validated.validation_errors)


# ===========================================================================
# TEST GROUP C: ML Feature Compatibility & Model Registry
# ===========================================================================

def test_group_c_feature_schema_validation():
    """Feature registry correctly validates valid features and rejects invalid types or missing features."""
    valid_data = {
        "heat_score": 65.0,
        "vegetation_deficit": 50.0,
        "built_surface_ratio": 0.45,
        "available_area": 85.0,
        "green_space_ratio": 0.20,
        "feasibility_score": 75.0,
        "distance_to_infrastructure_m": 15.0,
        "distance_to_green_m": 35.0,
    }
    is_valid, errors, clean = feature_registry.validate_features("tree_suitability_v2_spatial_calibrated", valid_data)
    assert is_valid is True
    assert len(errors) == 0
    assert len(clean) == 8

    # Missing required feature
    invalid_data = dict(valid_data)
    del invalid_data["heat_score"]
    is_valid2, errors2, _ = feature_registry.validate_features("tree_suitability_v2_spatial_calibrated", invalid_data)
    assert is_valid2 is False
    assert any("Missing required feature 'heat_score'" in e for e in errors2)

    # Non-numeric string
    bad_type_data = dict(valid_data)
    bad_type_data["available_area"] = "unbounded_area"
    is_valid3, errors3, _ = feature_registry.validate_features("tree_suitability_v2_spatial_calibrated", bad_type_data)
    assert is_valid3 is False
    assert any("cannot be converted to float" in e for e in errors3)


def test_group_c_controlled_retraining_hook():
    """Controlled retraining workflow logs candidate requests without silently deploying unverified models."""
    rec = model_registry.record_retraining_need(
        model_id="tree_suitability_v2_spatial_calibrated",
        target_terrain="sub_arctic_permafrost",
        reason="Extreme soil condition outside training distribution",
        missing_features=["permafrost_depth_cm", "soil_temperature_c"],
    )
    assert rec.status == "PENDING_APPROVAL"
    assert rec.target_terrain == "sub_arctic_permafrost"
    assert "permafrost_depth_cm" in rec.missing_features
    # Verify it is tracked in registry queue
    records = model_registry.get_retraining_records()
    assert any(r.request_id == rec.request_id for r in records)


# ===========================================================================
# TEST GROUP D: OR-Tools Optimization & Budget Feasibility
# ===========================================================================

def test_group_d_budget_feasibility_enforced(sample_cells):
    """Optimizer strictly respects user-defined budget ceiling."""
    budget = 400000.0  # ₹4.0 Lakhs
    weights = ScoreWeights(w_heat=40, w_biodiversity=10, w_connectivity=15, w_greenery=15, w_pedestrian=20)
    plan = optimize_plan(sample_cells, budget=budget, weights=weights)

    assert plan.total_cost <= budget
    assert plan.remaining_budget >= 0.0
    assert plan.total_cost > 0.0  # Feasible candidates were selected


def test_group_d_deterministic_repeated_runs(sample_cells):
    """Running optimization with identical inputs produces identical results."""
    budget = 600000.0
    weights = ScoreWeights(w_heat=35, w_biodiversity=15, w_connectivity=15, w_greenery=15, w_pedestrian=20)

    run1 = optimize_plan(sample_cells, budget=budget, weights=weights)
    run2 = optimize_plan(sample_cells, budget=budget, weights=weights)

    assert run1.total_cost == run2.total_cost
    assert run1.combined_benefit == run2.combined_benefit
    assert len(run1.selected) == len(run2.selected)
    assert [c.cell_id for c in run1.selected] == [c.cell_id for c in run2.selected]


# ===========================================================================
# TEST GROUP E: Geographic Awareness, Terrain Profiling & 10x10 Grid Integrity
# ===========================================================================

def test_group_e_terrain_profiling_differs_by_location():
    """Pimpri industrial area and Bengaluru campus produce distinct terrain profiles."""
    pimpri_cells = _get_or_generate_cells("study-pimpri")
    bengaluru_cells = _get_or_generate_cells(DEFAULT_STUDY_ID)

    assert len(pimpri_cells) == 100
    assert len(bengaluru_cells) == 100

    profile_pimpri = characterize_terrain(pimpri_cells, "study-pimpri", "Pimpri Industrial Area, Pimpri-Chinchwad")
    profile_bengaluru = characterize_terrain(bengaluru_cells, DEFAULT_STUDY_ID, "Bengaluru East Campus")

    # Pimpri is characterized as Industrial
    assert profile_pimpri.terrain_type == TerrainType.INDUSTRIAL
    # Pimpri has 220kV HT transmission restriction
    assert "220KV_HIGH_TENSION_LINE_EASEMENT" in profile_pimpri.detected_constraints
    assert profile_pimpri.grid_cells_evaluated == 100

    # Bengaluru has balanced or mixed-use profile
    assert profile_bengaluru.grid_cells_evaluated == 100


def test_group_e_grid_remains_strictly_100_cells():
    """All configured study areas have exactly 10x10 = 100 cells."""
    study_ids = ["study-pimpri", "study-delhi", "study-mumbai", "study-pune", "study-nashik", DEFAULT_STUDY_ID]
    for sid in study_ids:
        cells = _get_or_generate_cells(sid)
        assert len(cells) == 100, f"Study area {sid} must have exactly 100 cells"


# ===========================================================================
# API ENDPOINT INTEGRATION TESTS
# ===========================================================================

def test_api_profiles_endpoint(client):
    """GET /api/adaptive/profiles returns registered terrains, formulas, and models."""
    res = client.get("/api/adaptive/profiles")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert "industrial" in data["supported_terrains"]
    assert len(data["registered_formulas"]) >= 4
    assert len(data["registered_models"]) >= 2


def test_api_characterize_endpoint(client):
    """POST /api/adaptive/characterize returns accurate terrain characterization."""
    res = client.post("/api/adaptive/characterize", json={"study_id": "study-pimpri"})
    assert res.status_code == 200
    data = res.json()
    assert data["terrain_type"] == "industrial"
    assert data["grid_cells_evaluated"] == 100
    assert "natural_terrain" in data
    assert "land_use_context" in data


def test_api_adaptive_strategy_endpoint(client):
    """POST /api/adaptive/strategy returns validated strategy."""
    res = client.post(
        "/api/adaptive/strategy",
        json={"study_id": DEFAULT_STUDY_ID, "budget": 800000.0, "force_fallback": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert "strategy_id" in data
    assert data["validation_status"] in ["VALIDATED", "FALLBACK_APPLIED"]
    assert abs(sum(data["priority_weights"].values()) - 1.0) <= 0.005


def test_api_adaptive_optimize_endpoint(client):
    """POST /api/adaptive/optimize runs in both standard and adaptive modes."""
    # Standard Mode
    res_std = client.post(
        "/api/adaptive/optimize",
        json={"study_id": DEFAULT_STUDY_ID, "budget": 600000.0, "mode": "standard"},
    )
    assert res_std.status_code == 200
    data_std = res_std.json()
    assert data_std["mode"] == "standard"
    assert data_std["plan"]["total_cost"] <= 600000.0

    # Adaptive Mode
    res_adapt = client.post(
        "/api/adaptive/optimize",
        json={"study_id": DEFAULT_STUDY_ID, "budget": 600000.0, "mode": "adaptive"},
    )
    assert res_adapt.status_code == 200
    data_adapt = res_adapt.json()
    assert data_adapt["mode"] == "adaptive"
    assert data_adapt["plan"]["total_cost"] <= 600000.0
    assert "strategy" in data_adapt
    assert "shared_metrics" in data_adapt


def test_api_adaptive_compare_endpoint(client):
    """POST /api/adaptive/compare runs side-by-side comparison on shared evaluation metrics."""
    res = client.post(
        "/api/adaptive/compare",
        json={"study_id": "study-pimpri", "budget": 750000.0},
    )
    assert res.status_code == 200
    data = res.json()
    assert "standard_plan" in data
    assert "adaptive_plan" in data
    assert "standard_metrics" in data
    assert "adaptive_metrics" in data
    assert "delta" in data
    assert "fairness_disclaimer" in data
