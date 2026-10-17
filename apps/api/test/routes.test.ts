import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authRegisterSchema, optimizeRequestSchema, scenarioCreateSchema } from '@ecogrid/contracts';
import { createGrid, optimizePlan, INTERVENTIONS } from '@ecogrid/domain';
import { app } from '../src/index.js';

const weights = { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

describe('API input contracts', () => {
  it('rejects weights that do not total one hundred', () => {
    expect(() => optimizeRequestSchema.parse({ budget: 1000, weights: { ...weights, heat: 29 }, enabledInterventions: ['native_trees'] })).toThrow('Weights must sum to 100%');
  });

  it('rejects weak email/password registrations', () => {
    expect(() => authRegisterSchema.parse({ email: 'planner@city.example', password: 'short' })).toThrow();
    expect(authRegisterSchema.parse({ email: 'planner@city.example', password: 'sufficiently-long-passphrase' }).email).toBe('planner@city.example');
  });

  it('validates and accepts named scenario requests', () => {
    const scenario = scenarioCreateSchema.parse({ name: 'North Gate shade', budget: 6000, weights, enabledInterventions: ['native_trees'] });
    expect(scenario.name).toBe('North Gate shade');
  });
});

describe('optimizer domain service', () => {
  it('keeps a deterministic API-shaped budget request within the configured budget', () => {
    const plan = optimizePlan(createGrid(), { budget: 6000, weights, enabledInterventions: INTERVENTIONS.map((intervention) => intervention.id) });
    expect(plan.validation.valid).toBe(true);
    expect(plan.totalCost).toBeLessThanOrEqual(6000);
    expect(plan.selected.length).toBeGreaterThan(0);
  });
});

describe('registered Fastify routes', () => {
  it('serves an unauthenticated health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: 'ecogrid-api' });
  });

  it('returns exactly one polygon per seeded analysis cell', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/studies/study-bengaluru-east/cells' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ count: 100, polygons: 100 });
    expect(response.json().cells).toHaveLength(100);
  });

  it('exports the same one-hundred cells as GeoJSON features', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/export?format=geojson' });
    expect(response.statusCode).toBe(200);
    expect(response.json().features).toHaveLength(100);
  });

  it('rejects place searches below the explicit minimum query length before contacting Nominatim', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search?q=ab' });
    expect(response.statusCode).toBe(400);
  });

  it('keeps plan optimization behind the planner/admin authorization boundary', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/optimize', payload: { budget: 1000, weights, enabledInterventions: ['native_trees'] } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatch(/authentication required/i);
  });
});

describe('data confidence routes', () => {
  it('summarises per-study confidence without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/studies/study-bengaluru-east/confidence' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { mean: number; p10: number; p90: number; lowCount: number };
    expect(body.mean).toBeGreaterThan(0);
    expect(body.mean).toBeLessThanOrEqual(1);
    expect(body.p10).toBeLessThanOrEqual(body.p90);
    expect(body.lowCount).toBeGreaterThanOrEqual(0);
  });

  it('serves computed (not constant) confidence on every cell', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/studies/study-bengaluru-east/cells' });
    const cells = response.json().cells as { dataConfidence: number }[];
    expect(cells.every((cell) => cell.dataConfidence >= 0 && cell.dataConfidence <= 1)).toBe(true);
    expect(new Set(cells.map((cell) => cell.dataConfidence.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('exports dataConfidence in CSV so exports can be re-imported', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/export?format=csv' });
    expect(response.statusCode).toBe(200);
    expect(response.body.split('\n')[0]).toContain('dataConfidence');
  });

  it('keeps recompute behind the planner/admin authorization boundary', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/studies/study-bengaluru-east/confidence/recompute', payload: {} });
    expect([401, 403]).toContain(response.statusCode);
  });
});
