# EcoGrid AI 2.0 — System Architecture, Workflow, Libraries & Setup Guide

This document provides a comprehensive reference for **EcoGrid AI 2.0**, detailing the end-to-end technical workflow, the complete matrix of libraries and their architectural purposes, and step-by-step installation instructions with executable shell (`sh` / `bash`) commands.

---

## 1. Executive System Overview

EcoGrid AI 2.0 is an enterprise-grade geospatial climate intelligence and urban resilience decision-support platform. It assists municipal planners, climatologists, and campus administrators in mitigating Urban Heat Island (UHI) effects, closing tree canopy gaps, protecting pedestrian corridors, and optimizing green infrastructure investments under strict physical and budgetary constraints.

```mermaid
flowchart TD
    subgraph Data Layer ["1. Geospatial & Remote Sensing Layer"]
        S2["Sentinel-2 MSI\n(NDVI & NDWI GeoTIFFs)"]
        L8["Landsat 8/9 TIRS\n(Land Surface Temp LST)"]
        OSM["OpenStreetMap & Cadastral GIS\n(Roads, Utilities, Water)"]
    end

    subgraph Processing Layer ["2. Grid Discretization & Scoring Engine"]
        Grid["100m × 100m Spatial Grid Engine\n(GeoPandas / Shapely)"]
        Scoring["Multi-Criteria Priority Engine\n(Heat, Greenery, Pedestrian, Connectivity)"]
    end

    subgraph Intelligence Layer ["3. Analytics, ML & Optimization"]
        ML["Tree Suitability Classifier\n(Random Forest & XGBoost)"]
        Opt["Knapsack & Multi-Objective Solver\n(Google OR-Tools CP-SAT)"]
        Graph["Corridor Percolation Analysis\n(NetworkX Topological Graph)"]
        CV["Satellite Surface Segmentation\n(Impervious, Canopy, Water, Rooftop)"]
        AI["AI Decision Briefing Pool\n(Grok / Groq Multi-Key Failover)"]
    end

    subgraph Presentation Layer ["4. Presentation, Governance & Export"]
        Web["React 18 + TypeScript Dashboard\n(Leaflet, Recharts, Dark-Green Glassmorphism)"]
        Gov["Human Approval & Audit Trail\n(DRAFT → APPROVED / REJECTED)"]
        PDF["Executive Briefing Generator\n(ReportLab Two-Pass NumberedCanvas)"]
    end

    DataLayer --> ProcessingLayer
    ProcessingLayer --> IntelligenceLayer
    IntelligenceLayer --> PresentationLayer
```

---

## 2. End-to-End Architectural Workflow

The EcoGrid AI platform operates through a nine-stage sequential execution pipeline:

### Stage 1: Geospatial Ingestion & Remote Sensing Calibration
- **Multispectral Raster Sampling**: Ingests high-resolution GeoTIFFs from **Sentinel-2 MSI** (Normalized Difference Vegetation Index — NDVI, Normalized Difference Water Index — NDWI) and **Landsat 8/9 TIRS** (Calibrated Land Surface Temperature — LST in °C).
- **Cadastral & Vector Overlays**: Samples OpenStreetMap and municipal GIS GeoJSON layers representing arterial roads, pedestrian sidewalks, open water bodies, high-tension electrical rights-of-way, and underground utility corridors.
- **Cartographic Reprojection**: Transforms spatial coordinates between `EPSG:4326` (WGS84 Lat/Lng) and `EPSG:3857` (Web Mercator) / local UTM projections using `PyProj` and `Shapely`.

### Stage 2: Spatial Discretization & Priority Scoring Engine
- **Grid Discretization**: Partitions candidate urban zones (e.g., *New Delhi Central Corridor*, *Pimpri Industrial Area*, *Bengaluru East*, *Kochi Marine Corridor*) into a uniform grid of 100m × 100m cells (`A01` through `J10`).
- **Composite Priority Formula**:
  $$\text{Priority} = \frac{w_{\text{heat}} \cdot S_{\text{heat}} + w_{\text{green}} \cdot S_{\text{green}} + w_{\text{ped}} \cdot S_{\text{ped}} + w_{\text{conn}} \cdot S_{\text{conn}} + w_{\text{bio}} \cdot S_{\text{bio}}}{\sum w}$$
- **Risk Categorization**: Evaluates normalized scores against empirical cutoffs to assign each cell into **CRITICAL** ($>0.70$), **HIGH** ($0.55\text{--}0.70$), **MEDIUM** ($0.35\text{--}0.55$), or **LOW** ($<0.35$) risk bands.

### Stage 3: Location-Aware ML & Tree Planting Suitability
- **Empirical Calibration**: Models tree survival and planting feasibility based on real local environmental features:
  - Surface thermal stress (LST °C)
  - Soil moisture index (NDWI proxy)
  - Baseline tree canopy density (NDVI)
  - Pedestrian exposure level
  - Distance to nearest water body
- **Ensemble Benchmarking**: Trains and benchmarks **Random Forest** and **XGBoost** models against baseline Logistic Regression, selecting the highest F1-score model with serialized artifacts (`.joblib` and `.json` metadata).
- **Microclimate Cooling Impact**: Predicts expected ambient temperature drops ($\Delta T_C = 0.8^\circ\text{C}\text{--}2.4^\circ\text{C}$) based on intervention type and canopy volume.

### Stage 4: Mathematical Optimization & Hard Constraint Solving
- **Google OR-Tools CP-SAT Discrete Knapsack**:
  Formulates intervention selection as an exact integer programming problem:
  $$\max \sum_{i \in \text{Cells}} \sum_{j \in \text{Interventions}} c_{ij} \cdot x_{ij} \quad \text{subject to} \quad \sum \text{Cost}_{ij} \cdot x_{ij} \le \text{Budget}$$
- **Hard Feasibility Vetoes**:
  - Water Cell Veto: Zero tree planting or bioswale allocation on existing open water bodies ($\text{Feasibility} = 0$).
  - Underground Utility Buffer: Vetoes deep-root shade trees within 3.0 meters of high-voltage lines or sewer mains.
  - Airport Obstacle Clearance: Limits tall canopy trees along runway approach funnels.
- **Multi-Objective Pareto Frontier**: Employs `pymoo` to construct a non-dominated Pareto front, identifying the "knee-point" that balances budget utilization against total microclimate relief.

### Stage 5: Topological Network Graph & Ecological Corridor Percolation
- **Spatial Adjacency Graph**: Constructs an undirected graph $G = (V, E)$ using `NetworkX`, where vertices represent green cells and edges represent physical contiguity (Queen's 8-neighborhood).
- **Percolation & Fragmentation Analysis**: Computes the number of isolated green components before and after proposed interventions. Interventions are prioritized to form stepping-stone corridors, bridging fragmented patches into contiguous biodiversity corridors.

### Stage 6: Computer Vision Satellite Surface Segmentation
- **Sub-Cell Pixel Classification**: Analyzes satellite imagery at 1m/pixel resolution, segmenting cell surfaces into five discrete land-cover classes:
  1. *Impervious Pavement* (asphalt/concrete)
  2. *Tree Canopy*
  3. *Permeable Grass / Bare Soil*
  4. *Building Rooftop*
  5. *Water Body*
- **Actionable Area Allocation**: Calculates permeable surface square meters available for micro-forests, bioswales, and reflective cool-roof coatings.

### Stage 7: AI Planning Assistant & Multi-Key Failover Pool
- **Multi-Key Resilience**: Implements an automated key-rotation and cooldown pool (`grok_pool.py`) supporting xAI Grok and Groq providers across 5+ API keys.
- **Automated Failover**: Detects rate limits (`HTTP 429`) and server errors (`HTTP 5xx`), instantly routing subsequent inference requests to healthy secondary keys without user disruption.
- **Context-Aware Briefing**: Generates cell-specific causal explanations (*"Why was Cell B03 chosen?"*) and executive scenario trade-off analyses.

### Stage 8: Human-in-the-Loop Governance & Audit Trail
- **Formal Workflow States**: Tracks proposed municipal intervention plans through strict state transitions:
  $$\text{DRAFT} \longrightarrow \text{APPROVED} \quad \text{or} \quad \text{REJECTED}$$
- **Immutable Audit Logging**: Records planner identity, timestamp, budgetary ceiling, solver parameter snapshot, and justification notes in PostgreSQL / SQLite.

### Stage 9: Publication Briefing & Export Engine
- **ReportLab PDF Engine**: Compiles executive briefs using a two-pass `NumberedCanvas` that calculates total page count (`Page X of Y`), draws continuation headers, applies municipal `INR` formatting, and prevents table clipping.
- **Multimodal Export**: Supports one-click direct PDF downloads, in-browser PDF tab previews (`inline=true`), GeoJSON spatial layers, CSV tabular datasets, and structured JSON planning payloads.

---

## 3. Libraries Used & Architectural Purposes

### A. Python Backend Stack (`backend/requirements.txt`)

| Library | Version | Category | Architectural Purpose & Usage |
| :--- | :--- | :--- | :--- |
| **`fastapi`** | `0.115.6` | Web API | Asynchronous REST API framework providing high-throughput endpoints, dependency injection, and automatic OpenAPI/Swagger documentation. |
| **`uvicorn[standard]`** | `0.34.0` | ASGI Server | Production-ready, lightning-fast ASGI server powering the FastAPI backend application. |
| **`pydantic`** | `2.10.4` | Data Validation | Core schema definition, strict type validation, and data serialization between database models and HTTP responses. |
| **`pydantic-settings`** | `2.7.1` | Configuration | Environment variable parsing and type-safe configuration management (`config.py`). |
| **`geopandas`** | `>=1.0.0` | GIS & Spatial | Vector geospatial processing, reading and writing GeoJSON/Shapefiles, coordinate transformations, and spatial joins. |
| **`shapely`** | `>=2.0.0` | Computational Geometry | Geometry manipulation: point-in-polygon tests, line intersection with utility buffers, and polygon area calculations. |
| **`pyproj`** | `>=3.6.0` | Cartography | Cartographic projections and geodetic transformations between `EPSG:4326` (WGS84) and local metric projected coordinate systems. |
| **`scikit-learn`** | `1.6.1` | Machine Learning | Model training, classification algorithms (Random Forest, Logistic Regression), feature scaling, and evaluation metrics (F1-score, confusion matrix). |
| **`xgboost`** | `>=2.1.0` | Machine Learning | High-performance gradient boosted decision trees for non-linear tree suitability prediction across urban micro-climates. |
| **`numpy`** | `2.2.1` | Numerical Math | Matrix operations, vectorized grid score normalization, and numerical array transformations. |
| **`pandas`** | `2.2.3` | Tabular Data | Tabular GIS feature restructuring, CSV import/export parsing, and telemetry aggregations. |
| **`joblib`** | `1.4.2` | Serialization | Model serialization and disk persistence for trained scikit-learn and XGBoost pipelines. |
| **`ortools`** | `9.11.4210` | Mathematical Solver | Google OR-Tools CP-SAT (Constraint Programming - Satisfiability) solver for exact 0/1 knapsack budget allocation and multi-objective optimization. |
| **`pymoo`** | `>=0.6.1` | Multi-Objective Opt | Multi-objective genetic algorithm framework for generating non-dominated Pareto frontiers and identifying knee-point solutions. |
| **`networkx`** | `3.4.2` | Network Graph | Graph theory modeling, connected components calculation, corridor percolation, and topological fragmentation reduction analysis. |
| **`reportlab`** | `>=4.0.0` | PDF Generation | Publication-quality PDF document generation, Flowable layout engine, custom Table styling, and two-pass `NumberedCanvas` page numbering. |
| **`pillow`** | `~11.0` | Imaging | Raster image handling, satellite thumbnail cropping, and computer vision surface segmentation mask generation. |
| **`sqlalchemy`** | `2.0.36` | Database ORM | Object-Relational Mapping for Postgres and SQLite persistence with async and sync session support. |
| **`geoalchemy2`** | `0.15.2` | Spatial DB | PostGIS spatial geometry and geography integration for SQLAlchemy models. |
| **`psycopg2-binary`** | `2.9.10` | Database Driver | PostgreSQL database adapter for relational storage and PostGIS queries. |
| **`asyncpg`** | `0.30.0` | Async DB Driver | High-speed asynchronous PostgreSQL driver for non-blocking database queries in FastAPI. |
| **`alembic`** | `1.14.0` | DB Migrations | Database schema migration tracking and automated DDL script generation. |
| **`pytest`** | `8.3.4` | Testing | Test runner for unit, integration, optimization solver, and GIS ingestion suites. |
| **`pytest-asyncio`** | `0.24.0` | Async Testing | Pytest plugin supporting native asynchronous tests for FastAPI endpoints and async services. |
| **`httpx`** | `0.28.1` | HTTP Client | Asynchronous HTTP client for external AI API calls (Grok/Groq) and internal API integration testing. |
| **`python-dotenv`** | `1.0.1` | Environment | Reads key-value pairs from `.env` files and injects them into system environment variables. |

---

### B. React Frontend Stack (`apps/web/package.json`)

| Library | Version | Category | Architectural Purpose & Usage |
| :--- | :--- | :--- | :--- |
| **`react`** | `18.3.1` | Core Framework | Declarative component UI library for building the web dashboard interface. |
| **`react-dom`** | `18.3.1` | DOM Renderer | React renderer for the browser Document Object Model. |
| **`react-router-dom`** | `6.30.0` | Routing | Client-side routing across screens: `/overview`, `/environment`, `/planner`, `/scenarios`, `/what-if`, `/connectivity`, `/reports`, `/data-sources`. |
| **`leaflet`** | `1.9.4` | Web Mapping | Interactive geospatial raster and vector map renderer. |
| **`react-leaflet`** | `4.2.1` | Map Integration | React bindings for Leaflet map elements, tile layers, polygons, and custom tooltips. |
| **`recharts`** | `2.15.1` | Data Visualization | SVG charts for microclimate trends, Pareto frontiers, risk distribution histograms, and scenario deltas. |
| **`lucide-react`** | `0.468.0` | UI Icons | Clean, modern icon set utilized across navigation, stat cards, and status tags. |
| **`@tanstack/react-query`** | `5.66.9` | State Sync | Asynchronous data fetching, background polling, and cache management for remote API queries. |
| **`html-to-image`** | `1.11.13` | Canvas Rendering | High-DPI DOM-to-canvas rasterizer for exporting map views as standalone PNG files. |
| **`zod`** | `3.24.2` | Client Validation | Runtime schema assertion for API responses and client-side form payloads. |
| **`vite`** | `6.1.0` | Build Tool | Blazing fast ESM development server with Hot Module Replacement (HMR) and optimized Rollup bundling. |
| **`tailwindcss`** | `3.4.17` | Utility CSS | Utility-first CSS classes augmenting custom bespoke glassmorphic CSS styling. |

---

### C. TypeScript Workspace Packages (`packages/domain`, `packages/contracts`, `apps/api`)

| Library / Package | Version | Architectural Purpose & Usage |
| :--- | :--- | :--- |
| **`@ecogrid/domain`** | Internal Workspace | Shared TypeScript domain models: Grid types, Cell models, Score sets, Intervention catalogs, and deterministic local fallback optimizer. |
| **`@ecogrid/contracts`** | Internal Workspace | Shared request/response DTOs, API route constants, and validation contracts shared between frontend and backend. |
| **`fastify`** | `5.2.1` | High-throughput secondary Node.js API gateway providing authentication and Prisma ORM fallbacks. |
| **`@prisma/client`** | `6.19.0` | Multi-database client supporting PostgreSQL and MySQL schema generation and migrations. |
| **`jose`** & **`bcryptjs`** | `5.9.6` / `3.0.2` | Cryptographic JWT token generation/verification and salted bcrypt password hashing. |
| **`concurrently`** | `9.1.2` | Orchestrates parallel execution of backend and frontend processes in local development. |
| **`vitest`** | `3.0.8` | Next-generation TypeScript unit and domain test runner. |

---

## 4. Installation & Setup Guide (`sh` & `bash` Commands)

Follow these step-by-step instructions to set up, calibrate, and run EcoGrid AI 2.0 on any Linux, macOS, or Windows (Git-Bash / WSL) environment.

### Prerequisites Check

Ensure your workstation has the following system dependencies installed:
- **Node.js**: `v20.0.0` or `v22.x` ([Download](https://nodejs.org/))
- **pnpm**: `v9.x` or `v11.x` (`npm install -g pnpm`)
- **Python**: `3.10`, `3.11`, or `3.12` ([Download](https://www.python.org/))
- **Git**: Recent version
- **C/C++ Build Tools & Spatial Libraries** *(Optional for compiling native GDAL; standard wheels install cleanly)*

```bash
# Verify system prerequisites
node --version
pnpm --version
python3 --version || python --version
git --version
```

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/Samyak01AI/Ecogrid_.git
cd Ecogrid_
```

---

### Step 2: Configure Environment Variables

Copy the provided environment example file to `.env`:

```bash
cp .env.example .env
```

Review or edit `.env` using your preferred editor:
```bash
# Example: Using nano or vim
nano .env
```

Key environment configuration variables:
```ini
# Database configuration
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://ecogrid:ecogrid@localhost:5432/ecogrid

# Service Ports & Origins
API_PORT=3001
PORT=3000
WEB_ORIGIN=http://localhost:3000

# Optional: Grok (xAI) or Groq Multi-Key Pool (5 fallback keys)
GROK_API_KEY_1=your_first_api_key_here
GROK_API_KEY_2=your_second_api_key_here
GROK_API_KEY_3=your_third_api_key_here
GROK_API_KEY_4=your_fourth_api_key_here
GROK_API_KEY_5=your_fifth_api_key_here
GROK_BASE_URL=https://api.groq.com/openai/v1
GROK_MODEL=llama-3.3-70b-versatile
```

> **Note**: Even if no external AI API keys are configured, EcoGrid AI functions completely offline using deterministic heuristic fallback models and built-in ML predictors.

---

### Step 3: Python Backend Virtual Environment Setup

Create an isolated Python virtual environment inside the `backend/` directory and install all required scientific and geospatial packages:

```bash
# On Linux / macOS / Git-Bash
python3 -m venv backend/.venv || python -m venv backend/.venv

# Activate the virtual environment:
# On Linux / macOS:
source backend/.venv/bin/activate

# On Windows (Git-Bash):
source backend/.venv/Scripts/activate

# On Windows (Command Prompt / PowerShell):
# backend\.venv\Scripts\activate

# Upgrade pip and install all backend requirements
pip install --upgrade pip
pip install -r backend/requirements.txt
```

---

### Step 4: Seed Real Geospatial Datasets & Calibrate ML Models

EcoGrid AI includes automated data generation and calibration scripts that generate synthetic multispectral Sentinel-2 (NDVI/NDWI) and Landsat (LST) GeoTIFFs for study areas, train the tree suitability model, and verify spatial projections:

```bash
# Ensure your virtual environment is active
# Run dataset seeding and ML benchmark calibration
python backend/app/gis/seed_real_datasets.py
```

Expected output:
```text
✓ Created synthetic GeoTIFFs for Delhi, Pimpri, Bengaluru, and Kochi.
✓ Vector boundary layers written to backend/data/raw/vectors/
✓ Tree suitability model trained and saved to backend/app/ml/saved_models/
✓ Benchmark metrics: Baseline 78.4%, Random Forest F1 91.2%, XGBoost F1 93.8%
```

---

### Step 5: Install Monorepo Packages & Build Shared Contracts

Install all JavaScript/TypeScript dependencies across the monorepo workspaces and compile the shared domain and contract packages:

```bash
# Install all node modules
pnpm install

# Build shared @ecogrid/domain and @ecogrid/contracts packages
pnpm run build:packages
```

---

### Step 6: Database Setup (Optional)

EcoGrid AI features an in-memory database and deterministic state cache that allows running without external databases. If you wish to use PostgreSQL / PostGIS:

```bash
# Run Prisma database migrations for PostgreSQL
pnpm run db:migrate:postgres

# Seed administrative credentials and study fixtures
pnpm run db:seed
```

---

### Step 7: Running EcoGrid AI Locally

You can launch the entire platform using any of the following methods:

#### Method A: Unified One-Command Runner Script (Recommended)

EcoGrid AI includes a standalone bash runner script [`run.sh`](file:///d:/hackathon/vit%20code%20apex/ecogridai/run.sh) that activates the virtual environment, compiles packages, and boots both the backend and web client:

```bash
# Make runner executable (Linux / macOS)
chmod +x run.sh

# Run both Backend API and Web Client simultaneously:
./run.sh all

# Or run specific components:
# ./run.sh backend  -> Starts FastAPI backend on http://127.0.0.1:3001
# ./run.sh web      -> Starts Vite frontend on http://localhost:3000
# ./run.sh test     -> Runs the Pytest backend test suite
```

#### Method B: Monorepo PNPM Command

```bash
# Starts both Python FastAPI backend and Vite frontend concurrently
pnpm run dev
```

#### Method C: Independent Terminal Windows

If you prefer running services in separate terminals:

**Terminal 1 (Python FastAPI Backend):**
```bash
# Activate virtual environment
source backend/.venv/bin/activate  # or source backend/.venv/Scripts/activate

# Launch Uvicorn server on port 3001
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 3001 --reload
```

**Terminal 2 (React Vite Web App):**
```bash
pnpm --filter @ecogrid/web dev
```

Once started:
- **Web Application Dashboard**: Open [http://localhost:3000](http://localhost:3000)
- **FastAPI Interactive Docs (Swagger)**: Open [http://127.0.0.1:3001/docs](http://127.0.0.1:3001/docs)
- **Alternative Redoc API Documentation**: Open [http://127.0.0.1:3001/redoc](http://127.0.0.1:3001/redoc)

---

### Step 8: Running Test Suites & Quality Verification

Run the automated test suites to ensure mathematical solvers, ML models, and frontend components pass validation:

```bash
# 1. Run Python backend test suite (FastAPI, CP-SAT optimizer, ML, Grok Pool)
pnpm run test:backend
# Or directly via pytest:
# python -m pytest backend/tests -v

# 2. Run TypeScript domain and contract tests
pnpm --filter @ecogrid/domain test

# 3. Run frontend TypeScript type checking and linting
pnpm run typecheck
pnpm run lint

# 4. Build frontend production bundle
pnpm --filter @ecogrid/web build
```

---

### Step 9: Testing & Verifying Core API Endpoints

You can verify the backend services using `curl`:

```bash
# 1. Health check
curl -s http://127.0.0.1:3001/api/health | jq

# 2. List study areas
curl -s http://127.0.0.1:3001/api/studies | jq

# 3. Fetch location-specific grid cells for New Delhi Central Corridor
curl -s http://127.0.0.1:3001/api/studies/study-delhi/cells | jq '.count, .study.name'

# 4. Run CP-SAT knapsack optimization plan
curl -s -X POST http://127.0.0.1:3001/api/optimize \
  -H "Content-Type: application/json" \
  -d '{"studyId": "study-delhi", "budget": 100000}' | jq '.cellsImproved, .totalCost, .utilization'

# 5. Check AI Key Pool status
curl -s http://127.0.0.1:3001/api/ai/status | jq

# 6. Download publication-ready PDF report
curl -s -O -J "http://127.0.0.1:3001/api/studies/study-delhi/report?format=pdf"
ls -la ecogrid-*.pdf
```

---

## 5. Deployment Options

### Docker Deployment
Build and run the self-contained production container:
```bash
# Build Docker image
docker build -t ecogrid-ai:latest -f Dockerfile .

# Run container mapping port 3000 and 3001
docker run -d -p 3000:3000 -p 3001:3001 --env-file .env ecogrid-ai:latest
```

### Cloud PaaS Deployment (Render / Railway)
- The repository includes a ready-to-deploy [`render.yaml`](file:///d:/hackathon/vit%20code%20apex/ecogridai/render.yaml) specification configuring the Python backend web service and managed PostgreSQL database.
- The web frontend builds to static static assets (`dist/`) deployable directly to **Vercel**, **Netlify**, or **Cloudflare Pages**.

---

## 6. Directory Structure Reference

```text
ecogridai/
├── apps/
│   ├── web/                    # React 18 TypeScript Vite dashboard
│   │   ├── src/
│   │   │   ├── components/     # GridMap, CellInspector, ScenarioLabPage, AIPlanningFeatures
│   │   │   ├── App.tsx         # Main application routes & state orchestrator
│   │   │   ├── api.ts          # Type-safe API client
│   │   │   └── styles.css      # Dark-green glassmorphism design system
│   └── api/                    # Fastify Node.js secondary gateway
├── backend/                    # Python FastAPI analytical core
│   ├── app/
│   │   ├── gis/                # GeoPandas & Rasterio spatial sampling & grid engine
│   │   ├── ml/                 # Random Forest & XGBoost tree suitability models
│   │   ├── optimization/       # Google OR-Tools CP-SAT discrete knapsack optimizer
│   │   ├── graph/              # NetworkX corridor percolation & connectivity
│   │   ├── reporting/          # ReportLab PDF executive brief generator
│   │   ├── services/           # AI planning assistant & Grok/Groq multi-key pool
│   │   ├── models/             # SQLAlchemy / PostGIS database entities
│   │   └── main.py             # FastAPI application router & lifespan hooks
│   ├── data/raw/               # Multispectral GeoTIFFs & vector GeoJSON datasets
│   └── requirements.txt        # Python backend package dependencies
├── packages/
│   ├── domain/                 # Shared TypeScript models & fallback algorithms
│   └── contracts/              # Shared API DTOs and type definitions
├── run.sh                      # Universal bash runner script
├── render.yaml                 # Cloud deployment blueprint
└── WORKFLOW_AND_SETUP.md       # This document
```
