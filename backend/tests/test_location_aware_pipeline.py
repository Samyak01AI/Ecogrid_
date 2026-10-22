"""
EcoGrid AI — Location-Aware Pipeline & Comparative Integration Tests
Validates Scenario A (New Delhi Central Corridor) vs Scenario B (Pimpri Industrial Area).
Verifies that each location uses its own genuine geospatial data, ML predictions,
candidate feasibility constraints, and OR-Tools CP-SAT optimization outputs.
"""
import hashlib
import json
import logging
import numpy as np
import pytest

from app.gis.grid_engine import generate_grid
from app.gis.real_ingestion import real_geospatial_pipeline
from app.ml.tree_suitability import predict_tree_suitability, evaluate_tree_safety_and_feasibility
from app.optimization.optimizer import optimize_plan, _generate_candidates
from app.schemas.schemas import DataStatus, DataSource, InterventionId, ScoreWeights

logger = logging.getLogger(__name__)


def compute_feature_fingerprint(cells) -> str:
    """Computes a cryptographic SHA256 checksum of the cell feature table."""
    data = []
    for c in cells:
        data.append({
            "id": c.cell_id,
            "center": [round(c.center[0], 5), round(c.center[1], 5)],
            "heat": round(c.scores.heat_score, 2),
            "veg": round(c.scores.vegetation_deficit, 2),
            "ped": round(c.scores.pedestrian_exposure, 2),
            "conn": round(c.scores.connectivity_gap, 2),
            "feas": round(c.scores.feasibility_score, 2),
            "suit": round(c.tree_suitability, 2),
            "flags": sorted(getattr(c, "provenance_flags", [])),
        })
    dump = json.dumps(data, sort_keys=True)
    return hashlib.sha256(dump.encode("utf-8")).hexdigest()


class TestLocationAwarePipeline:

    @pytest.fixture(scope="class")
    def delhi_pipeline(self):
        """Execute full Scenario A pipeline: New Delhi Central Corridor."""
        study_id = "study-delhi"
        name = "New Delhi Central Corridor"
        origin_lat = 28.6139
        origin_lng = 77.2090
        budget = 100000.0
        weights = ScoreWeights(w_heat=30, w_greenery=25, w_pedestrian=25, w_connectivity=20, w_biodiversity=0)

        # 1. Generate grid and apply real geospatial ingestion
        cells = generate_grid(study_id=study_id, name=name, origin_lat=origin_lat, origin_lng=origin_lng, rows=10, cols=10)

        # 2. Extract ML tree suitability
        ml_preds = predict_tree_suitability(cells)
        for i, pred in enumerate(ml_preds):
            cells[i].tree_suitability = pred["ml_suitability"]

        # 3. Generate candidate interventions
        feasible, rejected = _generate_candidates(cells, weights)

        # 4. Run OR-Tools CP-SAT optimizer
        plan = optimize_plan(cells=cells, budget=budget, weights=weights)

        return {
            "study_id": study_id,
            "name": name,
            "origin": [origin_lat, origin_lng],
            "cells": cells,
            "fingerprint": compute_feature_fingerprint(cells),
            "feasible_candidates": feasible,
            "rejected_candidates": rejected,
            "plan": plan,
            "budget": budget,
            "weights": weights,
        }

    @pytest.fixture(scope="class")
    def pimpri_pipeline(self):
        """Execute full Scenario B pipeline: Pimpri Industrial Area, Pimpri-Chinchwad."""
        study_id = "study-pimpri"
        name = "Pimpri Industrial Area, Pimpri-Chinchwad"
        origin_lat = 18.6250
        origin_lng = 73.7900
        budget = 100000.0
        weights = ScoreWeights(w_heat=30, w_greenery=25, w_pedestrian=25, w_connectivity=20, w_biodiversity=0)

        # 1. Generate grid and apply real geospatial ingestion
        cells = generate_grid(study_id=study_id, name=name, origin_lat=origin_lat, origin_lng=origin_lng, rows=10, cols=10)

        # 2. Extract ML tree suitability
        ml_preds = predict_tree_suitability(cells)
        for i, pred in enumerate(ml_preds):
            cells[i].tree_suitability = pred["ml_suitability"]

        # 3. Generate candidate interventions
        feasible, rejected = _generate_candidates(cells, weights)

        # 4. Run OR-Tools CP-SAT optimizer
        plan = optimize_plan(cells=cells, budget=budget, weights=weights)

        return {
            "study_id": study_id,
            "name": name,
            "origin": [origin_lat, origin_lng],
            "cells": cells,
            "fingerprint": compute_feature_fingerprint(cells),
            "feasible_candidates": feasible,
            "rejected_candidates": rejected,
            "plan": plan,
            "budget": budget,
            "weights": weights,
        }

    def test_scenario_a_delhi_validations(self, delhi_pipeline):
        """Scenario A: Verify Delhi-specific properties and constraints."""
        cells = delhi_pipeline["cells"]
        plan = delhi_pipeline["plan"]

        assert len(cells) == 100
        assert all(c.study_area_id == "study-delhi" for c in cells)
        assert cells[0].data_status == DataStatus.VALIDATED
        assert cells[0].data_source == DataSource.SATELLITE
        assert "EMPIRICAL_INGESTION" in cells[0].provenance_flags

        # Central Vista Water Canal cells must have WATER_BODY_VETO
        water_cells = [c for c in cells if "WATER_BODY_VETO" in getattr(c, "provenance_flags", [])]
        assert len(water_cells) > 0, "Delhi must detect Central Vista water canal"
        for wc in water_cells:
            assert wc.capacity == 0
            assert wc.scores.feasibility_score == 0.0

        # Heritage restricted cells (Rashtrapati Bhavan / Central Vista)
        heritage_cells = [c for c in cells if "HERITAGE_RESTRICTION" in getattr(c, "provenance_flags", [])]
        assert len(heritage_cells) > 0, "Delhi must detect Central Vista heritage corridor"

        # Check solver result
        assert plan.solver_status in ["OPTIMAL", "FEASIBLE"]
        assert plan.total_cost <= delhi_pipeline["budget"]
        assert plan.cells_improved > 0

        # ZERO interventions must be placed on water canal cells
        water_ids = {wc.cell_id for wc in water_cells}
        for sel in plan.selected:
            assert sel.cell_id not in water_ids, f"Intervention placed on water cell {sel.cell_id}"

    def test_scenario_b_pimpri_validations(self, pimpri_pipeline):
        """Scenario B: Verify Pimpri-specific properties and constraints."""
        cells = pimpri_pipeline["cells"]
        plan = pimpri_pipeline["plan"]

        assert len(cells) == 100
        assert all(c.study_area_id == "study-pimpri" for c in cells)
        assert cells[0].data_status == DataStatus.VALIDATED
        assert cells[0].data_source == DataSource.SATELLITE
        assert "EMPIRICAL_INGESTION" in cells[0].provenance_flags

        # Pavana River riparian cells must have WATER_BODY_VETO
        water_cells = [c for c in cells if "WATER_BODY_VETO" in getattr(c, "provenance_flags", [])]
        assert len(water_cells) > 0, "Pimpri must detect Pavana River riparian channel"

        # 220kV High-Tension transmission corridor
        ht_cells = [c for c in cells if "OVERHEAD_HT_RESTRICTION" in getattr(c, "provenance_flags", [])]
        assert len(ht_cells) > 0, "Pimpri must detect MSETCL 220kV HT transmission corridor"

        # In HT cells, trees and tall structures must be prohibited
        ht_cell_ids = {c.cell_id for c in ht_cells}
        for sel in plan.selected:
            if sel.cell_id in ht_cell_ids:
                assert sel.intervention_id not in [InterventionId.NATIVE_TREES, InterventionId.SHADE_STRUCTURE], \
                    f"Forbidden tree/shade placed in 220kV HT corridor cell {sel.cell_id}"

        # Check solver result
        assert plan.solver_status in ["OPTIMAL", "FEASIBLE"]
        assert plan.total_cost <= pimpri_pipeline["budget"]
        assert plan.cells_improved > 0

    def test_delhi_vs_pimpri_distinct_feature_distributions(self, delhi_pipeline, pimpri_pipeline):
        """Verify that Delhi and Pimpri feature tables are completely independent and non-identical."""
        delhi_cells = delhi_pipeline["cells"]
        pimpri_cells = pimpri_pipeline["cells"]

        # 1. Feature table fingerprints must NOT match
        assert delhi_pipeline["fingerprint"] != pimpri_pipeline["fingerprint"], \
            "Critical failure: Delhi and Pimpri produced identical feature fingerprints!"

        # 2. Check coordinates are separated by hundreds of kilometers
        assert abs(delhi_cells[0].center[0] - pimpri_cells[0].center[0]) > 8.0, "Latitudes must differ (~28.6°N vs ~18.6°N)"
        assert abs(delhi_cells[0].center[1] - pimpri_cells[0].center[1]) > 2.0, "Longitudes must differ (~77.2°E vs ~73.8°E)"

        # 3. Statistical distribution comparisons
        delhi_heat = np.array([c.scores.heat_score for c in delhi_cells])
        pimpri_heat = np.array([c.scores.heat_score for c in pimpri_cells])
        delhi_ped = np.array([c.scores.pedestrian_exposure for c in delhi_cells])
        pimpri_ped = np.array([c.scores.pedestrian_exposure for c in pimpri_cells])
        delhi_veg = np.array([c.scores.vegetation_deficit for c in delhi_cells])
        pimpri_veg = np.array([c.scores.vegetation_deficit for c in pimpri_cells])

        # Mean and standard deviation checks
        assert not np.isclose(delhi_heat.mean(), pimpri_heat.mean(), atol=0.5), \
            f"Heat means should differ: Delhi={delhi_heat.mean():.2f}, Pimpri={pimpri_heat.mean():.2f}"
        assert not np.isclose(delhi_ped.mean(), pimpri_ped.mean(), atol=1.0), \
            f"Pedestrian exposure means should differ: Delhi={delhi_ped.mean():.2f}, Pimpri={pimpri_ped.mean():.2f}"
        assert not np.isclose(delhi_veg.mean(), pimpri_veg.mean(), atol=0.5), \
            f"Vegetation deficit means should differ: Delhi={delhi_veg.mean():.2f}, Pimpri={pimpri_veg.mean():.2f}"

    def test_delhi_vs_pimpri_distinct_optimization_solutions(self, delhi_pipeline, pimpri_pipeline):
        """Verify that Delhi and Pimpri OR-Tools optimization solutions are NOT identical mock arrays."""
        delhi_plan = delhi_pipeline["plan"]
        pimpri_plan = pimpri_pipeline["plan"]

        delhi_selected = delhi_plan.selected
        pimpri_selected = pimpri_plan.selected

        # Compare intervention portfolios
        delhi_summary = delhi_plan.intervention_summary
        pimpri_summary = pimpri_plan.intervention_summary

        # Check total costs
        print(f"\n[DIAGNOSTIC] Delhi Total Cost: INR {delhi_plan.total_cost:,.2f} | Pimpri Total Cost: INR {pimpri_plan.total_cost:,.2f}")
        print(f"[DIAGNOSTIC] Delhi Cells Improved: {delhi_plan.cells_improved} | Pimpri Cells Improved: {pimpri_plan.cells_improved}")
        print(f"[DIAGNOSTIC] Delhi Selected Count: {len(delhi_selected)} | Pimpri Selected Count: {len(pimpri_selected)}")
        print(f"[DIAGNOSTIC] Delhi Summary: {delhi_summary}")
        print(f"[DIAGNOSTIC] Pimpri Summary: {pimpri_summary}")

        # The solution sets must not be an identical copy
        assert delhi_plan.combined_benefit != pimpri_plan.combined_benefit, "Combined benefits must not be identical"
        assert delhi_plan.total_cost != pimpri_plan.total_cost or len(delhi_selected) != len(pimpri_selected) or delhi_summary != pimpri_summary, \
            "Optimization results are identical copies across Delhi and Pimpri!"
