"""
EcoGrid AI — Automated Tests for Real Geospatial Data Ingestion Pipeline
"""
import pytest
from shapely.geometry import Polygon

from app.gis.grid_engine import generate_grid
from app.gis.real_ingestion import GeoTIFFRaster, VectorLayer, real_geospatial_pipeline
from app.optimization.optimizer import optimize_plan
from app.schemas.schemas import DataStatus, DataSource, ScoreWeights


def test_geotiff_raster_georeferencing(tmp_path):
    """Test GeoTIFF georeferencing, tiepoints, and zonal polygon statistics."""
    from app.gis.seed_real_datasets import create_geotiff
    import numpy as np

    arr = np.array([[10.0, 20.0], [30.0, 40.0]], dtype=np.float32)
    tif_path = tmp_path / "test_geo.tif"
    create_geotiff(tif_path, arr, origin_lng=76.20, origin_lat=10.00, pixel_scale_deg=0.01)

    raster = GeoTIFFRaster(tif_path)
    assert raster.is_valid
    assert raster.origin_lng == 76.20
    assert raster.origin_lat == 10.00

    # Point inside pixel (row 0, col 0)
    val = raster.sample_point(lat=9.995, lng=76.205)
    assert val is not None
    assert round(val, 1) == 10.0

    # Zonal statistics over polygon covering the whole raster
    poly = Polygon([[76.20, 9.98], [76.22, 9.98], [76.22, 10.00], [76.20, 10.00]])
    stats = raster.zonal_stats(poly)
    assert stats["count"] == 4.0
    assert stats["mean"] == 25.0
    assert stats["min"] == 10.0
    assert stats["max"] == 40.0


def test_vector_layer_intersection(tmp_path):
    """Test GeoJSON vector loading and polygon intersection."""
    import json
    vec_path = tmp_path / "water.geojson"
    data = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[76.0, 9.0], [76.5, 9.0], [76.5, 9.5], [76.0, 9.5], [76.0, 9.0]]]
            }
        }]
    }
    with open(vec_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    vec = VectorLayer("test_water", vec_path)
    inside_poly = Polygon([[76.1, 9.1], [76.2, 9.1], [76.2, 9.2], [76.1, 9.2]])
    outside_poly = Polygon([[77.0, 10.0], [77.1, 10.0], [77.1, 10.1], [77.0, 10.1]])

    assert vec.intersects(inside_poly)
    assert not vec.intersects(outside_poly)
    assert vec.intersection_ratio(inside_poly) == 1.0


def test_kochi_real_geospatial_ingestion():
    """Verify real geospatial ingestion on Kochi grid cells."""
    cells = generate_grid(study_id="kerala-kochi", origin_lat=9.940, origin_lng=76.265, rows=10, cols=10)
    assert len(cells) == 100

    # Check that data status is marked VALIDATED and SATELLITE
    assert cells[0].data_status == DataStatus.VALIDATED
    assert cells[0].data_source == DataSource.SATELLITE
    assert "EMPIRICAL_INGESTION" in cells[0].provenance_flags

    # Water cells in Mattancherry channel should be flagged with WATER_BODY_VETO
    water_cells = [c for c in cells if "WATER_BODY_VETO" in getattr(c, "provenance_flags", [])]
    assert len(water_cells) > 0
    for wc in water_cells:
        assert wc.capacity == 0
        assert wc.scores.feasibility_score == 0.0


def test_optimizer_strictly_excludes_water_cells():
    """Verify that OR-Tools CP-SAT optimizer places ZERO interventions on water cells."""
    cells = generate_grid(study_id="kerala-kochi", origin_lat=9.940, origin_lng=76.265, rows=10, cols=10)
    plan = optimize_plan(cells, budget=50000.0, weights=ScoreWeights())

    assert plan.solver_status == "OPTIMAL"
    assert plan.total_cost <= 50000.0

    water_cids = {c.cell_id for c in cells if c.capacity == 0 or "Water" in c.area_name}
    for cand in plan.selected:
        assert cand.cell_id not in water_cids, f"Intervention placed on water cell {cand.cell_id}!"


def test_synthetic_fallback_for_unmapped_study():
    """Verify that unmapped study areas fallback gracefully to DEMO status."""
    cells = generate_grid(study_id="unmapped-desert-region-xyz", origin_lat=26.0, origin_lng=71.0, rows=4, cols=4)
    assert len(cells) == 16
    assert cells[0].data_status == DataStatus.DEMO
    assert cells[0].data_source == DataSource.SYNTHETIC
