"""
EcoGrid AI — Spatial Grid Engine

Generates spatial grid cells using GeoPandas and Shapely.
Handles CRS transformations with PyProj, area calculations in projected CRS,
and outputs GeoJSON for MapLibre rendering.

All demo data is SYNTHETIC and clearly labelled.
"""
from __future__ import annotations

import hashlib
import logging
import math
from typing import Optional

import geopandas as gpd
import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, box, mapping
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

from app.schemas.schemas import (
    CellResponse,
    DataSource,
    DataStatus,
    LandUse,
    ScoreSet,
    SurfaceType,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ROW_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
WGS84 = CRS.from_epsg(4326)
# Default fallback UTM Zone 43N
PROJECTED_CRS = CRS.from_epsg(32643)


def get_projected_crs(origin_lng: float, origin_lat: float) -> CRS:
    """Determine appropriate UTM projected CRS for metric distance and area calculations."""
    zone = int((origin_lng + 180) / 6) + 1
    epsg_code = 32600 + zone if origin_lat >= 0 else 32700 + zone
    try:
        return CRS.from_epsg(epsg_code)
    except Exception:
        return PROJECTED_CRS



def _row_label(index: int) -> str:
    """Generate spreadsheet-style row labels: A, B, ..., Z, AA, AB, ..."""
    remaining = index + 1
    label = ""
    while remaining > 0:
        digit = (remaining - 1) % len(ROW_LABELS)
        label = ROW_LABELS[digit] + label
        remaining = (remaining - 1) // len(ROW_LABELS)
    return label


def _study_seed(study_id: str, default_seed: int = 20261010) -> int:
    """Generate a stable, distinct deterministic seed for each study area."""
    if not study_id or study_id in ["ecogrid-campus-demo", "default"]:
        return default_seed
    return int(hashlib.sha256(study_id.encode("utf-8")).hexdigest()[:8], 16)


def _seeded_rng(seed: int = 20261010):
    """Deterministic seeded random generator using numpy for reproducibility."""
    return np.random.RandomState(seed)


# ---------------------------------------------------------------------------
# Zone definitions by study area
# ---------------------------------------------------------------------------

def _named_zone(row: int, col: int, rows: int, cols: int, study_id: str = "") -> str:
    """Assign descriptive, location-realistic zone names based on study area and coordinates."""
    sid = study_id.lower()

    if "delhi" in sid:
        # New Delhi Central Corridor (Central Vista, Janpath, Connaught Place)
        if 4 <= row <= 5 and 3 <= col <= 6:
            return "Kartavya Path Central Avenue (Zone C)"
        if row <= 1 and 3 <= col <= 6:
            return "Connaught Place Outer Radial (Zone A)"
        if 2 <= row <= 3 and 3 <= col <= 6:
            return "National Museum & Cultural Precinct"
        if 4 <= row <= 6 and col >= 7:
            return "India Gate Hexagon & Radial Canopy"
        if 6 <= row <= 8 and col <= 2:
            return "Janpath Metro & Market Transit Node"
        if 3 <= row <= 5 and col <= 2:
            return "Central Secretariat / Udyog Bhawan Complex"
        if row >= 7 and 3 <= col <= 6:
            return "Central Vista Lawn & Water Canal"
        if row >= 7 and col >= 7:
            return "Shahjahan Road Protected Green Verge"
        if row <= 2 and col <= 2:
            return "Western Court Institutional Campus"
        if row <= 2 and col >= 7:
            return "Barakhamba Commercial Corridor"
        if 5 <= row <= 6 and col <= 2:
            return "Rail Bhawan Transit Verge"
        return "New Delhi Administrative Block"

    if "pimpri" in sid or "bhosari" in sid:
        # Pimpri Industrial Area, Pimpri-Chinchwad (MIDC, Auto Cluster, Pavana River)
        if row <= 1 and 3 <= col <= 6:
            return "MIDC Bhosari Foundry & Metal Stamping Cluster"
        if row <= 2 and col <= 2:
            return "Pune-Nashik Highway Logistics Transit Verge"
        if row <= 2 and col >= 7:
            return "Auto Cluster R&D Test Track"
        if 2 <= row <= 3 and 3 <= col <= 6:
            return "Heavy Industrial Fabrication Yard"
        if 3 <= row <= 5 and col <= 2:
            return "Telco Road Green Buffer"
        if 4 <= row <= 6 and 4 <= col <= 7:
            return "MSETCL 220kV High-Tension Transmission Corridor"
        if 5 <= row <= 7 and col >= 7:
            return "Assembly & Sheet Metal Stamping Facility"
        if 6 <= row <= 7 and col <= 3:
            return "Industrial Worker Canteen & Transit Hub"
        if row >= 8 and col <= 4:
            return "Pavana River Riparian Buffer"
        if row >= 7 and col >= 6:
            return "Spine Road Logistics Terminal"
        return "MIDC Industrial Unit"

    if "mumbai" in sid or "bkc" in sid:
        if 4 <= row <= 6 and 3 <= col <= 6:
            return "BKC Financial G-Block Commercial Promenade"
        if row <= 2 and col <= 3:
            return "Kalanagar Transit Interchange"
        if row >= 7 and col <= 3:
            return "Mithi River Tidal Catchment Verge"
        if row >= 7 and col >= 7:
            return "MMRDA Exhibition Grounds"
        return "BKC Corporate High-Rise Core"

    if "pune" in sid:
        if 4 <= row <= 6 and 3 <= col <= 6:
            return "FC Road Commercial Pedestrian Corridor"
        if row <= 2 and col <= 3:
            return "Shivaji Nagar Metro Transit Hub"
        if row >= 7 and col <= 4:
            return "Mutha Riverfront Green Promenade"
        return "Pune Central Mixed-Use Quarter"

    if "nashik" in sid:
        if 4 <= row <= 6 and 3 <= col <= 6:
            return "Godavari Riverfront Promenade"
        if row <= 2 and col <= 3:
            return "CBS Bus Terminus Transit Corridor"
        if row >= 7 and col >= 6:
            return "Ambad Industrial Estate Edge Buffer"
        return "Nashik Old City Cultural Precinct"

    # Default / Bengaluru East Campus Demo
    if row <= 1 and 3 <= col <= 6:
        return "Hot Parking Area (Zone A)"
    if 2 <= row <= 4 and col <= 2:
        return "North Green Patch (Zone B)"
    if 6 <= row <= 8 and col <= 2:
        return "South Green Patch (Zone B)"
    if 3 <= row <= 6 and 3 <= col <= 6:
        return "Central Walkway (Zone C)"
    if row <= 3 and col >= 7:
        return "East Service Road (Zone D)"
    if 4 <= row <= 6 and col >= 7:
        return "Loading Bay (Zone D)"
    if row >= 7 and 3 <= col <= 6:
        return "Garden Edge (Zone E)"
    if row >= 7 and col >= 7:
        return "Sports Ground"
    if row <= 1 and col <= 2:
        return "North Gate"
    if 5 <= row <= 6 and col <= 2:
        return "Library Corridor"
    return "Academic Block"


def _cell_context(row: int, col: int, rows: int, cols: int, study_id: str = "") -> dict:
    """Determine land use, surface type, and capacity based on position and study area."""
    sid = study_id.lower()

    if "delhi" in sid:
        # Central Vista / Kartavya Path
        if 4 <= row <= 5 and 3 <= col <= 6:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 4}
        # Connaught Place outer radial
        if row <= 1 and 3 <= col <= 6:
            return {"land_use": LandUse.PEDESTRIAN_ZONE, "surface_type": SurfaceType.MIXED, "capacity": 4}
        # National museum / Secretariat buildings
        if (2 <= row <= 3 and 3 <= col <= 6) or (3 <= row <= 5 and col <= 2):
            return {"land_use": LandUse.BUILDING, "surface_type": SurfaceType.BUILDING, "capacity": 0}
        # India Gate lawns
        if 4 <= row <= 6 and col >= 7:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 5}
        # Janpath commercial walkway
        if 6 <= row <= 8 and col <= 2:
            return {"land_use": LandUse.PEDESTRIAN_ZONE, "surface_type": SurfaceType.PAVED, "capacity": 3}
        # Central Vista Canal & Lawns
        if row >= 7 and 3 <= col <= 6:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.SOIL, "capacity": 4}
        # Shahjahan Road
        if row >= 7 and col >= 7:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 5}
        # Roads / Avenues
        if row <= 2 and col >= 7:
            return {"land_use": LandUse.ROAD, "surface_type": SurfaceType.PAVED, "capacity": 2}
        return {"land_use": LandUse.MIXED, "surface_type": SurfaceType.MIXED, "capacity": 3}

    if "pimpri" in sid or "bhosari" in sid:
        # MIDC foundry / fab yards
        if (row <= 1 and 3 <= col <= 6) or (row <= 2 and col >= 7):
            return {"land_use": LandUse.PARKING, "surface_type": SurfaceType.PAVED, "capacity": 3}
        # Highway verge
        if row <= 2 and col <= 2:
            return {"land_use": LandUse.ROAD, "surface_type": SurfaceType.PAVED, "capacity": 2}
        # Industrial fabrication plants
        if (2 <= row <= 3 and 3 <= col <= 6) or (5 <= row <= 7 and col >= 7):
            return {"land_use": LandUse.BUILDING, "surface_type": SurfaceType.BUILDING, "capacity": 0}
        # Telco road green buffer
        if 3 <= row <= 5 and col <= 2:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 4}
        # MSETCL 220kV HT corridor
        if 4 <= row <= 6 and 4 <= col <= 7:
            return {"land_use": LandUse.MIXED, "surface_type": SurfaceType.SOIL, "capacity": 2}
        # Canteen transit hub
        if 6 <= row <= 7 and col <= 3:
            return {"land_use": LandUse.PEDESTRIAN_ZONE, "surface_type": SurfaceType.MIXED, "capacity": 3}
        # Pavana River buffer
        if row >= 8 and col <= 4:
            return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.SOIL, "capacity": 4}
        # Spine road logistics
        if row >= 7 and col >= 6:
            return {"land_use": LandUse.PARKING, "surface_type": SurfaceType.PAVED, "capacity": 4}
        return {"land_use": LandUse.MIXED, "surface_type": SurfaceType.PAVED, "capacity": 2}

    # Default / Bengaluru East Campus Demo
    if row <= 1 and 3 <= col <= 6:
        return {"land_use": LandUse.PARKING, "surface_type": SurfaceType.PAVED, "capacity": 3}
    if (2 <= row <= 4 and col <= 2) or (6 <= row <= 8 and col <= 2):
        return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 5}
    if 3 <= row <= 6 and 3 <= col <= 6:
        return {"land_use": LandUse.PEDESTRIAN_ZONE, "surface_type": SurfaceType.MIXED, "capacity": 4}
    if row <= 3 and col >= 7:
        return {"land_use": LandUse.ROAD, "surface_type": SurfaceType.PAVED, "capacity": 2}
    if 4 <= row <= 6 and col >= 7:
        return {"land_use": LandUse.PARKING, "surface_type": SurfaceType.PAVED, "capacity": 3}
    if row >= 7 and 3 <= col <= 6:
        return {"land_use": LandUse.GREEN_SPACE, "surface_type": SurfaceType.GREEN, "capacity": 5}
    if row >= 7 and col >= 7:
        return {"land_use": LandUse.SPORTS, "surface_type": SurfaceType.MIXED, "capacity": 3}
    if 2 <= row <= 3 and 3 <= col <= 6:
        return {"land_use": LandUse.BUILDING, "surface_type": SurfaceType.BUILDING, "capacity": 0}
    if row <= 1 and col <= 2:
        return {"land_use": LandUse.PEDESTRIAN_ZONE, "surface_type": SurfaceType.MIXED, "capacity": 4}
    if 5 <= row <= 6 and col <= 2:
        return {"land_use": LandUse.RESIDENTIAL, "surface_type": SurfaceType.MIXED, "capacity": 3}
    return {"land_use": LandUse.MIXED, "surface_type": SurfaceType.MIXED, "capacity": 3}


def _clamp(val: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, val))


# ---------------------------------------------------------------------------
# Environmental score generation (SYNTHETIC DEMO DATA)
# ---------------------------------------------------------------------------

def _generate_scores(row: int, col: int, rows: int, cols: int, context: dict, rng) -> ScoreSet:
    """
    Generate coherent synthetic environmental scores.
    
    Scores are on a 0-100 normalized scale.
    These are NOT measured values — they are synthetic demo patterns.
    """
    land_use = context["land_use"]
    surface = context["surface_type"]

    # Heat score: higher near paved areas, lower near green
    urban_heat = 20 if surface == SurfaceType.PAVED else (-18 if surface == SurfaceType.GREEN else 0)
    heat = _clamp(28 + (row / max(1, rows - 1)) * 30 + urban_heat + (rng.random() - 0.5) * 25)

    # Vegetation deficit: higher in built/paved areas
    veg_factor = 15 if surface == SurfaceType.PAVED else (-20 if surface == SurfaceType.GREEN else 0)
    vegetation = _clamp(55 + veg_factor + (rng.random() - 0.5) * 28)

    # Pedestrian exposure: higher in plazas, walkways, roads
    ped_factor = 20 if land_use in [LandUse.PLAZA, LandUse.PEDESTRIAN_ZONE, LandUse.ROAD] else (
        -8 if land_use == LandUse.BUILDING else 0
    )
    pedestrian = _clamp(35 + ped_factor + (rng.random() - 0.5) * 34)

    # Connectivity gap: higher where green is fragmented
    conn_factor = -16 if surface == SurfaceType.GREEN else 6
    connectivity = _clamp(42 + conn_factor + (rng.random() - 0.5) * 50)

    # Feasibility: lower for buildings, paved surfaces
    if context["capacity"] == 0:
        feasibility = 8
    else:
        feas_penalty = -62 if surface == SurfaceType.BUILDING else (-16 if surface == SurfaceType.PAVED else 0)
        feasibility = _clamp(90 + feas_penalty + (rng.random() - 0.5) * 18)

    return ScoreSet(
        heat_score=round(heat, 1),
        vegetation_deficit=round(vegetation, 1),
        pedestrian_exposure=round(pedestrian, 1),
        connectivity_gap=round(connectivity, 1),
        feasibility_score=round(feasibility, 1),
    )


# ---------------------------------------------------------------------------
# Grid generation with GeoPandas + Shapely
# ---------------------------------------------------------------------------

def generate_study_area_boundary(
    origin_lat: float,
    origin_lng: float,
    rows: int,
    cols: int,
    cell_size_lat: float,
    cell_size_lng: float,
) -> Polygon:
    """Generate the study area boundary polygon."""
    min_lat = origin_lat
    max_lat = origin_lat + rows * cell_size_lat
    min_lng = origin_lng
    max_lng = origin_lng + cols * cell_size_lng
    return box(min_lng, min_lat, max_lng, max_lat)


def generate_grid(
    study_id: str = "ecogrid-campus-demo",
    name: str = "EcoGrid Campus Demo",
    origin_lat: float = 12.9352,
    origin_lng: float = 77.6245,
    rows: int = 10,
    cols: int = 10,
    cell_size_lat: float = 0.0012,
    cell_size_lng: float = 0.0012,
    seed: int = 20261010,
) -> list[CellResponse]:
    """
    Generate spatial grid cells using GeoPandas and Shapely.
    
    1. Creates the study-area boundary
    2. Generates grid cells of configurable dimensions
    3. Clips cells to the boundary
    4. Assigns stable unique IDs (e.g., A01, B05)
    5. Calculates area in projected CRS
    6. Generates coherent synthetic environmental features
    7. Returns cells ready for GeoJSON conversion

    All data is SYNTHETIC / DEMO.
    """
    actual_seed = _study_seed(study_id, seed) if seed == 20261010 else seed
    rng = _seeded_rng(actual_seed)

    # Generate study area boundary
    boundary = generate_study_area_boundary(
        origin_lat, origin_lng, rows, cols, cell_size_lat, cell_size_lng
    )

    # Set up CRS transformer for area calculations in appropriate UTM projection
    target_crs = get_projected_crs(origin_lng, origin_lat)
    transformer_to_proj = Transformer.from_crs(WGS84, target_crs, always_xy=True)
    transformer_to_geo = Transformer.from_crs(target_crs, WGS84, always_xy=True)

    cells: list[CellResponse] = []
    half_lat = cell_size_lat / 2
    half_lng = cell_size_lng / 2

    for row in range(rows):
        for col in range(cols):
            # Cell center in geographic coordinates
            center_lat = origin_lat + (row + 0.5) * cell_size_lat
            center_lng = origin_lng + (col + 0.5) * cell_size_lng

            # Cell corners (closed polygon)
            corners = [
                (center_lng - half_lng, center_lat - half_lat),  # SW
                (center_lng + half_lng, center_lat - half_lat),  # SE
                (center_lng + half_lng, center_lat + half_lat),  # NE
                (center_lng - half_lng, center_lat + half_lat),  # NW
                (center_lng - half_lng, center_lat - half_lat),  # close
            ]
            cell_polygon = Polygon(corners)

            # Clip to study area boundary
            clipped = cell_polygon.intersection(boundary)
            if clipped.is_empty:
                continue

            # Calculate area in projected CRS (m²)
            proj_coords = [transformer_to_proj.transform(x, y) for x, y in corners]
            proj_polygon = Polygon(proj_coords)
            area_m2 = proj_polygon.area

            # Generate cell ID
            cell_id = f"{_row_label(row)}{str(col + 1).padStart(2, '0') if hasattr(str, 'padStart') else str(col + 1).zfill(2)}"

            # Get zone context
            context = _cell_context(row, col, rows, cols, study_id=study_id)
            zone_name = _named_zone(row, col, rows, cols, study_id=study_id)

            # Generate environmental scores
            scores = _generate_scores(row, col, rows, cols, context, rng)

            # Calculate derived indicators
            surface = context["surface_type"]
            land_use = context["land_use"]

            green_ratio = (
                0.7 + rng.random() * 0.25 if surface == SurfaceType.GREEN
                else 0.05 + rng.random() * 0.15
            )
            built_ratio = (
                0.85 + rng.random() * 0.1 if surface == SurfaceType.BUILDING
                else (0.4 + rng.random() * 0.2 if surface == SurfaceType.PAVED else 0.1 + rng.random() * 0.2)
            )
            available_area = area_m2 * (1 - built_ratio) * (context["capacity"] / 5)

            # Tree suitability baseline heuristic (refined by champion ML pipeline below)
            tree_suit = 0.0
            if surface in [SurfaceType.SOIL, SurfaceType.GREEN, SurfaceType.MIXED]:
                tree_suit = scores.feasibility_score * 0.4 + scores.heat_score * 0.3 + (1.0 - built_ratio) * 30.0
            tree_suit = _clamp(tree_suit)

            # Priority zone flag
            is_priority = scores.heat_score >= 68 or scores.pedestrian_exposure >= 72

            # Convert polygon to [[lat, lng], ...] for frontend
            polygon_coords = [[y, x] for x, y in corners]

            cells.append(CellResponse(
                cell_id=cell_id,
                study_area_id=study_id,
                row=row,
                col=col,
                center=[center_lat, center_lng],
                polygon=polygon_coords,
                area_name=zone_name,
                land_use=land_use,
                surface_type=surface,
                scores=scores,
                tree_suitability=round(tree_suit, 1),
                green_space_ratio=round(green_ratio, 3),
                built_surface_ratio=round(built_ratio, 3),
                available_area=round(available_area, 1),
                existing_green_cover=round(green_ratio, 3),
                priority_zone=is_priority,
                data_source=DataSource.SYNTHETIC,
                data_status=DataStatus.DEMO,
                capacity=context["capacity"],
            ))

    # Step A: Apply real geospatial data ingestion (Sentinel-2, Landsat, OSM/Cadastral vectors) if available
    try:
        from app.gis.real_ingestion import real_geospatial_pipeline
        if real_geospatial_pipeline.has_study_data(study_id, study_name=name, lat=origin_lat, lng=origin_lng):
            ingest_res = real_geospatial_pipeline.ingest_and_apply(cells, study_id=study_id, study_name=name)
            logger.info("Real geospatial data applied for %s (%s): %s", study_id, name, ingest_res)
    except Exception as e:
        logger.warning("Could not apply real geospatial pipeline for %s: %s", study_id, e)

    # Step B: Enhance cells directly with champion ML Tree Suitability predictions
    try:
        from app.ml.tree_suitability import predict_tree_suitability
        ml_preds = predict_tree_suitability(cells)
        for i, pred in enumerate(ml_preds):
            cells[i].tree_suitability = pred["ml_suitability"]
    except Exception as e:
        logger.warning("Could not execute ML tree suitability on generated grid cells: %s", e)

    return cells


def cells_to_geojson(cells: list[CellResponse]) -> dict:
    """Convert cells to GeoJSON FeatureCollection for MapLibre."""
    features = []
    for cell in cells:
        # Polygon coordinates: [[lng, lat], ...] for GeoJSON
        coords = [[pt[1], pt[0]] for pt in cell.polygon]
        feature = {
            "type": "Feature",
            "id": cell.cell_id,
            "properties": {
                "cell_id": cell.cell_id,
                "area_name": cell.area_name,
                "land_use": cell.land_use.value,
                "surface_type": cell.surface_type.value,
                "heat_score": cell.scores.heat_score,
                "vegetation_deficit": cell.scores.vegetation_deficit,
                "pedestrian_exposure": cell.scores.pedestrian_exposure,
                "connectivity_gap": cell.scores.connectivity_gap,
                "feasibility_score": cell.scores.feasibility_score,
                "tree_suitability": cell.tree_suitability,
                "green_space_ratio": cell.green_space_ratio,
                "built_surface_ratio": cell.built_surface_ratio,
                "available_area": cell.available_area,
                "priority_zone": cell.priority_zone,
                "capacity": cell.capacity,
                "data_source": cell.data_source.value,
                "data_status": cell.data_status.value,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "name": "EcoGrid Campus Demo — SYNTHETIC DATA",
        "features": features,
    }


def cells_to_geodataframe(cells: list[CellResponse]) -> gpd.GeoDataFrame:
    """Convert cells to a GeoDataFrame for spatial analysis."""
    records = []
    for cell in cells:
        coords = [(pt[1], pt[0]) for pt in cell.polygon]  # (lng, lat)
        geom = Polygon(coords)
        records.append({
            "cell_id": cell.cell_id,
            "row": cell.row,
            "col": cell.col,
            "area_name": cell.area_name,
            "land_use": cell.land_use.value,
            "surface_type": cell.surface_type.value,
            "heat_score": cell.scores.heat_score,
            "vegetation_deficit": cell.scores.vegetation_deficit,
            "pedestrian_exposure": cell.scores.pedestrian_exposure,
            "connectivity_gap": cell.scores.connectivity_gap,
            "feasibility_score": cell.scores.feasibility_score,
            "geometry": geom,
        })
    return gpd.GeoDataFrame(records, geometry="geometry", crs=WGS84)
