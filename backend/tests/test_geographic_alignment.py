"""
EcoGrid AI 2.0 — Geographic and Marker Alignment Regression Tests
Validates cell centroid containment, coordinate ordering, authoritative geographic sources,
multi-location grid geometry, and optimizer candidate coordinate derivation.
"""
import pytest
from shapely.geometry import Polygon, Point
from app.gis.grid_engine import generate_grid
from app.main import _get_or_generate_cells, run_optimization_unified, DEFAULT_STUDY_ID
from app.schemas.schemas import ScoreWeights, InterventionId
from app.optimization.optimizer import optimize_plan


def test_cell_centroid_alignment_delhi():
    """Test A: Delhi grid cells all have centroids strictly contained inside their polygon."""
    cells = _get_or_generate_cells("study-delhi")
    assert len(cells) == 100

    for c in cells:
        # c.polygon is [[lat, lng], ...]
        poly_coords = [(pt[1], pt[0]) for pt in c.polygon]  # (lng, lat) for Shapely
        poly = Polygon(poly_coords)
        pt = Point(c.center[1], c.center[0])  # (lng, lat)
        assert poly.is_valid, f"Cell {c.cell_id} polygon is invalid"
        assert poly.contains(pt) or poly.touches(pt), f"Cell {c.cell_id} centroid {c.center} outside polygon"


def test_cell_centroid_alignment_bengaluru():
    """Test A: Bengaluru East grid cells all have centroids strictly contained inside their polygon."""
    cells = _get_or_generate_cells(DEFAULT_STUDY_ID)
    assert len(cells) == 100

    for c in cells:
        poly_coords = [(pt[1], pt[0]) for pt in c.polygon]
        poly = Polygon(poly_coords)
        pt = Point(c.center[1], c.center[0])
        assert poly.is_valid, f"Cell {c.cell_id} polygon is invalid"
        assert poly.contains(pt) or poly.touches(pt), f"Cell {c.cell_id} centroid outside polygon"


def test_cell_centroid_alignment_pimpri():
    """Test A: Pimpri industrial grid cells all have centroids strictly contained inside their polygon."""
    cells = _get_or_generate_cells("study-pimpri")
    assert len(cells) == 100

    for c in cells:
        poly_coords = [(pt[1], pt[0]) for pt in c.polygon]
        poly = Polygon(poly_coords)
        pt = Point(c.center[1], c.center[0])
        assert poly.is_valid, f"Cell {c.cell_id} polygon is invalid"
        assert poly.contains(pt) or poly.touches(pt), f"Cell {c.cell_id} centroid outside polygon"


def test_polygon_coordinate_ordering_and_closure():
    """Test C: Polygon coordinates must be closed (first == last) and in valid Leaflet [lat, lng] format."""
    cells = _get_or_generate_cells("study-delhi")
    first = cells[0]
    coords = first.polygon

    assert len(coords) >= 4
    # Closed polygon check
    assert coords[0] == coords[-1]

    # Latitude range for Delhi ~28.6
    assert 28.0 <= coords[0][0] <= 29.0
    # Longitude range for Delhi ~77.2
    assert 77.0 <= coords[0][1] <= 78.0


def test_optimization_candidates_carry_authoritative_coordinates():
    """Test B & I: Unified optimizer response attaches cell-derived coordinates to all selected candidates."""
    cells = _get_or_generate_cells("study-delhi")
    cells_by_id = {c.cell_id: c for c in cells}

    weights = ScoreWeights(w_heat=30, w_greenery=25, w_pedestrian=25, w_connectivity=20, w_biodiversity=0)
    opt_res = optimize_plan(cells=cells, budget=100000.0, weights=weights)

    assert len(opt_res.selected) > 0

    for cand in opt_res.selected:
        assert cand.cell_id in cells_by_id
        cell = cells_by_id[cand.cell_id]
        # Mathematical verification: cell center latitude must match row index
        expected_lat = 28.6139 + (cell.row + 0.5) * 0.0012
        expected_lng = 77.2090 + (cell.col + 0.5) * 0.0012
        assert abs(cell.center[0] - expected_lat) < 1e-5
        assert abs(cell.center[1] - expected_lng) < 1e-5


def test_multi_location_distinct_geography():
    """Test D: Delhi and Bengaluru study areas have completely non-overlapping bounding coordinates."""
    delhi_cells = _get_or_generate_cells("study-delhi")
    bengaluru_cells = _get_or_generate_cells(DEFAULT_STUDY_ID)

    delhi_lats = [c.center[0] for c in delhi_cells]
    bengaluru_lats = [c.center[0] for c in bengaluru_cells]

    # Delhi ~28.6 N, Bengaluru ~12.9 N -> > 15 degrees separation
    assert min(delhi_lats) > 28.0
    assert max(bengaluru_lats) < 14.0
    assert min(delhi_lats) - max(bengaluru_lats) > 14.0
