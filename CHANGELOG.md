

## Trained-model integration — 2026-10-14

- `apps/api/src/model-client.ts` (new): HTTP client with timeout, optional bearer key, Zod-validated responses, value clamping, and a pure `applyPredictions` merge. `ModelError` is raised on timeout, network failure, non-2xx, invalid JSON, or a contract mismatch.
- `apps/api/src/index.ts`: `GET /api/model/health` and planner/admin `POST /api/studies/:id/model/refresh`. On any model failure the existing scores are kept and the response reports `source: "fallback"` with the reason.
- `model-service/` (new): FastAPI stub implementing the contract (deterministic heuristic, not a trained model), Dockerfile, requirements and README. `docker-compose.yml` gets an optional `model` service under the `model` profile.
- `apps/web`: Data Sources page shows model status and has a "Refresh from model" button.
- `.env.example`, `README.md`: `MODEL_URL`, `MODEL_API_KEY`, `MODEL_TIMEOUT_MS`, contract and run instructions.
- Tests: `model-client.test.ts` (unit) and `authenticated.test.ts` (planner/viewer routes using signed test tokens: CSV/GeoJSON confidence import, export round-trip, recompute, plan confidence, model refresh success/failure/fallback).


## Computed, updatable data confidence — 2026-10-14

- `packages/domain/src/confidence.ts` (new): per-source confidence = coverage x freshness x resolution fit x quality, per-layer weighted mean, composite cell confidence, `confidenceSummary`, and benefit-weighted `planConfidence`. Demo inputs are deterministic and **illustrative** (derived from land use / surface type) until real provenance is ingested.
- `packages/domain/src/grid.ts`: replaced the random `dataConfidence` with the computed value; one `random()` call is kept so seeded demo scores are unchanged.
- `apps/api/src/index.ts`: `dataConfidence` is now persisted; CSV (`confidence`/`dataConfidence` column) and GeoJSON (`properties.dataConfidence`) imports update it; CSV export includes it; new `GET /api/studies/:id/confidence` and planner-only `POST /api/studies/:id/confidence/recompute`; `/api/optimize` returns `planConfidence`.
- `apps/web`: the hardcoded "84%" plan-confidence metric now shows the benefit-weighted plan confidence (falls back to mean cell confidence before a plan exists); Data Sources page gets a "Recompute confidence" button.
- Tests: `packages/domain/test/confidence.test.ts`, plus confidence route tests in `apps/api/test/routes.test.ts`.


## Functional map controls — 2026-10-11

- `apps/web/src/components/GridMap.tsx`: added per-intervention type filters, distinct colored glyph markers, cell-centered offsets for co-located treatments, marker-to-inspector clicks, staggered entry motion, a real Leaflet metric/imperial scale, and a tile-backed geographic overview with a synchronized viewport rectangle and click-to-recenter behavior.
- `apps/web/src/styles.css`: styled the new marker/filter, scale, and overview controls for the dark eco-tech theme and responsive layouts.
- `apps/web/e2e/map.spec.ts`: added a focused browser test covering type filtering, marker glyphs, scale, viewport, and provider attribution.

**Assumption:** the overview uses the selected basemap provider, stays five zoom levels wider than the main map, and moves the main view when clicked; source credit is repeated inside the overview as well as on the primary map.


## Managed MySQL TLS container fix — 2026-10-11

- `Dockerfile`: introduced a shared Debian Bookworm base stage with `ca-certificates` and `openssl`, runs `update-ca-certificates`, and carries the same trust store/OpenSSL runtime into both Prisma generation and the production migration stage.
- MySQL connections continue to use `sslaccept=strict`; TLS verification is not disabled.

**Validation note:** local Docker is unavailable in this environment, so the next hosted publish is the authoritative container-level check.
