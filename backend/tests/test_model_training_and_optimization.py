"""
EcoGrid AI — Automated Test Suite for ML Pipelines, Geospatial Ingestion, & OR-Tools Optimization
(Section 16: Comprehensive Testing Requirements)

Tests:
1. Raster preprocessing, calibration, and quality masks (Landsat 8/9 & Sentinel-2)
2. NDVI calculation & vegetation deficit
3. Land-cover classification training, evaluation, and inference
4. Tree-suitability prediction & hard safety constraint enforcement
5. NetworkX graph connectivity & corridor analysis
6. Google OR-Tools CP-SAT solver outputs, knapsack constraints, mutual exclusivity, and weight sensitivity
7. FastAPI endpoints: /api/models/status, /api/models/predict, /api/optimize, /api/optimization-runs/{run_id}
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import pytest
from starlette.testclient import TestClient

from app.gis.grid_engine import generate_grid
from app.gis.public_datasets import (
    LandsatCalibration,
    LandsatLSTProcessor,
    Sentinel2Calibration,
    Sentinel2NDVIProcessor,
    WorldPopExposureProcessor,
)
from app.graph.connectivity import analyze_connectivity
from app.main import app
from app.ml.land_cover import (
    CLASS_LABELS,
    LandCoverClass,
    compute_spectral_indices,
    land_cover_predictor,
    train_land_cover_model,
)
from app.ml.tree_suitability import (
    evaluate_tree_planting_eligibility,
    evaluate_tree_safety_and_feasibility,
    predict_cooling_impact,
    predict_tree_suitability,
    run_model_benchmarking,
)
from app.optimization.optimizer import _generate_candidates, optimize_greedy, optimize_plan
from app.optimization.validator import validate_plan_constraints
from app.schemas.schemas import CellResponse, InterventionId, LandUse, ScoreSet, ScoreWeights, SurfaceType


@pytest.fixture
def test_cells():
    return generate_grid(study_id="test-study", rows=6, cols=6)


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. Geospatial & Satellite Processing Tests
# ---------------------------------------------------------------------------

def test_landsat_lst_conversion_and_masking():
    """Verify Landsat Collection 2 DN-to-Celsius scale factor conversion and quality masking."""
    # Test nominal DN value
    # LST (K) = 44000 * 0.00341802 + 149.0 = 299.39288 K = 26.24 °C
    temp_c, is_valid = LandsatLSTProcessor.calibrate_dn_to_celsius(44000)
    assert is_valid is True
    assert 25.0 <= temp_c <= 28.0

    # Test invalid / fill value (DN <= 0)
    temp_invalid, is_valid_inv = LandsatLSTProcessor.calibrate_dn_to_celsius(0)
    assert is_valid_inv is False
    assert temp_invalid == 28.0

    # Test heat priority score normalization
    p_ambient = LandsatLSTProcessor.surface_temp_to_heat_priority(28.0)
    assert p_ambient == 0.0 or 0.0 <= p_ambient <= 5.0
    p_hot = LandsatLSTProcessor.surface_temp_to_heat_priority(46.0)
    assert p_hot == 100.0


def test_sentinel2_ndvi_calculation():
    """Verify Sentinel-2 NDVI calculation and cloud/invalid masking."""
    # Dense vegetation: NIR = 0.50, Red = 0.05 -> NDVI = 0.45 / 0.55 = 0.818
    ndvi, valid = Sentinel2NDVIProcessor.calculate_ndvi(band4_red=0.05, band8_nir=0.50)
    assert valid is True
    assert 0.80 <= ndvi <= 0.83

    # Water / negative NDVI: NIR = 0.02, Red = 0.06 -> NDVI = -0.04 / 0.08 = -0.50
    ndvi_water, valid_water = Sentinel2NDVIProcessor.calculate_ndvi(band4_red=0.06, band8_nir=0.02)
    assert valid_water is True
    assert ndvi_water < 0.0

    # Cloud masked pixel
    _, valid_cloud = Sentinel2NDVIProcessor.calculate_ndvi(band4_red=0.3, band8_nir=0.3, cloud_masked=True)
    assert valid_cloud is False

    # Vegetation deficit translation
    assert Sentinel2NDVIProcessor.ndvi_to_vegetation_deficit(0.80) <= 25.0
    assert Sentinel2NDVIProcessor.ndvi_to_vegetation_deficit(0.05) >= 90.0


def test_worldpop_exposure_proxy():
    """Verify WorldPop gridded population translation into exposure proxy."""
    assert WorldPopExposureProcessor.density_to_exposure_score(0.0) == 0.0
    assert WorldPopExposureProcessor.density_to_exposure_score(75.0) == 50.0
    assert WorldPopExposureProcessor.density_to_exposure_score(200.0) == 100.0


# ---------------------------------------------------------------------------
# 2. Land-Cover Classification Model Tests
# ---------------------------------------------------------------------------

def test_land_cover_training_and_inference():
    """Verify Land-Cover spectral classifier training, metrics, and inference."""
    res = train_land_cover_model(n_samples_per_class=100, seed=42)
    assert res["status"] in ["trained", "already_trained"]
    assert land_cover_predictor.is_loaded is True

    # Test inference on a vegetation signature (High NIR, Low Red)
    pred_veg = land_cover_predictor.predict({
        "band2_blue": 0.02,
        "band3_green": 0.08,
        "band4_red": 0.04,
        "band8_nir": 0.55,
    })
    assert pred_veg["predicted_class_name"] == "Vegetation"
    assert pred_veg["confidence"] > 0.60
    assert "Vegetation" in pred_veg["probabilities"]
    assert sum(pred_veg["probabilities"].values()) == pytest.approx(1.0, abs=0.02)

    # Test inference on a water signature (Low Red, Near-zero NIR)
    pred_water = land_cover_predictor.predict({
        "band2_blue": 0.04,
        "band3_green": 0.04,
        "band4_red": 0.02,
        "band8_nir": 0.01,
    })
    assert pred_water["predicted_class_name"] == "Water Body"


# ---------------------------------------------------------------------------
# 3. Tree-Site Suitability & Hard Safety Constraints Tests
# ---------------------------------------------------------------------------

def test_tree_suitability_benchmarking():
    """Verify tree-site suitability models benchmark cleanly."""
    bench = run_model_benchmarking(force=False)
    assert bench["status"] in ["trained_and_benchmarked", "already_trained"]
    assert "random_forest_f1" in bench
    assert bench["random_forest_f1"] > 0.70


def test_hard_safety_constraint_overrides_high_ml_score():
    """
    CRITICAL SAFETY REQUIREMENT (Section 7):
    A high predicted suitability score must NEVER override a mandatory safety
    or legal restriction.
    """
    # Create a cell with severe safety violations (inside building envelope, utility clearance = 1.0m)
    unsafe_cell = CellResponse(
        cell_id="unsafe-cell-1",
        study_area_id="test-study",
        row=0,
        col=0,
        center=[12.93, 77.62],
        polygon=[[12.93, 77.62], [12.94, 77.62], [12.94, 77.63], [12.93, 77.63]],
        area_name="Utility Corridor",
        land_use=LandUse.BUILDING,
        surface_type=SurfaceType.BUILDING,
        scores=ScoreSet(
            heat_score=95.0,
            vegetation_deficit=90.0,
            pedestrian_exposure=80.0,
            connectivity_gap=80.0,
            feasibility_score=85.0,
        ),
        available_area=5.0,
        underground_utilities_clearance_m=1.0,  # Below mandatory 3.0m
        road_clearance_m=1.0,                   # Below mandatory 2.5m
    )

    # Even with an arbitrary 99.0% ML suitability score, safety MUST fail
    eval_res = evaluate_tree_planting_eligibility(unsafe_cell, ml_suitability_score=99.0)
    assert eval_res["safety_passed"] is False
    assert eval_res["is_eligible"] is False
    assert eval_res["override_applied"] is True
    assert len(eval_res["safety_violations"]) > 0
    assert any("Building structural envelope" in v for v in eval_res["safety_violations"])
    assert any("Underground utility clearance" in v for v in eval_res["safety_violations"])


# ---------------------------------------------------------------------------
# 4. NetworkX Graph Connectivity Tests
# ---------------------------------------------------------------------------

def test_networkx_green_connectivity(test_cells):
    """Verify NetworkX green-space connectivity and corridor identification."""
    res = analyze_connectivity(test_cells)
    assert len(res.components) >= 0
    assert res.before_components >= 1
    assert 0 <= res.before_score <= 100.0
    assert "Prototype Connectivity Model" in res.data_label


# ---------------------------------------------------------------------------
# 5. OR-Tools CP-SAT Optimization Tests
# ---------------------------------------------------------------------------

def test_ortools_budget_and_capacity_constraints(test_cells):
    """Verify OR-Tools strictly respects budget and cell capacities."""
    budget = 100000.0
    weights = ScoreWeights(w_heat=30, w_biodiversity=25, w_connectivity=20, w_greenery=25, w_pedestrian=25)

    plan = optimize_plan(test_cells, budget=budget, weights=weights)
    assert plan.solver_status == "OPTIMAL"
    assert plan.total_cost <= budget
    assert plan.remaining_budget >= 0.0

    # Independent validation engine check
    val = validate_plan_constraints(test_cells, plan.selected, budget)
    assert val["valid"] is True
    assert val["violations"] == []


def test_weight_responsiveness(test_cells):
    """Test that shifting priority weights updates optimization objective inputs."""
    w_heat = ScoreWeights(w_heat=80, w_biodiversity=5, w_connectivity=5, w_greenery=5, w_pedestrian=5)
    w_conn = ScoreWeights(w_heat=5, w_biodiversity=5, w_connectivity=80, w_greenery=5, w_pedestrian=5)

    plan_heat = optimize_plan(test_cells, budget=300000.0, weights=w_heat)
    plan_conn = optimize_plan(test_cells, budget=300000.0, weights=w_conn)

    assert plan_heat.solver_status == "OPTIMAL"
    assert plan_conn.solver_status == "OPTIMAL"

    # Heat priority should produce higher absolute heat benefit than connectivity priority
    heat_in_heat = plan_heat.category_benefits.get("heat", 0.0)
    heat_in_conn = plan_conn.category_benefits.get("heat", 0.0)
    assert heat_in_heat >= heat_in_conn


# ---------------------------------------------------------------------------
# 6. FastAPI ML Endpoints Integration Tests
# ---------------------------------------------------------------------------

def test_models_status_endpoint(client):
    """Verify GET /api/models/status returns all four models."""
    response = client.get("/api/models/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "land_cover_classifier" in data["models"]
    assert "tree_suitability_predictor" in data["models"]
    assert "microclimate_regressor" in data["models"]
    assert "satellite_cv_segmentation" in data["models"]


def test_models_predict_endpoint(client):
    """Verify POST /api/models/predict handles multiple model types cleanly."""
    # 1. Land cover
    resp_lc = client.post("/api/models/predict", json={
        "model": "land_cover",
        "features": {"band2_blue": 0.03, "band3_green": 0.09, "band4_red": 0.05, "band8_nir": 0.48}
    })
    assert resp_lc.status_code == 200
    assert resp_lc.json()["predicted_class_name"] == "Vegetation"

    # 2. Microclimate impact
    resp_mc = client.post("/api/models/predict", json={
        "model": "microclimate",
        "features": {"baseline_heat": 36.0, "trees_added": 6, "permeable_area_m2": 80.0}
    })
    assert resp_mc.status_code == 200
    assert "predicted_temp_drop_celsius" in resp_mc.json()
    assert resp_mc.json()["unit"] == "°C"


def test_optimization_runs_retrieval_endpoint(client):
    """Verify POST /api/optimize creates a run and GET /api/optimization-runs/{id} retrieves it."""
    opt_resp = client.post("/api/optimize", json={
        "studyId": "study-bengaluru-east",
        "budget": 250000.0,
        "weights": {"heat": 40, "vegetation": 20, "pedestrian": 20, "connectivity": 20}
    })
    assert opt_resp.status_code == 200
    run_id = opt_resp.json()["runId"]

    # Retrieve by ID
    get_resp = client.get(f"/api/optimization-runs/{run_id}")
    assert get_resp.status_code == 200
    fetched = get_resp.json()
    assert fetched["runId"] == run_id
    assert fetched["solverStatus"] == "OPTIMAL"
    assert fetched["totalCost"] <= 250000.0


# ---------------------------------------------------------------------------
# 7. Advanced ML Optimization, Spatial Independence & Explainability Tests
# ---------------------------------------------------------------------------

def test_spatial_cross_validation_and_no_leakage():
    """Verify spatial block cross-validation and independent spatial holdout evaluation."""
    bench = run_model_benchmarking(force=True)
    assert "spatial_holdout_test" in bench
    holdout = bench["spatial_holdout_test"]
    assert holdout["test_block_id"] == 3
    assert holdout["macro_f1"] > 0.70
    assert "brier_score" in holdout
    assert holdout["brier_score"] < 0.25  # Good probability calibration
    assert "confusion_matrix" in holdout

    # Check spatial CV score in model metrics
    rf_eval = bench["models"]["random_forest"]
    assert "spatial_cv_macro_f1" in rf_eval
    assert "±" in rf_eval["spatial_cv_macro_f1"]


def test_feature_preprocessing_pipeline_missing_values(test_cells):
    """Verify that SimpleImputer inside the pipeline gracefully handles missing/NaN cell features."""
    # Introduce NaN distance attributes in a cell
    test_cell = test_cells[0].model_copy()
    test_cell.distance_to_infrastructure_m = None  # Missing attribute
    test_cell.distance_to_green_m = None

    preds = predict_tree_suitability([test_cell])
    assert len(preds) == 1
    assert 0.0 <= preds[0]["ml_suitability"] <= 100.0
    assert 0.0 <= preds[0]["confidence"] <= 1.0
    assert preds[0]["quality_flag"] == "imputed_values"


def test_land_cover_out_of_distribution_detection():
    """Verify that Land-Cover classifier flags physically implausible spectral inputs."""
    # Out of physical reflectance bounds (> 1.25)
    pred_ood = land_cover_predictor.predict({
        "band2_blue": 2.50,
        "band3_green": 3.10,
        "band4_red": 4.50,
        "band8_nir": 5.00,
    })
    assert pred_ood["quality_flag"] == "out_of_distribution"

    # All-zero signal
    pred_zero = land_cover_predictor.predict({
        "band2_blue": 0.0,
        "band3_green": 0.0,
        "band4_red": 0.0,
        "band8_nir": 0.0,
    })
    assert pred_zero["quality_flag"] == "zero_signal"

    # Nominal physical reflectance
    pred_nom = land_cover_predictor.predict({
        "band2_blue": 0.03,
        "band3_green": 0.08,
        "band4_red": 0.04,
        "band8_nir": 0.52,
    })
    assert pred_nom["quality_flag"] == "nominal"
    assert pred_nom["predicted_class_name"] == "Vegetation"


def test_ml_to_grid_and_scoring_integration(test_cells):
    """Verify ML tree suitability is populated on grid cells and consumed by scoring engine."""
    # Ensure cells have non-zero suitability generated by ML pipeline
    has_suitability = any(c.tree_suitability > 0 for c in test_cells)
    assert has_suitability is True

    # Scoring engine evaluator incorporates ML suitability
    sample_cell = test_cells[0]
    from app.scoring.scoring_engine import evaluate_tree_suitability
    eval_res = evaluate_tree_suitability(sample_cell)
    assert "score" in eval_res
    assert "reasons" in eval_res
    assert isinstance(eval_res["reasons"], list)
    assert len(eval_res["reasons"]) > 0
    assert eval_res["model_status"] in ["ml_validated", "ml_safety_override"]


def test_optimizer_candidate_explainability_schema(test_cells):
    """Verify candidates generated for OR-Tools contain structured explainability fields."""
    weights = ScoreWeights(w_heat=30, w_biodiversity=20, w_connectivity=20, w_greenery=15, w_pedestrian=15)
    feasible, rejected = _generate_candidates(test_cells, weights)

    assert len(feasible) > 0
    first = feasible[0]
    assert hasattr(first, "reasons")
    assert isinstance(first.reasons, list)
    assert hasattr(first, "required_area")
    assert hasattr(first, "data_status")
    assert hasattr(first, "model_status")
    assert hasattr(first, "suitability_source")
    assert first.suitability_score >= 0.0
    assert first.weighted_benefit > 0.0
