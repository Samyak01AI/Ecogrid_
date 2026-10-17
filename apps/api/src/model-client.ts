import { z } from 'zod';
import type { Cell } from '@ecogrid/domain';

/**
 * HTTP client for an external trained-model service.
 *
 * Contract:
 *   POST {MODEL_URL}/predict  { studyId, cells: [{ id, row, col, lat, lng, landUse, surfaceType, existingGreenCover, capacity }] }
 *     -> { modelVersion, predictions: [{ id, heat?, vegetation?, pedestrian?, connectivity?, confidence?, lower?, upper? }] }
 *   GET  {MODEL_URL}/health   -> { ok: true, modelVersion }
 *
 * All score and confidence values are 0-1. Out-of-range values are clamped, never trusted.
 */

export interface ModelConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface ModelRun {
  source: 'model' | 'fallback';
  modelVersion?: string;
  reason?: string;
  at: string;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 3_000;
const SCORE_KEYS = ['heat', 'vegetation', 'pedestrian', 'connectivity'] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Returns undefined when MODEL_URL is missing or not a valid http(s) URL. */
export function modelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig | undefined {
  const raw = env.MODEL_URL?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return undefined; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  const timeout = Number(env.MODEL_TIMEOUT_MS);
  const apiKey = env.MODEL_API_KEY?.trim();
  return {
    url: parsed.toString().replace(/\/+$/, ''),
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  };
}

const number = z.number().finite();
const predictionSchema = z.object({
  id: z.string().min(1),
  heat: number.optional(),
  vegetation: number.optional(),
  pedestrian: number.optional(),
  connectivity: number.optional(),
  confidence: number.optional(),
  lower: number.optional(),
  upper: number.optional(),
});

export const modelResponseSchema = z.object({
  modelVersion: z.string().min(1).max(100),
  predictions: z.array(predictionSchema).min(1),
});

export type ModelPrediction = z.infer<typeof predictionSchema>;
export type ModelResponse = z.infer<typeof modelResponseSchema>;

export function buildModelRequest(studyId: string, cells: readonly Cell[]) {
  return {
    studyId,
    cells: cells.map((cell) => ({
      id: cell.id,
      row: cell.row,
      col: cell.col,
      lat: cell.center[0],
      lng: cell.center[1],
      landUse: cell.landUse,
      surfaceType: cell.surfaceType,
      existingGreenCover: cell.existingGreenCover,
      capacity: cell.capacity,
    })),
  };
}

function headersFor(config: ModelConfig): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json', ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Model service timed out.';
  return 'Model service is unreachable.';
}

/** Calls the model. Throws ModelError on timeout, network failure, non-2xx, or a malformed response. */
export async function callModel(
  studyId: string,
  cells: readonly Cell[],
  config: ModelConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/predict`, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify(buildModelRequest(studyId, cells)),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new ModelError(describeFailure(error));
  }
  if (!response.ok) throw new ModelError(`Model service returned HTTP ${response.status}.`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new ModelError('Model service returned invalid JSON.'); }
  const parsed = modelResponseSchema.safeParse(body);
  if (!parsed.success) throw new ModelError('Model response did not match the expected contract.');
  return parsed.data;
}

export interface AppliedPredictions {
  cells: Cell[];
  /** Cells whose scores and/or confidence changed. */
  updated: number;
  /** Cells the model returned nothing for (left untouched). */
  missing: number;
}

/** Pure: merges predictions into cells. Unknown ids are ignored; unspecified fields keep their current value. */
export function applyPredictions(cells: readonly Cell[], predictions: readonly ModelPrediction[]): AppliedPredictions {
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  let updated = 0;
  let missing = 0;
  const next = cells.map((cell) => {
    const prediction = byId.get(cell.id);
    if (!prediction) { missing += 1; return cell; }
    const scores = { ...cell.scores };
    let changed = false;
    for (const key of SCORE_KEYS) {
      const value = prediction[key];
      if (value !== undefined) { scores[key] = clamp01(value); changed = true; }
    }
    let dataConfidence = cell.dataConfidence;
    if (prediction.confidence !== undefined) { dataConfidence = clamp01(prediction.confidence); changed = true; }
    if (!changed) return cell;
    updated += 1;
    return { ...cell, scores, dataConfidence };
  });
  return { cells: next, updated, missing };
}

export interface ModelHealth {
  configured: boolean;
  reachable: boolean;
  modelVersion?: string;
}

export async function modelHealth(config: ModelConfig | undefined = modelConfig(), fetchImpl: typeof fetch = fetch): Promise<ModelHealth> {
  if (!config) return { configured: false, reachable: false };
  try {
    const response = await fetchImpl(`${config.url}/health`, { headers: headersFor(config), signal: AbortSignal.timeout(Math.min(config.timeoutMs, HEALTH_TIMEOUT_MS)) });
    if (!response.ok) return { configured: true, reachable: false };
    const body = z.object({ ok: z.boolean().optional(), modelVersion: z.string().max(100).optional() }).safeParse(await response.json());
    if (!body.success || body.data.ok === false) return { configured: true, reachable: false };
    return { configured: true, reachable: true, ...(body.data.modelVersion ? { modelVersion: body.data.modelVersion } : {}) };
  } catch {
    return { configured: true, reachable: false };
  }
}
