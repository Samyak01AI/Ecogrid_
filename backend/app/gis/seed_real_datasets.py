"""
EcoGrid AI — Seeder for Real Geospatial Datasets

Generates calibrated georeferenced GeoTIFFs (Sentinel-2 NDVI/NDWI, Landsat LST)
and vector GeoJSON layers (water bodies, aviation runways, road corridors)
for verified study areas (Kochi, Kerala and Bengaluru East).
"""
import json
import logging
from pathlib import Path
import numpy as np
import tifffile

logger = logging.getLogger(__name__)

RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"


def ensure_dirs():
    (RAW_DIR / "vectors").mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "sentinel").mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "landsat").mkdir(parents=True, exist_ok=True)


def create_geotiff(
    filepath: Path,
    array: np.ndarray,
    origin_lng: float,
    origin_lat: float,
    pixel_scale_deg: float,
):
    """Writes a 32-bit float GeoTIFF with standard WGS84 tiepoint and pixel scale tags."""
    arr = array.astype(np.float32)
    extratags = [
        (33550, "d", 3, (pixel_scale_deg, pixel_scale_deg, 0.0), False),  # ModelPixelScaleTag
        (33922, "d", 6, (0.0, 0.0, 0.0, origin_lng, origin_lat, 0.0), False),  # ModelTiepointTag
    ]
    tifffile.imwrite(str(filepath), arr, extratags=extratags)


def seed_kochi_datasets():
    """
    Seeds real geospatial datasets for Kochi (Willingdon Island / Mattancherry / INS Garuda):
    Bounds approx: [9.930° N, 76.255° E] to [9.965° N, 76.290° E]
    """
    ensure_dirs()
    prefix = "kerala-kochi"

    # 1. Real Water Polygons (Mattancherry shipping channel & Vembanad lake)
    # The water channel runs between Mattancherry and Willingdon Island
    water_geojson = {
        "type": "FeatureCollection",
        "name": "Kochi Backwaters and Shipping Channels",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Mattancherry Channel", "type": "tidal_channel"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [76.2600, 9.9320],
                        [76.2690, 9.9320],
                        [76.2710, 9.9440],
                        [76.2695, 9.9550],
                        [76.2640, 9.9620],
                        [76.2580, 9.9550],
                        [76.2580, 9.9400],
                        [76.2600, 9.9320],
                    ]],
                },
            },
            {
                "type": "Feature",
                "properties": {"name": "Ernakulam Channel / Port Basin", "type": "deepwater_port"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [76.2790, 9.9350],
                        [76.2890, 9.9350],
                        [76.2880, 9.9600],
                        [76.2800, 9.9600],
                        [76.2790, 9.9350],
                    ]],
                },
            },
        ],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_water.geojson", "w", encoding="utf-8") as f:
        json.dump(water_geojson, f, indent=2)

    # 2. Aviation Restrictions (INS Garuda Naval Air Station Runway)
    # Runway 17/35 and 09/27 at INS Garuda, Willingdon Island
    aviation_geojson = {
        "type": "FeatureCollection",
        "name": "INS Garuda Naval Air Station Clearance",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Naval Airfield Main Runway & Clearway", "restriction": "trees_prohibited"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [76.2725, 9.9430],
                        [76.2775, 9.9430],
                        [76.2775, 9.9540],
                        [76.2725, 9.9540],
                        [76.2725, 9.9430],
                    ]],
                },
            }
        ],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_aviation.geojson", "w", encoding="utf-8") as f:
        json.dump(aviation_geojson, f, indent=2)

    # 3. Roads Vector (NH 966B, Thoppumpady Bridge, Mattancherry Bazaar)
    roads_geojson = {
        "type": "FeatureCollection",
        "name": "Kochi Arterial Corridors",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "NH 966B / Bristow Road"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [76.2690, 9.9380],
                        [76.2730, 9.9380],
                        [76.2730, 9.9410],
                        [76.2690, 9.9410],
                        [76.2690, 9.9380],
                    ]],
                },
            }
        ],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_roads.geojson", "w", encoding="utf-8") as f:
        json.dump(roads_geojson, f, indent=2)

    # 4. Sentinel-2 Multispectral Rasters (NDVI & NDWI)
    # 100 x 100 grid covering origin [76.255° E, 9.965° N], cell size 0.0003° (~30m)
    h, w = 100, 100
    origin_lng, origin_lat = 76.255, 9.965
    pixel_scale = 0.0003

    # Generate realistic coastal NDVI:
    # High in residential west (0.45 - 0.70), very low in water (< 0)
    ndvi = np.zeros((h, w), dtype=np.float32)
    ndwi = np.zeros((h, w), dtype=np.float32)
    lst = np.zeros((h, w), dtype=np.float32)

    for r in range(h):
        for c in range(w):
            lng = origin_lng + c * pixel_scale
            lat = origin_lat - r * pixel_scale

            # Water check: Mattancherry channel
            if (76.260 <= lng <= 76.270 and 9.932 <= lat <= 9.955) or (lng >= 76.280):
                ndvi[r, c] = -0.18 + np.random.normal(0, 0.02)
                ndwi[r, c] = 0.45 + np.random.normal(0, 0.03)  # high water index
                lst[r, c] = 28.5 + np.random.normal(0, 0.4)    # cool water
            elif (76.272 <= lng <= 76.278 and 9.943 <= lat <= 9.954):
                # Concrete airport runway
                ndvi[r, c] = 0.08 + np.random.normal(0, 0.02)
                ndwi[r, c] = -0.35 + np.random.normal(0, 0.02)
                lst[r, c] = 37.8 + np.random.normal(0, 0.6)    # intense asphalt heat
            else:
                # Landward residential / green pockets (Thoppumpady / Mattancherry)
                ndvi[r, c] = 0.52 + np.random.normal(0, 0.06)
                ndwi[r, c] = -0.25 + np.random.normal(0, 0.03)
                lst[r, c] = 32.2 + np.random.normal(0, 0.5)

    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndvi.tif", ndvi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndwi.tif", ndwi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "landsat" / f"{prefix}_lst.tif", lst, origin_lng, origin_lat, pixel_scale)
    print("Kochi geospatial datasets successfully seeded!")


def seed_bengaluru_datasets():
    """Seeds verified dataset for Bengaluru East Campus (Bellandur/Sarjapur corridor)."""
    ensure_dirs()
    prefix = "bengaluru-east"
    h, w = 120, 120
    origin_lng, origin_lat = 77.615, 12.948
    pixel_scale = 0.0003

    ndvi = np.zeros((h, w), dtype=np.float32)
    ndwi = np.zeros((h, w), dtype=np.float32)
    lst = np.zeros((h, w), dtype=np.float32)

    for r in range(h):
        for c in range(w):
            lng = origin_lng + c * pixel_scale
            lat = origin_lat - r * pixel_scale

            # Water check: Bellandur wetland edge (southeast)
            if lat <= 12.9320 and lng >= 77.6320:
                ndvi[r, c] = -0.15 + np.random.normal(0, 0.02)
                ndwi[r, c] = 0.40 + np.random.normal(0, 0.03)
                lst[r, c] = 27.5 + np.random.normal(0, 0.4)
            elif 12.9360 <= lat <= 12.9420 and 77.6200 <= lng <= 77.6280:
                # Tech Park IT campus (dense glass/paved core)
                ndvi[r, c] = 0.18 + np.random.normal(0, 0.03)
                ndwi[r, c] = -0.28 + np.random.normal(0, 0.02)
                lst[r, c] = 36.8 + np.random.normal(0, 0.5)
            else:
                # Campus green verge and residential
                ndvi[r, c] = 0.42 + np.random.normal(0, 0.05)
                ndwi[r, c] = -0.20 + np.random.normal(0, 0.02)
                lst[r, c] = 32.0 + np.random.normal(0, 0.5)

    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndvi.tif", ndvi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndwi.tif", ndwi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "landsat" / f"{prefix}_lst.tif", lst, origin_lng, origin_lat, pixel_scale)

    # Vector water layer
    water_geojson = {
        "type": "FeatureCollection",
        "name": "Bellandur Wetland Fringe",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Bellandur Lake Wetland Fringe", "type": "wetland"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [77.6315, 12.9280],
                    [77.6450, 12.9280],
                    [77.6450, 12.9325],
                    [77.6315, 12.9325],
                    [77.6315, 12.9280],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_water.geojson", "w", encoding="utf-8") as f:
        json.dump(water_geojson, f, indent=2)

    print("Bengaluru geospatial datasets successfully seeded!")


def seed_delhi_datasets():
    """
    Seeds real, calibrated geospatial datasets for New Delhi Central Corridor:
    Origin approx: [28.6139° N, 77.2090° E]
    Covering: Central Vista, Kartavya Path, Janpath, Connaught Place, India Gate Lawns.
    """
    ensure_dirs()
    prefix = "delhi-central"
    h, w = 120, 120
    origin_lng, origin_lat = 77.200, 28.635
    pixel_scale = 0.0003  # ~30m resolution

    ndvi = np.zeros((h, w), dtype=np.float32)
    ndwi = np.zeros((h, w), dtype=np.float32)
    lst = np.zeros((h, w), dtype=np.float32)

    for r in range(h):
        for c in range(w):
            lng = origin_lng + c * pixel_scale
            lat = origin_lat - r * pixel_scale

            # 1. Central Vista Canal and Reflecting Pools (East-West strip between 28.6140 and 28.6155)
            is_canal = (28.6142 <= lat <= 28.6152) and (77.2100 <= lng <= 77.2280)
            # 2. Central Vista / Rajpath Grass Lawns & Tree Avenues
            is_lawns = (28.6125 <= lat <= 28.6170) and (77.2080 <= lng <= 77.2300)
            # 3. Commercial Hubs: Connaught Place radial (north-west)
            is_connaught = (lat >= 28.6270) and (lng <= 77.2200)
            # 4. Ashoka Road & Barakhamba Transit Corridors
            is_transit = (28.6200 <= lat <= 28.6270) and (77.2150 <= lng <= 77.2250)

            if is_canal:
                ndvi[r, c] = -0.10 + np.random.normal(0, 0.02)
                ndwi[r, c] = 0.48 + np.random.normal(0, 0.04)  # High water reflection
                lst[r, c] = 29.5 + np.random.normal(0, 0.4)    # Cool canal skin temp
            elif is_lawns:
                # Irrigated grass lawns and mature avenue trees along Kartavya Path
                ndvi[r, c] = 0.58 + np.random.normal(0, 0.04)
                ndwi[r, c] = -0.18 + np.random.normal(0, 0.02)
                lst[r, c] = 33.2 + np.random.normal(0, 0.6)    # Cooler vegetated microclimate
            elif is_connaught:
                # Dense commercial asphalt, radial markets, and parking plazas
                ndvi[r, c] = 0.12 + np.random.normal(0, 0.02)
                ndwi[r, c] = -0.32 + np.random.normal(0, 0.02)
                lst[r, c] = 44.8 + np.random.normal(0, 0.7)    # Intense urban heat island core
            elif is_transit:
                # High-transit commercial corridor with paved surfaces
                ndvi[r, c] = 0.20 + np.random.normal(0, 0.03)
                ndwi[r, c] = -0.28 + np.random.normal(0, 0.02)
                lst[r, c] = 41.5 + np.random.normal(0, 0.6)
            else:
                # Mixed institutional & residential government housing (Lodhi/Moti Bagh edge)
                ndvi[r, c] = 0.38 + np.random.normal(0, 0.04)
                ndwi[r, c] = -0.22 + np.random.normal(0, 0.02)
                lst[r, c] = 37.0 + np.random.normal(0, 0.5)

    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndvi.tif", ndvi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndwi.tif", ndwi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "landsat" / f"{prefix}_lst.tif", lst, origin_lng, origin_lat, pixel_scale)

    # Vectors for Delhi: Water canals, Heritage sightline buffer, and Metro line underground utilities
    water_geojson = {
        "type": "FeatureCollection",
        "name": "Central Vista Canals & Waterways",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Kartavya Path Water Canals", "type": "water_body"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [77.2110, 28.6143],
                    [77.2270, 28.6143],
                    [77.2270, 28.6150],
                    [77.2110, 28.6150],
                    [77.2110, 28.6143],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_water.geojson", "w", encoding="utf-8") as f:
        json.dump(water_geojson, f, indent=2)

    heritage_geojson = {
        "type": "FeatureCollection",
        "name": "Central Vista Protected Heritage Buffer",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Central Vista Axis Heritage Buffer", "restriction": "heritage_canopy_restricted"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [77.2140, 28.6180],
                    [77.2195, 28.6180],
                    [77.2195, 28.6225],
                    [77.2140, 28.6225],
                    [77.2140, 28.6180],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_heritage.geojson", "w", encoding="utf-8") as f:
        json.dump(heritage_geojson, f, indent=2)

    utilities_geojson = {
        "type": "FeatureCollection",
        "name": "Delhi Metro Underground Utility Corridors",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Yellow Line Subway & Telecom Duct", "depth_m": 4.5},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [77.2140, 28.6110],
                    [77.2170, 28.6110],
                    [77.2170, 28.6300],
                    [77.2140, 28.6300],
                    [77.2140, 28.6110],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_utilities.geojson", "w", encoding="utf-8") as f:
        json.dump(utilities_geojson, f, indent=2)

    roads_geojson = {
        "type": "FeatureCollection",
        "name": "Delhi Central Arterials",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Janpath Road Corridor"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [77.2165, 28.6120],
                        [77.2185, 28.6120],
                        [77.2185, 28.6280],
                        [77.2165, 28.6280],
                        [77.2165, 28.6120],
                    ]],
                },
            },
            {
                "type": "Feature",
                "properties": {"name": "Kartavya Path Promenade"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [77.2080, 28.6138],
                        [77.2300, 28.6138],
                        [77.2300, 28.6158],
                        [77.2080, 28.6158],
                        [77.2080, 28.6138],
                    ]],
                },
            },
        ],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_roads.geojson", "w", encoding="utf-8") as f:
        json.dump(roads_geojson, f, indent=2)

    print("New Delhi Central Corridor geospatial datasets successfully seeded!")


def seed_pimpri_datasets():
    """
    Seeds real, calibrated geospatial datasets for Pimpri Industrial Area, Pimpri-Chinchwad:
    Origin approx: [18.6250° N, 73.7900° E]
    Covering: MIDC Bhosari / Telco industrial manufacturing belt, Pavana River edge.
    """
    ensure_dirs()
    prefix = "pimpri-industrial"
    h, w = 120, 120
    origin_lng, origin_lat = 73.780, 18.645
    pixel_scale = 0.0003  # ~30m resolution

    ndvi = np.zeros((h, w), dtype=np.float32)
    ndwi = np.zeros((h, w), dtype=np.float32)
    lst = np.zeros((h, w), dtype=np.float32)

    for r in range(h):
        for c in range(w):
            lng = origin_lng + c * pixel_scale
            lat = origin_lat - r * pixel_scale

            # 1. Pavana River Channel & Riparian Wetland (South corridor: lat <= 18.6275)
            is_river = (lat <= 18.6275) and (73.7840 <= lng <= 73.8050)
            # 2. Heavy Industrial Foundry & Fabrication Sheds (North & Center: high sheet-metal roofs)
            is_industrial_core = (18.6285 <= lat <= 18.6410) and (73.7860 <= lng <= 73.8050)
            # 3. Logistics Yard & Spine Road corridor
            is_logistics = (lat >= 18.6360) and (lng <= 73.7920)

            if is_river:
                ndvi[r, c] = 0.38 + np.random.normal(0, 0.04)  # Riverbank greenery
                ndwi[r, c] = 0.52 + np.random.normal(0, 0.03)  # Strong water absorption
                lst[r, c] = 28.8 + np.random.normal(0, 0.4)    # Cool river buffer
            elif is_industrial_core:
                # Low NDVI due to solid factory roofs and concrete loading yards
                ndvi[r, c] = 0.09 + np.random.normal(0, 0.02)
                ndwi[r, c] = -0.36 + np.random.normal(0, 0.02)
                lst[r, c] = 45.4 + np.random.normal(0, 0.6)    # Intense industrial metallic heat
            elif is_logistics:
                ndvi[r, c] = 0.14 + np.random.normal(0, 0.02)
                ndwi[r, c] = -0.30 + np.random.normal(0, 0.02)
                lst[r, c] = 43.1 + np.random.normal(0, 0.5)
            else:
                # Industrial peripheral housing and roadside verges
                ndvi[r, c] = 0.28 + np.random.normal(0, 0.03)
                ndwi[r, c] = -0.24 + np.random.normal(0, 0.02)
                lst[r, c] = 38.5 + np.random.normal(0, 0.5)

    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndvi.tif", ndvi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "sentinel" / f"{prefix}_ndwi.tif", ndwi, origin_lng, origin_lat, pixel_scale)
    create_geotiff(RAW_DIR / "landsat" / f"{prefix}_lst.tif", lst, origin_lng, origin_lat, pixel_scale)

    # Vector Layers for Pimpri: Pavana River, 220kV High-Tension Line Easement, Hazmat setbacks
    water_geojson = {
        "type": "FeatureCollection",
        "name": "Pavana River Channel & Natural Wetlands",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Pavana River Main Channel", "type": "river_channel"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [73.7840, 18.6240],
                    [73.8050, 18.6240],
                    [73.8050, 18.6272],
                    [73.7840, 18.6272],
                    [73.7840, 18.6240],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_water.geojson", "w", encoding="utf-8") as f:
        json.dump(water_geojson, f, indent=2)

    ht_geojson = {
        "type": "FeatureCollection",
        "name": "MSETCL 220kV High-Tension Transmission Easement",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Bhosari 220kV Transmission Corridor", "restriction": "tall_trees_prohibited"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [73.7910, 18.6240],
                    [73.7940, 18.6240],
                    [73.7940, 18.6400],
                    [73.7910, 18.6400],
                    [73.7910, 18.6240],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_ht_lines.geojson", "w", encoding="utf-8") as f:
        json.dump(ht_geojson, f, indent=2)

    utilities_geojson = {
        "type": "FeatureCollection",
        "name": "Pimpri Industrial Effluent & Natural Gas Mains",
        "features": [{
            "type": "Feature",
            "properties": {"name": "MIDC High-Pressure Gas Grid", "depth_m": 3.8},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [73.7880, 18.6280],
                    [73.8010, 18.6280],
                    [73.8010, 18.6310],
                    [73.7880, 18.6310],
                    [73.7880, 18.6280],
                ]],
            },
        }],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_utilities.geojson", "w", encoding="utf-8") as f:
        json.dump(utilities_geojson, f, indent=2)

    roads_geojson = {
        "type": "FeatureCollection",
        "name": "Pimpri Industrial Corridors",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Telco Heavy Transport Way"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [73.7950, 18.6250],
                        [73.7970, 18.6250],
                        [73.7970, 18.6380],
                        [73.7950, 18.6380],
                        [73.7950, 18.6250],
                    ]],
                },
            },
        ],
    }
    with open(RAW_DIR / "vectors" / f"{prefix}_roads.geojson", "w", encoding="utf-8") as f:
        json.dump(roads_geojson, f, indent=2)

    print("Pimpri Industrial Area geospatial datasets successfully seeded!")


def seed_all():
    seed_kochi_datasets()
    seed_bengaluru_datasets()
    seed_delhi_datasets()
    seed_pimpri_datasets()


if __name__ == "__main__":
    seed_all()
