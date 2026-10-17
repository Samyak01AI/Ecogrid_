import { SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.js';

const STUDY = 'study-bengaluru-east';
const weights = { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };

async function bearer(role: 'viewer' | 'planner' | 'admin'): Promise<{ authorization: string }> {
  const token = await new SignJWT({ email: `${role}@example.test`, role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(`test-${role}`).setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.ECOGRID_JWT_ACCESS_SECRET));
  return { authorization: `Bearer ${token}` };
}

type CellView = { id: string; dataConfidence: number; scores: Record<string, number> };
async function cellsNow(): Promise<CellView[]> {
  return (await app.inject({ method: 'GET', url: `/api/studies/${STUDY}/cells` })).json().cells as CellView[];
}
const byId = (cells: CellView[], id: string): CellView => cells.find((cell) => cell.id === id)!;
const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.MODEL_URL; });

describe('confidence import and recompute (authenticated)', () => {
  it('forbids viewers from importing, recomputing or refreshing from a model', async () => {
    const headers = await bearer('viewer');
    expect((await app.inject({ method: 'POST', url: '/api/import', headers, payload: { studyId: STUDY, format: 'csv', content: 'id,confidence\nA01,0.5' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/confidence/recompute`, headers, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/model/refresh`, headers, payload: {} })).statusCode).toBe(403);
  });

  it('imports a CSV confidence column, clamps it, and leaves scores alone', async () => {
    const before = byId(await cellsNow(), 'A01').scores;
    const headers = await bearer('planner');
    const response = await app.inject({ method: 'POST', url: '/api/import', headers, payload: { studyId: STUDY, format: 'csv', content: 'id,confidence\nA01,0.42\nA02,1.7\nA03,not-a-number' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().imported).toBe(2);
    const cells = await cellsNow();
    expect(byId(cells, 'A01').dataConfidence).toBe(0.42);
    expect(byId(cells, 'A02').dataConfidence).toBe(1);
    expect(byId(cells, 'A01').scores).toEqual(before);
  });

  it('imports GeoJSON properties.dataConfidence and rejects out-of-range values', async () => {
    const headers = await bearer('planner');
    const collection = (value: number) => JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'B01', scores: {}, dataConfidence: value } }] });
    const good = await app.inject({ method: 'POST', url: '/api/import', headers, payload: { studyId: STUDY, format: 'geojson', content: collection(0.33) } });
    expect(good.statusCode).toBe(200);
    expect(byId(await cellsNow(), 'B01').dataConfidence).toBe(0.33);
    const bad = await app.inject({ method: 'POST', url: '/api/import', headers, payload: { studyId: STUDY, format: 'geojson', content: collection(1.5) } });
    expect(bad.statusCode).toBe(400);
  });

  it('round-trips the exported CSV back through import', async () => {
    const headers = await bearer('planner');
    const csv = (await app.inject({ method: 'GET', url: `/api/export?format=csv&studyId=${STUDY}` })).body;
    const response = await app.inject({ method: 'POST', url: '/api/import', headers, payload: { studyId: STUDY, format: 'csv', content: csv } });
    expect(response.statusCode).toBe(200);
    expect(response.json().imported).toBe(100);
  });

  it('recomputes confidence deterministically and reports a summary', async () => {
    const headers = await bearer('planner');
    const first = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/confidence/recompute`, headers, payload: {} });
    expect(first.statusCode).toBe(200);
    expect(first.json().recomputed).toBe(100);
    const snapshot = (await cellsNow()).map((cell) => cell.dataConfidence);
    const second = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/confidence/recompute`, headers, payload: {} });
    expect(second.json().mean).toBeCloseTo(first.json().mean, 10);
    expect((await cellsNow()).map((cell) => cell.dataConfidence)).toEqual(snapshot);
  });

  it('returns a computed planConfidence from /api/optimize', async () => {
    const headers = await bearer('planner');
    const response = await app.inject({ method: 'POST', url: '/api/optimize', headers, payload: { budget: 6000, weights, enabledInterventions: ['native_trees', 'shade_structure'] } });
    expect(response.statusCode).toBe(200);
    const confidence = response.json().planConfidence as number;
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
    expect(confidence).not.toBe(0.84);
  });
});

describe('model refresh (authenticated)', () => {
  it('falls back and keeps scores when MODEL_URL is not configured', async () => {
    const before = await cellsNow();
    const response = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/model/refresh`, headers: await bearer('planner'), payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'fallback', updated: 0 });
    expect(await cellsNow()).toEqual(before);
  });

  it('applies model predictions and records the model version', async () => {
    process.env.MODEL_URL = 'http://model.test';
    const fetchMock = vi.fn(async () => jsonOk({ modelVersion: 'unit-1', predictions: [{ id: 'C05', heat: 1.4, confidence: 0.55 }, { id: 'ZZ99', heat: 0.2 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/model/refresh`, headers: await bearer('admin'), payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'model', modelVersion: 'unit-1', updated: 1, missing: 99 });
    const cell = byId(await cellsNow(), 'C05');
    expect(cell.scores.heat).toBe(1);
    expect(cell.dataConfidence).toBe(0.55);
    const health = await app.inject({ method: 'GET', url: `/api/model/health?studyId=${STUDY}` });
    expect(health.json()).toMatchObject({ configured: true, lastRun: { source: 'model', modelVersion: 'unit-1' } });
  });

  it('keeps existing scores when the model is down or returns garbage', async () => {
    process.env.MODEL_URL = 'http://model.test';
    const before = await cellsNow();
    const headers = await bearer('planner');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const down = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/model/refresh`, headers, payload: {} });
    expect(down.json()).toMatchObject({ source: 'fallback', updated: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => jsonOk({ modelVersion: 'x', predictions: [] })));
    const garbage = await app.inject({ method: 'POST', url: `/api/studies/${STUDY}/model/refresh`, headers, payload: {} });
    expect(garbage.json()).toMatchObject({ source: 'fallback', updated: 0 });
    expect(await cellsNow()).toEqual(before);
  });

  it('reports model health as unreachable when /health fails', async () => {
    process.env.MODEL_URL = 'http://model.test';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const health = await app.inject({ method: 'GET', url: '/api/model/health' });
    expect(health.json()).toMatchObject({ configured: true, reachable: false });
  });
});
