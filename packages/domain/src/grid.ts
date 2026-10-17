import type { Cell, LayerKey, LatLng, RiskBand, StudyArea } from './types.js';
import { computeCellConfidence, illustrativeInput } from './confidence.js';
import type { ScoreWeights } from './types.js';

export const DEFAULT_STUDY: StudyArea = {
  id: 'study-bengaluru-east',
  name: 'Bengaluru East Campus',
  origin: [12.9352, 77.6245],
  rows: 10,
  columns: 10,
  cellSizeLat: 0.0012,
  cellSizeLng: 0.0012,
  rotation: 0,
};

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function rowLabel(index: number): string {
  let remaining = index + 1;
  let label = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % ROW_LABELS.length;
    label = `${ROW_LABELS[digit]}${label}`;
    remaining = Math.floor((remaining - 1) / ROW_LABELS.length);
  }
  return label;
}

function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rotatePoint(latitude: number, longitude: number, origin: LatLng, degrees: number): LatLng {
  if (degrees === 0) return [latitude, longitude];
  const radians = (degrees * Math.PI) / 180;
  const dLng = longitude - origin[1];
  const dLat = latitude - origin[0];
  return [origin[0] + dLat * Math.cos(radians) - dLng * Math.sin(radians), origin[1] + dLat * Math.sin(radians) + dLng * Math.cos(radians)];
}

function namedZone(row: number, col: number): string {
  if (row <= 1 && col <= 3) return 'North Gate';
  if (row <= 3 && col >= 4 && col <= 7) return 'Academic Block';
  if (row >= 4 && row <= 6 && col >= 3 && col <= 6) return 'Central Plaza';
  if (col <= 2 && row >= 3 && row <= 7) return 'Library Corridor';
  if (row >= 7 && col <= 4) return 'Garden Edge';
  if (row >= 7 && col >= 7) return 'Sports Ground';
  if (col >= 8) return 'East Service Road';
  if (row <= 2) return 'Transit Walk';
  return 'Teaching Quad';
}

function cellContext(row: number, col: number): { landUse: Cell['landUse']; surfaceType: Cell['surfaceType']; capacity: number } {
  if (row >= 7 && col <= 4) return { landUse: 'green_space', surfaceType: 'green', capacity: 5 };
  if (row >= 7 && col >= 7) return { landUse: 'sports', surfaceType: 'mixed', capacity: 3 };
  if ((row === 4 || row === 5) && (col === 4 || col === 5)) return { landUse: 'plaza', surfaceType: 'paved', capacity: 4 };
  if (col === 8 || col === 9) return { landUse: 'road', surfaceType: 'paved', capacity: 2 };
  if (row <= 1 && col <= 3) return { landUse: 'pedestrian_zone', surfaceType: 'mixed', capacity: 4 };
  if (row <= 3 && col >= 4 && col <= 7) return { landUse: 'building', surfaceType: 'building', capacity: 0 };
  if (col <= 2) return { landUse: 'residential', surfaceType: 'mixed', capacity: 3 };
  if (row === 6 && col >= 7) return { landUse: 'parking', surfaceType: 'paved', capacity: 3 };
  if (row === 2 && col <= 3) return { landUse: 'plaza', surfaceType: 'mixed', capacity: 3 };
  return { landUse: 'mixed', surfaceType: 'mixed', capacity: 3 };
}

export function createGrid(study: StudyArea = DEFAULT_STUDY, seed = 20261010): Cell[] {
  const random = randomFromSeed(seed);
  const cells: Cell[] = [];
  const halfLat = study.cellSizeLat / 2;
  const halfLng = study.cellSizeLng / 2;

  for (let row = 0; row < study.rows; row += 1) {
    for (let col = 0; col < study.columns; col += 1) {
      const unrotatedCenter: LatLng = [study.origin[0] + (row + 0.5) * study.cellSizeLat, study.origin[1] + (col + 0.5) * study.cellSizeLng];
      const center = rotatePoint(unrotatedCenter[0], unrotatedCenter[1], study.origin, study.rotation);
      const unrotatedCorners: LatLng[] = [
        [unrotatedCenter[0] - halfLat, unrotatedCenter[1] - halfLng],
        [unrotatedCenter[0] + halfLat, unrotatedCenter[1] - halfLng],
        [unrotatedCenter[0] + halfLat, unrotatedCenter[1] + halfLng],
        [unrotatedCenter[0] - halfLat, unrotatedCenter[1] + halfLng],
      ];
      const corners = unrotatedCorners.map((point) => rotatePoint(point[0], point[1], study.origin, study.rotation));
      const firstCorner = corners[0];
      const polygon = firstCorner ? [...corners, firstCorner] : corners;
      const context = cellContext(row, col);
      const zone = namedZone(row, col);
      const urbanFactor = context.surfaceType === 'paved' ? 0.20 : context.surfaceType === 'green' ? -0.18 : 0;
      const pedestrianFactor = ['plaza', 'pedestrian_zone', 'road'].includes(context.landUse) ? 0.2 : context.landUse === 'building' ? -0.08 : 0;
      const heat = clamp(0.28 + (row / Math.max(1, study.rows - 1)) * 0.30 + urbanFactor + (random() - 0.5) * 0.25);
      const vegetation = clamp(0.55 + urbanFactor * 0.75 + (random() - 0.5) * 0.28);
      const pedestrian = clamp(0.35 + pedestrianFactor + (random() - 0.5) * 0.34);
      const connectivity = clamp(0.42 + (random() - 0.5) * 0.50 + (context.surfaceType === 'green' ? -0.16 : 0.06));
      const feasibility = context.capacity === 0 ? 0.08 : clamp(0.90 - (context.surfaceType === 'building' ? 0.62 : 0) - (context.surfaceType === 'paved' ? 0.16 : 0) + (random() - 0.5) * 0.18);
      const existingGreenCover = context.surfaceType === 'green' ? clamp(0.52 + random() * 0.42) : clamp(0.04 + random() * 0.23);
      void random(); // keeps the seeded sequence identical to earlier releases so demo scores do not shift
      cells.push({
        id: `${rowLabel(row)}${String(col + 1).padStart(2, '0')}`,
        row,
        col,
        center,
        polygon,
        areaName: zone,
        landUse: context.landUse,
        surfaceType: context.surfaceType,
        scores: { heat, vegetation, pedestrian, connectivity, feasibility },
        existingGreenCover,
        priorityZone: heat >= 0.68 || pedestrian >= 0.72,
        dataConfidence: computeCellConfidence(illustrativeInput({ landUse: context.landUse, surfaceType: context.surfaceType })),
        capacity: context.capacity,
      });
    }
  }
  return cells;
}

export function combinedPriority(scores: Pick<Cell['scores'], 'heat' | 'vegetation' | 'pedestrian' | 'connectivity'>, weights: ScoreWeights = { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 }): number {
  const total = weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity;
  if (total <= 0) return 0;
  return clamp((scores.heat * weights.heat + scores.vegetation * weights.vegetation + scores.pedestrian * weights.pedestrian + scores.connectivity * weights.connectivity) / total);
}

export function riskBand(score: number): RiskBand {
  const scaled = Math.round(clamp(score) * 100);
  if (scaled <= 30) return 'LOW';
  if (scaled <= 60) return 'MODERATE';
  if (scaled <= 80) return 'HIGH';
  return 'CRITICAL';
}

export function layerScore(cell: Cell, layer: LayerKey): number {
  if (layer === 'priority' || layer === 'recommended') return combinedPriority(cell.scores);
  return cell.scores[layer];
}

export function gridBounds(cells: readonly Cell[]): [[number, number], [number, number]] {
  const points = cells.flatMap((cell) => cell.polygon);
  const latitudes = points.map(([latitude]) => latitude);
  const longitudes = points.map(([, longitude]) => longitude);
  return [[Math.min(...latitudes), Math.min(...longitudes)], [Math.max(...latitudes), Math.max(...longitudes)]];
}
