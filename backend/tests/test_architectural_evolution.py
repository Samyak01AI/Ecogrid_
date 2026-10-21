"""
EcoGrid AI — Comprehensive 6-Stage Architectural Evolution Test Suite

Tests:
1. Stage 1: Public Data Ingestion & Zonal Statistics Overlay (EPSG:32643 / WGS84)
2. Stage 2: Predictive ML Benchmarking (Baseline vs RF vs XGBoost + Regressor)
3. Stage 3: Multi-Objective Pareto Optimization (pymoo NSGA-II + CP-SAT)
4. Stage 4: Validation Engine, Greedy Comparator & Uncertainty Bounds
5. Stage 5: Database Persistence, Human Approval Workflow & Outcome Monitoring
6. Stage 6: FastAPI Endpoints Integration
"""
import sys
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import pytest
from starlette.testclient import TestClient

from app.gis.grid_engine import generate_grid
from app.gis.public_datasets import fuse_public_datasets_into_grid
from app.gis.zonal_sampler import zonal_sampler
from app.main import app
from app.ml.tree_suitability import (
    predict_cooling_impact,
    predict_tree_suitability,
    run_model_benchmarking,
)
from app.models.database import HumanApproval, OptimizationRun, OutcomeMonitoring, get_session_factory, init_db
from app.optimization.optimizer import optimize_greedy, optimize_pareto, optimize_plan
from app.optimization.validator import (
    compute_greedy_benchmark,
    compute_uncertainty_bounds,
    validate_plan_constraints,
)
from app.schemas.schemas import ScoreWeights


@pytest.fixture
def sample_cells():
    return generate_grid(study_id="test-study")


@pytest.fixture
def default_weights():
    return ScoreWeights(w_heat=30, w_biodiversity=25, w_connectivity=20, w_greenery=25, w_pedestrian=25)


# ---------------------------------------------------------------------------
# Stage 1: Public GIS Ingestion & Zonal Statistics
# ---------------------------------------------------------------------------
def test_stage1_zonal_sampler(sample_cells):
    report = zonal_sampler.attach_real_environmental_layers(sample_cells, study_area="bengaluru-east")
    assert report["status"] in ["ZONAL_STATS_FUSED", "EMPIRICAL_RASTER_FUSED"]
    assert report["crs_projected"] == "EPSG:32643 (UTM 43N)"
    assert report["cells_resampled"] == len(sample_cells)

    # Check that cells have calibrated heat and vegetation scores
    assert all(0 <= c.scores.heat_score <= 100 for c in sample_cells)
    assert all(0 <= c.scores.vegetation_deficit <= 100 for c in sample_cells)
    assert all(0 <= c.scores.pedestrian_exposure <= 100 for c in sample_cells)

    # Public dataset fusion wrapper
    fuse_rep = fuse_public_datasets_into_grid(sample_cells, study_area="bengaluru-east")
    assert fuse_rep["status"] == "ready"
    assert "landsat_lst" in fuse_rep["data_sources"]


# ---------------------------------------------------------------------------
# Stage 2: Predictive ML Benchmarking & Micro-Climate Regressor
# ---------------------------------------------------------------------------
def test_stage2_predictive_ml(sample_cells):
    bench = run_model_benchmarking(force=False)
    assert "models" in bench
    assert "baseline_logistic_regression" in bench["models"]
    assert "random_forest" in bench["models"]
    assert bench["baseline_accuracy"] > 0.50
    assert bench["random_forest_f1"] > 0.70

    # Predictions
    preds = predict_tree_suitability(sample_cells[:10])
    assert len(preds) == 10
    assert all("ml_suitability" in p for p in preds)

    # Regressor
    cooling = predict_cooling_impact(
        baseline_heat=38.0,
        baseline_ndvi=0.15,
        built_ratio=0.7,
        trees_added=8,
        permeable_area_m2=60.0,
        connectivity_score=50.0,
    )
    assert 0.1 <= cooling <= 4.5


# ---------------------------------------------------------------------------
# Stage 3: Multi-Objective Pareto Optimization
# ---------------------------------------------------------------------------
def test_stage3_pareto_optimization(sample_cells, default_weights):
    pareto_res = optimize_pareto(sample_cells, budget=500000.0, weights=default_weights)
    assert pareto_res["status"] == "PARETO_FRONTIER_GENERATED"
    assert pareto_res["pareto_size"] > 0
    assert len(pareto_res["pareto_front"]) > 0
    assert "knee_point" in pareto_res
    assert pareto_res["knee_point"]["total_cost"] <= 500000.0


# ---------------------------------------------------------------------------
# Stage 4: Validation Engine & Greedy Comparator
# ---------------------------------------------------------------------------
def test_stage4_validation_and_greedy_benchmark(sample_cells, default_weights):
    budget = 400000.0
    cpsat_plan = optimize_plan(sample_cells, budget=budget, weights=default_weights)
    greedy_plan = optimize_greedy(sample_cells, budget=budget, weights=default_weights)

    # Validation
    val = validate_plan_constraints(sample_cells, cpsat_plan.selected, budget)
    assert val["valid"] is True
    assert len(val["violations"]) == 0

    # Benchmark calculation
    bench = compute_greedy_benchmark(cpsat_plan.combined_benefit, greedy_plan.combined_benefit)
    assert "efficiency_gain_pct" in bench
    assert cpsat_plan.combined_benefit >= greedy_plan.combined_benefit - 1e-4

    # Uncertainty bounds
    bounds = compute_uncertainty_bounds(cpsat_plan.selected)
    assert "combined_benefit_bounds" in bounds
    assert bounds["combined_benefit_bounds"]["p10_conservative"] < bounds["combined_benefit_bounds"]["p90_optimistic"]


# ---------------------------------------------------------------------------
# Stage 5: Database Models, Human Approval & Monitoring
# ---------------------------------------------------------------------------
def test_stage5_database_models():
    init_db()
    session_factory = get_session_factory()
    with session_factory() as session:
        # Verify tables can be queried
        runs_count = session.query(OptimizationRun).count()
        assert runs_count >= 0
        approvals_count = session.query(HumanApproval).count()
        assert approvals_count >= 0


# ---------------------------------------------------------------------------
# Stage 6: FastAPI Integration Endpoints
# ---------------------------------------------------------------------------
def test_stage6_api_endpoints():
    client = TestClient(app)

    # 1. Health & Meta
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"

    # 2. Optimization endpoint with stage 4 benchmarks
    opt_payload = {
        "studyId": "study-bengaluru-east",
        "budget": 300000.0,
        "weights": {"heat": 35, "vegetation": 25, "pedestrian": 20, "connectivity": 20},
    }
    opt_res = client.post("/api/optimize", json=opt_payload)
    assert opt_res.status_code == 200
    data = opt_res.json()
    assert "runId" in data
    assert "benchmark" in data
    assert "validation" in data
    assert "uncertainty" in data
    assert data["validation"]["valid"] is True

    run_id = data["runId"]

    # 3. Multi-objective Pareto endpoint
    par_res = client.post("/api/pareto", json={"budget": 400000.0})
    assert par_res.status_code == 200
    assert par_res.json()["status"] == "PARETO_FRONTIER_GENERATED"

    # 4. ML Benchmark endpoint
    ml_res = client.get("/api/ml/benchmark")
    assert ml_res.status_code == 200
    assert "benchmark" in ml_res.json()

    # 5. Human-in-the-loop Approval endpoints
    appr_get = client.get(f"/api/approval/{run_id}")
    assert appr_get.status_code == 200
    assert appr_get.json()["approvalStatus"] == "DRAFT"

    appr_post = client.post("/api/approval", json={
        "runId": run_id,
        "status": "APPROVED",
        "approvedBy": "Lead City Climate Officer",
        "notes": "Approved for 2026 Q3 capital works program.",
    })
    assert appr_post.status_code == 200
    assert appr_post.json()["approvalStatus"] == "APPROVED"

    # 6. Run audit trail
    runs_res = client.get("/api/runs")
    assert runs_res.status_code == 200
    assert len(runs_res.json()["runs"]) >= 1

    # 7. Outcome Monitoring
    mon_res = client.get("/api/monitoring/study-bengaluru-east")
    assert mon_res.status_code == 200
    assert len(mon_res.json()["observations"]) >= 1
