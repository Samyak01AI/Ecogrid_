import type { Cell, ScoreWeights } from './types.js';

/** A single data source feeding one layer of one cell. */
export interface SourceReading {
  /** 0-1 share of the cell covered by this source. */
  coverage: number;
  ageDays: number;
  resolutionM: number;
  targetResolutionM: number;
  /** 0-1 quality (cloud-free pixels, no gaps, sensor health). */
  quality: number;
}

export interface LayerInput {
  sources: readonly SourceReading[];
  /** 0-1 penalty when independent sources disagree. */
  disagreement?: number;
}

export type CellConfidenceInput = Record<keyof ScoreWeights, LayerInput>;

/** Freshness decay constants (days) per layer: slower-changing layers tolerate older data. */
export const CONFIDENCE_TAU_DAYS: Readonly<Record<keyof ScoreWeights, number>> = {
  heat: 90,
  vegetation: 120,
  pedestrian: 365,
  connectivity: 730,
};

const DEFAULT_WEIGHTS: ScoreWeights = { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };
const LAYER_KEYS = Object.keys(CONFIDENCE_TAU_DAYS) as (keyof ScoreWeights)[];
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** c = coverage x freshness x resolutionFit x quality, all in [0, 1]. */
export function sourceConfidence(source: SourceReading, tauDays: number): number {
  const freshness = Math.exp(-Math.max(0, source.ageDays) / tauDays);
  const resolutionFit = Math.min(1, source.targetResolutionM / Math.max(1, source.resolutionM));
  return clamp01(source.coverage) * freshness * resolutionFit * clamp01(source.quality);
}

export function layerConfidence(input: LayerInput, tauDays: number): number {
  if (input.sources.length === 0) return 0;
  const mean = input.sources.reduce((sum, source) => sum + sourceConfidence(source, tauDays), 0) / input.sources.length;
  return clamp01(mean * (1 - clamp01(input.disagreement ?? 0)));
}

/** Weighted mean of layer confidences, using the same layer weights as the priority score. */
export function computeCellConfidence(input: CellConfidenceInput, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  const total = LAYER_KEYS.reduce((sum, key) => sum + weights[key], 0);
  if (total <= 0) return 0;
  const weighted = LAYER_KEYS.reduce((sum, key) => sum + weights[key] * layerConfidence(input[key], CONFIDENCE_TAU_DAYS[key]), 0);
  return clamp01(weighted / total);
}

/**
 * Deterministic, ILLUSTRATIVE inputs derived from land use and surface type.
 * Replace with real provenance (satellite NDVI/LST, OSM, field counts) when ingestion exists.
 */
export function illustrativeInput(context: Pick<Cell, 'landUse' | 'surfaceType'>): CellConfidenceInput {
  const reading = (ageDays: number, resolutionM: number, quality: number): LayerInput => ({
    sources: [{ coverage: 0.95, ageDays, resolutionM, targetResolutionM: 30, quality }],
  });
  const built = context.surfaceType === 'building' ? 0.85 : 1;
  const mixed = context.surfaceType === 'mixed' ? 0.9 : 1;
  const busy = ['plaza', 'pedestrian_zone', 'road'].includes(context.landUse) ? 0.9 : 0.8;
  return {
    heat: reading(20, 30, 0.92 * built),
    vegetation: reading(45, 10, 0.95 * mixed),
    pedestrian: reading(120, 30, busy),
    connectivity: reading(200, 30, 0.88),
  };
}

export interface ConfidenceSummary {
  mean: number;
  p10: number;
  p90: number;
  /** Cells with confidence below 0.6. */
  lowCount: number;
}

export function confidenceSummary(cells: readonly Pick<Cell, 'dataConfidence'>[]): ConfidenceSummary {
  const values = cells.map((cell) => cell.dataConfidence).sort((a, b) => a - b);
  const quantile = (p: number): number => (values.length ? values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))] ?? 0 : 0);
  return {
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    p10: quantile(0.1),
    p90: quantile(0.9),
    lowCount: values.filter((value) => value < 0.6).length,
  };
}

/** Benefit-weighted mean confidence over the cells a plan selects. */
export function planConfidence(
  cells: readonly Pick<Cell, 'id' | 'dataConfidence'>[],
  selected: readonly { cellId: string; combinedBenefit: number }[],
): number {
  const byId = new Map(cells.map((cell) => [cell.id, cell.dataConfidence]));
  let weight = 0;
  let sum = 0;
  for (const item of selected) {
    const confidence = byId.get(item.cellId);
    if (confidence === undefined) continue;
    weight += item.combinedBenefit;
    sum += item.combinedBenefit * confidence;
  }
  return weight > 0 ? sum / weight : 0;
}
