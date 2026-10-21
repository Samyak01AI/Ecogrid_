"""
Tests for Computer Vision Satellite Surface Segmentation Service
"""
import pytest
from app.cv.satellite_segmentation import (
    lat_lng_to_tile,
    tile_ground_resolution_m_per_px,
    generate_realistic_synthetic_satellite_tile,
    segment_satellite_image,
    render_segmentation_mask,
    analyze_cell_satellite_cv,
)


def test_tile_coordinates():
    # Bengaluru coordinates
    lat, lng = 12.9352, 77.6245
    x, y = lat_lng_to_tile(lat, lng, zoom=18)
    assert isinstance(x, int)
    assert isinstance(y, int)
    assert x > 0 and y > 0

    res = tile_ground_resolution_m_per_px(lat, zoom=18)
    # At zoom 18 near equator/13 deg, res should be ~0.5 - 0.6 m/pixel
    assert 0.4 < res < 0.7


def test_segment_synthetic_tile():
    tile = generate_realistic_synthetic_satellite_tile(12.9352, 77.6245, size=128)
    assert tile.size == (128, 128)

    mask, stats = segment_satellite_image(tile)
    assert mask.shape == (128, 128)
    # Check that percentages sum close to 100%
    total_pct = sum(stats.values())
    assert 99.5 <= total_pct <= 100.5

    # Check mask rendering
    rendered = render_segmentation_mask(mask)
    assert rendered.size == (128, 128)
    assert rendered.mode == "RGBA"


@pytest.mark.asyncio
async def test_analyze_cell_satellite_cv():
    result = await analyze_cell_satellite_cv(
        study_id="study-bengaluru-east",
        cell_id="cell-0-0",
        lat=12.9352,
        lng=77.6245,
        zoom=18,
    )
    assert result["status"] == "success"
    assert result["cellId"] == "cell-0-0"
    assert "surfaceBreakdown" in result
    assert "images" in result
    assert result["images"]["satellite"].startswith("data:image/")
    assert result["images"]["segmentationMask"].startswith("data:image/")
    assert result["images"]["blended"].startswith("data:image/")
    assert result["totalAreaSqm"] > 0
    assert result["permeableAreaSqm"] >= 0
    assert result["plantingCapacityTrees"] >= 0
