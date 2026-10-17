# EcoGrid AI 2.0 — Outcome TODOs

These criteria are transcribed from the approved plan and original product brief. Outcomes remain open until implemented and verified.

## 1. Study-area domain, grid configuration, and deterministic seed data

- [ ] Grid size, cell size, and origin latitude/longitude are configurable per study area; defaults are a 10×10 grid, approximately 0.0012-degree cells, and origin 12.9352, 77.6245. Cell identifiers are A01–J10 for the default grid.
- [ ] The StudyArea model stores name, origin, and grid configuration. Each Cell stores id, row, column, center, `[lat,lng][]` polygon, areaName, landUse (`pedestrian_zone`, `plaza`, `parking`, `building`, `residential`, `green_space`, `sports`, `road`, `mixed`), surfaceType (`soil`, `paved`, `mixed`, `green`, `building`), scores, existingGreenCover, priorityZone, dataConfidence, and capacity.
- [ ] Cell scores include heat risk, vegetation deficit, pedestrian exposure, connectivity need, and feasibility, each in the 0–1 range. Combined Priority is `0.30 heat + 0.25 vegetation + 0.25 pedestrian + 0.20 connectivity`.
- [ ] Risk bands use 0–30 LOW `#7E9C8E`, 31–60 MODERATE `#4CC38A`, 61–80 HIGH `#F3B44E`, and 81–100 CRITICAL `#E35D5D`.
- [ ] Demo cells are generated from a deterministic seeded dataset and use named zones such as North Gate, Academic Block, Central Plaza, Library Corridor, and other recognizable study areas.
- [ ] Keep strict TypeScript with no `any`; package name is `ecogrid-ai`; no API keys or secrets are committed; provide `.env.example`; do not mention code-generation tools anywhere in code, README, comments, or metadata.

## 2. Optimizer, what-if, and connectivity analysis

- [ ] The optimizer is a pure, deterministic backend function with unit tests. Inputs are budget, weights that sum to 100%, enabled interventions, and constraints.
- [ ] Intervention types include native trees, shade structure, pollinator corridor, green buffer, and cool/reflective surface. Each has cost, unit, minimum/default quantity, heat/green/pedestrian/connectivity benefits, allowed surface types and land uses, and minimum feasibility.
- [ ] Generate candidates for each `(cell, intervention)` pair; reject infeasible candidates with a reason. Score candidates by weighted benefit scaled by need and feasibility. Select greedily by benefit per cost under total budget and per-cell capacity. Validate the result and return violations.
- [ ] Optimizer output includes selected and rejected candidates, total cost, remaining budget, utilization, combined benefit, category benefits, cells improved, and validation status.
- [ ] What-if input `(cell, intervention, quantity)` returns before/after scores.
- [ ] Connectivity builds a green-cell graph with components, isolated patches, links, before/after score, and new connections.

## 3. API, persistence, authentication, and local/hosted database support

- [ ] Use Node.js + TypeScript + Fastify + Prisma + Zod + OpenAPI/Swagger. Include rate limiting, structured logging, error handling, health check, CORS, and caching.
- [ ] Implement `/api/studies`, `/api/studies/:id/cells`, `/api/optimize`, `/api/whatif`, `/api/connectivity`, `/api/import`, and `/api/export` (CSV/GeoJSON).
- [ ] Implement `/api/scenarios` CRUD and `/api/scenarios/compare`, and `/api/studies/:id/report` in JSON and PDF formats.
- [ ] Authentication uses email/password and JWT with refresh tokens and roles `admin`, `planner`, and `viewer`.
- [ ] Implement Vitest tests for optimizer and routes; include a seed script.
- [ ] `docker compose up` runs the local API, database, and web. Local uses PostgreSQL; the hosted demo uses the managed MySQL-compatible service. Keep Prisma schema/migrations aligned across the two provider targets and document this approved deployment split. Do not commit secrets.

## 4. Interactive polygon GridMap and map interactions

- [ ] Use Leaflet + react-leaflet v4, OpenStreetMap tiles, Esri World Imagery for satellite, and always-visible correct attribution.
- [ ] A reusable `<GridMap />` renders a visible clickable Leaflet Polygon for every cell on every map page. The default study has exactly 100 polygons. Do not replace polygons with markers/a heatmap and do not overlay a separate SVG/HTML grid.
- [ ] Grid layer uses one dedicated pane above tiles, exactly one polygon per cell, a 1px semi-transparent outline, and approximately 0.5 fill opacity; cells never disappear. Update styles in place (`setStyle`) on layer, selection, hover, budget, weights, or scenario changes; do not remove/re-add the layer. Selected cell has thicker outline and is brought to front.
- [ ] Hover tooltip shows cell ID, area name, active-layer score, and risk label. Optional permanent cell-ID labels may be provided. Keep polygons aligned on zoom, pan, and resize using ResizeObserver and `invalidateSize`; call `fitBounds` with padding on load.
- [ ] Layers include Heat, Vegetation, Pedestrian, Connectivity, Feasibility, Combined Priority, and Recommended Plan (cells with interventions highlighted; others light neutral). Include per-layer legend, opacity slider, and outline toggle.
- [ ] Basemaps include Light, Satellite, and optional Dark. Outline color adapts; basemap selection is remembered.
- [x] Intervention markers use icon/color per type at cell centers, offset when multiple, filterable by type, clickable to open the inspector, and animated after optimization. Markers supplement and never replace cell polygons.
- [ ] Connectivity view overlays green-network polylines for existing versus new links (different styles), flags isolated patches, and colors components over the same polygon grid.
- [ ] Support click selection, Shift-click multi-select, drag-box select, comparing two cells, arrow-key navigation, Enter opening the inspector, and Esc clearing selection. URL state is deep-linkable for layer, cell, zoom, center, and basemap.
- [x] Map controls include zoom, reset view, fullscreen, locate-me, basemap toggle, layer picker, scale bar, coordinates readout, mini-map, themed styling, and touch-friendly operation.

## 5. Study setup, scenarios, analysis, reports, and exports

- [ ] Study setup supports debounced, attributed Nominatim place search; GeoJSON boundary import with automatically generated grid (rows, columns, cell size, rotation); draggable origin; and CSV/GeoJSON score import/export.
- [ ] Scenario comparison supports synchronized side-by-side maps or a swipe slider, plus a delta layer.
- [ ] Export a map PNG with legend and attribution, GeoJSON for visible cells, and read-only share link.
- [ ] Provide What-If Simulator, Connectivity, Impact Analytics, and print-ready Reports pages with functioning analysis actions/results, not static placeholder-only screens.
- [ ] Reporting endpoint returns JSON and PDF; imported data and share/export outputs retain correct geometry and attribution/metadata.

## 6. Product routes, themes, accessibility, and responsive behavior

- [ ] Frontend uses Vite + React 18 + TypeScript + Tailwind + react-router + TanStack Query + Recharts + lucide-react.
- [ ] Include Landing, Login, Overview, Environmental Intelligence, Intervention Planner, Scenario Lab, What-If Simulator, Connectivity, Impact Analytics, Reports, Data Sources, Methodology, and Settings pages.
- [ ] Include a cell inspector drawer; loading, error, and empty states; optimistic updates where sensible.
- [ ] Dark eco-tech theme uses `#071A17` background, `#0B2420` surface, `#164940` border, `#1F8A70` primary, `#4CC38A` accent, and `#B7F7D0` mint, plus a working light theme.
- [ ] Use Inter + JetBrains Mono, consistent spacing/type scale, WCAG AA contrast, keyboard navigation, visible focus states, and aria labels.
- [ ] Responsive layout has a collapsible sidebar and mobile bottom-sheet inspector. Include subtle motion, skeleton loaders, toasts, animated KPI cards, and themed Leaflet controls/tooltips.

## 7. Performance, verification, CI, documentation, and deployment

- [ ] Route-level code splitting; chunks under 500 kB; target Lighthouse performance and accessibility scores of at least 90.
- [ ] Playwright E2E runs on every map page: polygon count equals cell count (100); polygons stay aligned at three zoom levels; click selects; layer switch recolors; reset view refits; basemap toggle keeps polygons; optimize returns a validated plan.
- [ ] GitHub Actions CI runs typecheck, lint, test, and build.
- [ ] README covers description, architecture diagram, local + Docker setup, environment variables, API overview, scripts, tech stack, and deployment guide.
- [ ] Include Dockerfile and docker-compose (API, database, web), `.env.example`, and a production demo configuration that does not depend on private credentials during image compilation.
- [ ] Deliver a deployed demo URL for frontend + API, a changelog of files plus assumptions, and a report of polygons rendered per map page (must be 100).
