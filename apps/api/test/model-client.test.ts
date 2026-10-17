import { describe, expect, it, vi } from 'vitest';
import { createGrid } from '@ecogrid/domain';
import { ModelError, applyPredictions, buildModelRequest, callModel, modelConfig, modelHealth, modelResponseSchema } from '../src/model-client.js';

const cells = createGrid();
const config = { url: 'http://model.test', timeoutMs: 1000 };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('modelConfig', () => {
  it('is undefined without a valid http(s) MODEL_URL', () => {
    expect(modelConfig({})).toBeUndefined();
    expect(modelConfig({ MODEL_URL: '  ' })).toBeUndefined();
    expect(modelConfig({ MODEL_URL: 'not a url' })).toBeUndefined();
    expect(modelConfig({ MODEL_URL: 'file:///etc/passwd' })).toBeUndefined();
  });

  it('normalises the URL and clamps the timeout', () => {
    expect(modelConfig({ MODEL_URL: 'http://model:8000/' })).toEqual({ url: 'http://model:8000', timeoutMs: 8000 });
    expect(modelConfig({ MODEL_URL: 'https://m.example', MODEL_API_KEY: 'k', MODEL_TIMEOUT_MS: '999999' })).toEqual({ url: 'https://m.example', apiKey: 'k', timeoutMs: 60000 });
    expect(modelConfig({ MODEL_URL: 'https://m.example', MODEL_TIMEOUT_MS: 'abc' })?.timeoutMs).toBe(8000);
  });
});

describe('buildModelRequest', () => {
  it('sends cell features only, never current scores', () => {
    const request = buildModelRequest('s1', cells);
    expect(request.cells).toHaveLength(100);
    expect(Object.keys(request.cells[0] ?? {}).sort()).toEqual(['capacity', 'col', 'existingGreenCover', 'id', 'landUse', 'lat', 'lng', 'row', 'surfaceType']);
  });
});

describe('callModel', () => {
  it('returns validated predictions and sends the bearer key', async () => {
    const fetchMock = vi.fn(async () => ok({ modelVersion: 'v1', predictions: [{ id: 'A01', heat: 0.5, confidence: 0.9 }] }));
    const result = await callModel('s1', cells, { ...config, apiKey: 'secret' }, fetchMock as unknown as typeof fetch);
    expect(result.modelVersion).toBe('v1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://model.test/predict');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
  });

  it('throws ModelError on HTTP errors, bad JSON, bad contract, network failure and timeout', async () => {
    const asFetch = (fn: () => Promise<Response>) => vi.fn(fn) as unknown as typeof fetch;
    await expect(callModel('s', cells, config, asFetch(async () => ok({}, 500)))).rejects.toThrow('HTTP 500');
    await expect(callModel('s', cells, config, asFetch(async () => new Response('nope', { status: 200 })))).rejects.toThrow('invalid JSON');
    await expect(callModel('s', cells, config, asFetch(async () => ok({ modelVersion: 'v', predictions: [] })))).rejects.toThrow('contract');
    await expect(callModel('s', cells, config, asFetch(async () => { throw new TypeError('fetch failed'); }))).rejects.toThrow('unreachable');
    await expect(callModel('s', cells, config, asFetch(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }))).rejects.toBeInstanceOf(ModelError);
  });

  it('rejects non-finite values in predictions', () => {
    expect(modelResponseSchema.safeParse({ modelVersion: 'v', predictions: [{ id: 'A01', heat: Number.NaN }] }).success).toBe(false);
  });
});

describe('applyPredictions', () => {
  it('updates scores and confidence, clamps to [0,1], keeps other fields', () => {
    const before = cells[0]!;
    const { cells: next, updated, missing } = applyPredictions(cells, [{ id: before.id, heat: 1.7, vegetation: -2, confidence: 0.4 }, { id: 'ZZ99', heat: 0.1 }]);
    const after = next[0]!;
    expect(updated).toBe(1);
    expect(missing).toBe(99);
    expect(after.scores.heat).toBe(1);
    expect(after.scores.vegetation).toBe(0);
    expect(after.scores.pedestrian).toBe(before.scores.pedestrian);
    expect(after.scores.feasibility).toBe(before.scores.feasibility);
    expect(after.dataConfidence).toBe(0.4);
    expect(next[1]).toBe(cells[1]);
  });

  it('leaves a cell untouched when the prediction carries no usable fields', () => {
    const { cells: next, updated } = applyPredictions(cells, [{ id: cells[0]!.id }]);
    expect(updated).toBe(0);
    expect(next[0]).toBe(cells[0]);
  });
});

describe('modelHealth', () => {
  it('reports not configured, reachable and unreachable', async () => {
    expect(await modelHealth(undefined)).toEqual({ configured: false, reachable: false });
    const good = vi.fn(async () => ok({ ok: true, modelVersion: 'v9' })) as unknown as typeof fetch;
    expect(await modelHealth(config, good)).toEqual({ configured: true, reachable: true, modelVersion: 'v9' });
    const bad = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await modelHealth(config, bad)).toEqual({ configured: true, reachable: false });
  });
});
