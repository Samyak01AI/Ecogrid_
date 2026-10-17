# EcoGrid AI 2.0 — Implementation Plan

## Product scope and implementation approach

Build the requested urban-climate intervention planner as a full-stack TypeScript application. The visible 10×10 grid is the product's core interaction: each grid cell is rendered as an individual clickable Leaflet polygon above the map tiles on every map-bearing route. Keep the polygon layer mounted and update styles in place; use the same cell dataset for all analysis, what-if, scenario, analytics, and export flows.

The optimizer and spatial/domain calculations will live in a pure shared package, independent of HTTP and persistence. The Fastify API will validate inputs and outputs with Zod, expose OpenAPI documentation, apply auth/role rules and operational middleware, and persist studies, scenarios, accounts, and audit-friendly results through Prisma. The Vite/React client will use route-level code splitting, React Router, TanStack Query, Tailwind, Recharts, Leaflet/react-leaflet v4, and lucide-react.

### Database compatibility decision

The user approved PostgreSQL for the local Docker experience and the managed MySQL-compatible database for the hosted demo. Preserve Prisma in both cases by maintaining PostgreSQL and MySQL schema/migration targets with matching application entities, generating a provider-appropriate Prisma client at install/build time, and selecting the client from server-side runtime configuration. `docker compose up` will run the API, web app, and PostgreSQL locally. The hosted container will use the platform-managed MySQL database and runtime-provided `DATABASE_URL`. The README and `.env.example` will make this distinction explicit. No credential values will be committed or exposed to the browser.

### Domain model and deterministic data

Define StudyArea, GridConfig, Cell, Scores, Intervention, Candidate, OptimizerInput/Result, Scenario, User, and RefreshSession in a shared domain package. Generate configurable rectangular grids (default 10×10; origin 12.9352, 77.6245; nominal cell size ~0.0012 degrees), stable A01–J10 IDs, [lat,lng] rings/centers, seeded scores, capacity, feasibility, and named Bengaluru demo zones. Use a fixed PRNG seed so repeated seeds and tests return identical cell inputs and plans. Preserve the specified priority weights and risk-band thresholds/colors.

Intervention optimization will enumerate every enabled (cell, intervention) pair, attach explicit infeasibility reasons, calculate need- and feasibility-adjusted weighted benefit per cost, apply the greedy budget/cell-capacity selection, and return totals, per-category effects, improved cells, and validation violations. Independent pure functions will handle before/after what-if scoring and graph-based connectivity components, isolated green patches, and proposed links. Vitest will cover deterministic outputs, budget/capacity constraints, rejected-candidate reasons, weight validation, what-if deltas, connectivity, and representative Fastify route/auth behavior.

### API and access control

Build a versioned Fastify API with health/readiness endpoints, Pino logging, CORS allow-listing, rate limiting, cache headers for safe public reads, common error envelopes, Zod request validation, and Swagger/OpenAPI docs. Include the requested study/cell, optimize, what-if, connectivity, import/export (CSV and GeoJSON), scenario CRUD/compare, and JSON/print-ready PDF report routes. Add email/password registration and login, hashed passwords, short-lived signed access JWTs, rotating refresh tokens stored hashed server-side, logout/revocation, and admin/planner/viewer authorization. New registrations default to viewer; seeded admin configuration is supplied only through runtime environment variables. Cookie-backed sessions use the Preview-compatible `webdev_app_session` name with `SameSite=None; Secure` for public HTTPS, while local plain-HTTP handling is kept separate. API requests may also use bearer tokens.

### Map and product experience

Create a reusable GridMap component shared by Environmental Intelligence, Intervention Planner, Scenario Lab, What-If Simulator, Connectivity, and map-enabled analytics. Keep exactly one polygon per study cell in its dedicated pane above base tiles, with 1px translucent outline and roughly 0.5 fill opacity. Style changes for active layer, selection, hover, optimizer results, and scenarios use Leaflet layer `setStyle`; never remove/re-add the polygon layer for state updates. Selection brings the selected polygon forward. Tooltips show cell ID, named area, active-layer score, and risk label. Support keyboard selection/navigation, shift multi-select, two-cell comparison, drag-box selection, deep links, fitting/reset, resize invalidation, touch use, and the required map controls.

Offer Heat, Vegetation, Pedestrian, Connectivity, Feasibility, Combined Priority, and Recommended Plan layers with dynamic legend, opacity, and outline controls. Provide OSM Light and Esri World Imagery basemaps with attribution and remembered selection; an optional dark basemap can be added without making any paid tile service a dependency. Recommended interventions appear as supplemental, filterable markers, never as a replacement for the polygons. Connectivity links/isolated components are supplemental polylines/flags over the same grid. Implement place search via debounced, attributed Nominatim requests; CSV/GeoJSON imports/exports; GeoJSON boundaries and configurable grid creation; synchronized scenario maps/delta view; read-only share links; and PNG map export with legend/attribution.

Ship the Landing, Login, Overview, Environmental Intelligence, Intervention Planner, Scenario Lab, What-If Simulator, Connectivity, Impact Analytics, Reports, Data Sources, Methodology, and Settings routes. Preserve usable loading/error/empty states, an inspector drawer (mobile bottom sheet), theme switching, settings and responsive navigation. Core flows remain useful with deterministic seeded demo data before a user imports a study.

### Project structure

```text
apps/
  web/                    Vite + React 18 + TypeScript; routes, shared UI, map, charts, API client
  api/                    Fastify server, auth, schemas, route plugins, services, persistence adapters
packages/
  domain/                 Strict types, scoring, grid generation, seeded fixture and optimizer
  database/               Prisma PostgreSQL/MySQL schemas, migrations, provider-specific clients
  contracts/              Shared Zod API contracts and inferred TypeScript types
  config/                 Shared strict TypeScript, ESLint and test settings
prisma/
  postgres/               Local Docker/PostgreSQL schema and migrations
  mysql/                  Hosted managed-MySQL schema and migrations
playwright/               E2E coverage for every map route and core interactions
.github/workflows/        CI: typecheck, lint, unit tests, E2E/build as appropriate
Dockerfile                Production web/API image for the managed container runtime
docker-compose.yml        Local web/API/PostgreSQL topology
.env.example              Names and safe placeholders only; never real secrets
README.md                 Product, architecture, local/Docker use, env, API, deployment
plan.md                   This implementation/design record
TODO.md                   Complete acceptance clauses grouped by delivered outcome
```

### Dependencies and serving

Use pnpm workspaces with a pinned package-manager version and a committed lockfile plus reviewed lifecycle-script policy. Keep frontend and backend source in one repository while allowing the production container to serve the built client and API from one origin (relative API URLs). During development, Vite proxies API requests to the Fastify process. Local Docker Compose provides PostgreSQL and API/web services; hosted deployment reads `DATABASE_URL` at runtime and never requires it during image compilation. Provide a public unauthenticated health endpoint for deployment readiness. Avoid API keys in the frontend; OSM/Esri tiles use their public tile services and correct attribution. The public demo will run against the managed MySQL schema/adapter; local Postgres migrations and seed scripts remain runnable independently.

### Product design

- **Design Movement:** restrained climate-tech instrument panel, combining ecological field science with contemporary cartographic software.
- **Core Principles:** map-first spatial clarity; actionable rather than ornamental data; calm contrast with risk colors reserved for meaning; accessible controls and legible dense information.
- **Color Philosophy:** use the requested deep forest canvas (`#071A17`) and layered green surfaces (`#0B2420`, `#164940`) to frame the data as a field instrument; `#1F8A70`, `#4CC38A`, and `#B7F7D0` express intervention and recovery, while the specified amber/red/gray-green risk colors remain semantically consistent. Include a working light theme with equivalent contrast.
- **Layout Paradigm:** an asymmetric analysis workbench: compact collapsible rail, generous map canvas, and contextual inspector/decision panel. Put study navigation and action controls around the map rather than centering the entire app in generic cards.
- **Signature Elements:** fine survey-grid linework; a small contour/leaf brand mark; compact monospaced cell IDs and measurements.
- **Interaction Philosophy:** selection and layer changes update the same visible geography immediately; keyboard and touch affordances are first-class; destructive/import actions are explicit and status is visible.
- **Animation:** brief opacity/position transitions for drawers and KPI changes; subtle intervention-marker entrances after optimization; no looping ambient motion or animation that delays map interaction.
- **Typography System:** Inter for interface/headline text, JetBrains Mono for cell IDs, scores, coordinates, and tabular metrics. Use a compact but consistent hierarchy, with numeric values tabular and readable at dense dashboard sizes.
- **Brand Essence:** a decision workbench that helps city planners choose where limited climate budgets can protect people and restore green links; **precise, grounded, optimistic**.
- **Brand Voice:** concise, evidence-led, action-oriented. Example lines: “Put every climate dollar on the map.” “Start with the hottest block. See what changes.”
- **Wordmark & Logo:** custom EcoGrid wordmark paired with a geometric leaf formed from two intersecting survey-cell outlines; use as favicon and compact sidebar mark.
- **Signature Brand Color:** living green `#4CC38A`, used as an ownable highlight for positive interventions, not as a substitute for risk-band colors.

### Build workflow

1. Create the workspace, shared domain/data model, seed dataset, and typed app structure.
2. Implement and test the deterministic optimizer, what-if, connectivity and export calculations.
3. Implement persistence, Fastify routes, auth/roles, OpenAPI, PostgreSQL and managed-MySQL providers, and API tests.
4. Implement the reusable polygon-based GridMap and required map interactions/layers.
5. Build the named pages, analyses, scenarios, reporting, responsive layout and light/dark themes.
6. Add Playwright map-flow coverage, lint/typecheck/test/build scripts, CI, Dockerfile, Compose, README, route manifest, and `.env.example`.
7. Configure preview/production serving, commit a checkpoint, deploy the demo, verify its public health/API and report exact polygon counts per map route.
