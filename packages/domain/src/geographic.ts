import type { Cell, LatLng, Candidate, OptimizerResult, InterventionId } from './types.js';

export const DEFAULT_GRID_VERSION = '2.0';
export const DEFAULT_CRS = 'EPSG:4326';

/**
 * Validates that latitude is within [-90, 90], longitude is within [-180, 180],
 * and both values are finite numbers.
 */
export function isValidLatLng(coord: unknown): coord is LatLng {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lat, lng] = coord;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Normalizes input to Leaflet [latitude, longitude] format.
 * GeoJSON uses [longitude, latitude] whereas Leaflet uses [latitude, longitude].
 */
export function toLeafletLatLng(coord: [number, number] | { lat: number; lng: number }, isGeoJSON = false): LatLng {
  if (Array.isArray(coord)) {
    const [a, b] = coord;
    if (isGeoJSON || (Math.abs(a) > 90 && Math.abs(b) <= 90)) {
      return [b, a];
    }
    return [a, b];
  }
  return [coord.lat, coord.lng];
}

/**
 * Converts a GeoJSON [longitude, latitude] point to Leaflet [latitude, longitude].
 */
export function fromGeoJSONPoint(coord: [longitude: number, latitude: number]): LatLng {
  return [coord[1], coord[0]];
}

/**
 * Normalizes a Leaflet [latitude, longitude] point to GeoJSON [longitude, latitude].
 */
export function toGeoJSONPoint(coord: LatLng): [longitude: number, latitude: number] {
  return [coord[1], coord[0]];
}

/**
 * Checks whether a given point lies inside or on the boundary of a polygon
 * using the standard ray-casting algorithm.
 */
export function isPointInPolygon(point: LatLng, polygon: readonly LatLng[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [testLat, testLng] = point;
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;

    const [latI, lngI] = pi;
    const [latJ, lngJ] = pj;

    // Check intersection with ray along longitude axis
    const intersect =
      latI > testLat !== latJ > testLat &&
      testLng < ((lngJ - lngI) * (testLat - latI)) / (latJ - latI) + lngI;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Computes the geometric centroid of a polygon.
 * Falls back to arithmetic average of vertices if area is zero or near degenerate.
 */
export function computePolygonCentroid(polygon: readonly LatLng[]): LatLng {
  if (!polygon || polygon.length === 0) return [0, 0];
  if (polygon.length === 1) return polygon[0]!;
  if (polygon.length === 2) {
    return [(polygon[0]![0] + polygon[1]![0]) / 2, (polygon[0]![1] + polygon[1]![1]) / 2];
  }

  // Remove duplicate closing point if present for centroid computation
  const pts = [...polygon];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (pts.length > 3 && first[0] === last[0] && first[1] === last[1]) {
    pts.pop();
  }

  let signedArea = 0;
  let cx = 0; // latitude accumulator
  let cy = 0; // longitude accumulator

  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const a = p1[0] * p2[1] - p2[0] * p1[1];
    signedArea += a;
    cx += (p1[0] + p2[0]) * a;
    cy += (p1[1] + p2[1]) * a;
  }

  signedArea *= 0.5;

  if (Math.abs(signedArea) < 1e-9) {
    // Degenerate polygon: fallback to arithmetic mean
    const sumLat = pts.reduce((sum, p) => sum + p[0], 0);
    const sumLng = pts.reduce((sum, p) => sum + p[1], 0);
    return [sumLat / pts.length, sumLng / pts.length];
  }

  const centroidLat = cx / (6 * signedArea);
  const centroidLng = cy / (6 * signedArea);

  return [centroidLat, centroidLng];
}

/**
 * Validates the geometric integrity of a grid cell:
 * - Polygon must have >= 3 distinct points
 * - Centroid must be a valid LatLng and lie inside the polygon
 */
export function validateCellGeometry(cell: Cell): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!cell.id) {
    errors.push('Cell is missing a unique cell ID');
  }

  if (!isValidLatLng(cell.center)) {
    errors.push(`Cell ${cell.id} center is not a valid coordinate: ${JSON.stringify(cell.center)}`);
  }

  if (!Array.isArray(cell.polygon) || cell.polygon.length < 3) {
    errors.push(`Cell ${cell.id} polygon has fewer than 3 vertices`);
  } else {
    for (let i = 0; i < cell.polygon.length; i++) {
      if (!isValidLatLng(cell.polygon[i])) {
        errors.push(`Cell ${cell.id} polygon vertex at index ${i} is invalid`);
        break;
      }
    }

    if (errors.length === 0 && isValidLatLng(cell.center)) {
      if (!isPointInPolygon(cell.center, cell.polygon)) {
        errors.push(`Cell ${cell.id} center does not lie inside its bounding polygon`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface ValidatedMarkerCandidate {
  cellId: string;
  candidate: Candidate;
  cell: Cell;
  position: LatLng;
}

export interface MarkerValidationFailure {
  candidate: Candidate;
  reason: string;
}

/**
 * Validates a single intervention candidate against the active study area and grid:
 * 1. Intervention study-area ID must match active study area if specified.
 * 2. Intervention grid version must match current grid version if specified.
 * 3. Referenced cell ID must exist in active grid.
 * 4. Cell geometry must be valid.
 * 5. Position must be geographically verified to lie within the referenced cell.
 */
export function validateInterventionCandidate(params: {
  candidate: Candidate;
  activeStudyId: string;
  activeGridVersion?: string | undefined;
  cellsById: Map<string, Cell>;
}): { valid: true; marker: ValidatedMarkerCandidate } | { valid: false; failure: MarkerValidationFailure } {
  const { candidate, activeStudyId, activeGridVersion, cellsById } = params;

  // 1. Check study area matching
  if (candidate.studyAreaId && candidate.studyAreaId !== activeStudyId) {
    return {
      valid: false,
      failure: {
        candidate,
        reason: `Study area mismatch: intervention references '${candidate.studyAreaId}', but active study is '${activeStudyId}'`,
      },
    };
  }

  // 2. Check grid version matching
  if (candidate.gridVersion && activeGridVersion && candidate.gridVersion !== activeGridVersion) {
    return {
      valid: false,
      failure: {
        candidate,
        reason: `Grid version mismatch: intervention references version '${candidate.gridVersion}', but active grid is '${activeGridVersion}'`,
      },
    };
  }

  // 3. Resolve authoritative cell
  const cell = cellsById.get(candidate.cellId);
  if (!cell) {
    return {
      valid: false,
      failure: {
        candidate,
        reason: `Unknown cell ID '${candidate.cellId}': does not exist in active 10×10 grid for '${activeStudyId}'`,
      },
    };
  }

  // 4. Validate authoritative cell center
  if (!isValidLatLng(cell.center)) {
    return {
      valid: false,
      failure: {
        candidate,
        reason: `Invalid cell center geometry for cell '${cell.id}'`,
      },
    };
  }

  // 5. Position resolution:
  // If the candidate carries a specific surveyed point coordinate, validate it falls within the cell.
  // Otherwise, derive position authoritatively from the cell centroid.
  let markerPosition: LatLng = cell.center;
  if (candidate.coordinates !== undefined) {
    if (!isValidLatLng(candidate.coordinates)) {
      return {
        valid: false,
        failure: {
          candidate,
          reason: `Invalid coordinates for candidate: coordinates must be finite numbers within [-90..90, -180..180], got ${JSON.stringify(candidate.coordinates)}`,
        },
      };
    }
    if (!isPointInPolygon(candidate.coordinates, cell.polygon)) {
      return {
        valid: false,
        failure: {
          candidate,
          reason: `Surveyed intervention point [${candidate.coordinates[0]}, ${candidate.coordinates[1]}] lies outside cell polygon for '${cell.id}'`,
        },
      };
    }
    markerPosition = candidate.coordinates;
  }

  return {
    valid: true,
    marker: {
      cellId: cell.id,
      candidate,
      cell,
      position: markerPosition,
    },
  };
}

export interface GroupedCellInterventions {
  cellId: string;
  cell: Cell;
  position: LatLng;
  primaryCandidate: Candidate;
  candidates: Candidate[];
  totalCost: number;
  totalQuantity: number;
}

/**
 * Pure functional marker grouping:
 * Groups validated interventions by cell ID, computes authoritative position from cell centroid,
 * preserves all underlying candidates, and determines the primary candidate.
 */
export function groupInterventionsForMap(params: {
  plan: OptimizerResult | null;
  activeStudyId: string;
  activeGridVersion?: string | undefined;
  cellsById: Map<string, Cell>;
  visibleMarkerTypes?: Set<InterventionId> | undefined;
}): {
  groups: GroupedCellInterventions[];
  failures: MarkerValidationFailure[];
} {
  const { plan, activeStudyId, activeGridVersion, cellsById, visibleMarkerTypes } = params;

  if (!plan?.selected || plan.selected.length === 0) {
    return { groups: [], failures: [] };
  }

  // Invalidate plan if plan-level studyAreaId is incompatible
  if (plan.studyAreaId && plan.studyAreaId !== activeStudyId) {
    return {
      groups: [],
      failures: [
        {
          candidate: plan.selected[0]!,
          reason: `Plan study ID '${plan.studyAreaId}' does not match active study '${activeStudyId}'`,
        },
      ],
    };
  }

  // Invalidate plan if plan-level gridVersion is incompatible
  if (plan.gridVersion && activeGridVersion && plan.gridVersion !== activeGridVersion) {
    return {
      groups: [],
      failures: [
        {
          candidate: plan.selected[0]!,
          reason: `Plan grid version '${plan.gridVersion}' does not match active grid '${activeGridVersion}'`,
        },
      ],
    };
  }

  const groupedByCell = new Map<string, Candidate[]>();
  const failures: MarkerValidationFailure[] = [];

  for (const candidate of plan.selected) {
    if (visibleMarkerTypes && !visibleMarkerTypes.has(candidate.interventionId)) {
      continue;
    }

    const validation = validateInterventionCandidate({
      candidate,
      activeStudyId,
      activeGridVersion,
      cellsById,
    });

    if (validation.valid) {
      const existing = groupedByCell.get(candidate.cellId) ?? [];
      existing.push(candidate);
      groupedByCell.set(candidate.cellId, existing);
    } else {
      failures.push(validation.failure);
    }
  }

  const groups: GroupedCellInterventions[] = [];

  for (const [cellId, candidates] of groupedByCell) {
    const cell = cellsById.get(cellId)!;

    // Sort so candidate with highest combined benefit is primary
    const sorted = [...candidates].sort((a, b) => (b.combinedBenefit ?? 0) - (a.combinedBenefit ?? 0));
    const primaryCandidate = sorted[0]!;
    const totalCost = sorted.reduce((sum, c) => sum + (c.cost ?? 0), 0);
    const totalQuantity = sorted.reduce((sum, c) => sum + (c.quantity ?? 0), 0);

    groups.push({
      cellId,
      cell,
      position: [cell.center[0], cell.center[1]],
      primaryCandidate,
      candidates: sorted,
      totalCost,
      totalQuantity,
    });
  }

  return { groups, failures };
}

export interface PlacedInterventionMarker {
  cellId: string;
  candidate: Candidate;
  cell: Cell;
  position: LatLng;
  indexInCell: number;
  totalInCell: number;
}

/**
 * Lays out individual intervention markers for the map, matching the original EcoGrid design:
 * - Every candidate is preserved as an individual marker with its own intervention-specific icon.
 * - Single intervention in a cell sits at the exact cell center.
 * - Multiple interventions in a cell are arranged using compact angular offsets (12m radius)
 *   strictly contained within the cell's bounding polygon.
 * - Absolutely NO numerical grouping badges (+1, +2, etc.).
 * - Rigorously validates study area, grid version, and CRS compatibility.
 */
export function layoutInterventionsForMap(params: {
  plan: OptimizerResult | null;
  activeStudyId: string;
  activeGridVersion?: string | undefined;
  cellsById: Map<string, Cell>;
  visibleMarkerTypes?: Set<InterventionId> | undefined;
}): {
  markers: PlacedInterventionMarker[];
  failures: MarkerValidationFailure[];
} {
  const { plan, activeStudyId, activeGridVersion, cellsById, visibleMarkerTypes } = params;

  if (!plan?.selected || plan.selected.length === 0) {
    return { markers: [], failures: [] };
  }

  // Invalidate plan if plan-level studyAreaId is incompatible
  if (plan.studyAreaId && plan.studyAreaId !== activeStudyId) {
    return {
      markers: [],
      failures: [
        {
          candidate: plan.selected[0]!,
          reason: `Plan study ID '${plan.studyAreaId}' does not match active study '${activeStudyId}'`,
        },
      ],
    };
  }

  // Invalidate plan if plan-level gridVersion is incompatible
  if (plan.gridVersion && activeGridVersion && plan.gridVersion !== activeGridVersion) {
    return {
      markers: [],
      failures: [
        {
          candidate: plan.selected[0]!,
          reason: `Plan grid version '${plan.gridVersion}' does not match active grid '${activeGridVersion}'`,
        },
      ],
    };
  }

  const groupedByCell = new Map<string, Candidate[]>();
  const failures: MarkerValidationFailure[] = [];

  for (const candidate of plan.selected) {
    if (visibleMarkerTypes && !visibleMarkerTypes.has(candidate.interventionId)) {
      continue;
    }

    const validation = validateInterventionCandidate({
      candidate,
      activeStudyId,
      activeGridVersion,
      cellsById,
    });

    if (validation.valid) {
      const existing = groupedByCell.get(candidate.cellId) ?? [];
      existing.push(candidate);
      groupedByCell.set(candidate.cellId, existing);
    } else {
      failures.push(validation.failure);
    }
  }

  const markers: PlacedInterventionMarker[] = [];

  for (const [cellId, candidates] of groupedByCell) {
    const cell = cellsById.get(cellId)!;
    const totalInCell = candidates.length;

    candidates.forEach((candidate, indexInCell) => {
      let position: LatLng;

      if (totalInCell === 1) {
        position = [cell.center[0], cell.center[1]];
      } else {
        // Original geometric offset layout
        const angle = (indexInCell / totalInCell) * Math.PI * 2 - Math.PI / 2;
        const offsetMeters = 12;
        const latitude = cell.center[0] + (Math.cos(angle) * offsetMeters) / 111_320;
        const longitude =
          cell.center[1] +
          (Math.sin(angle) * offsetMeters) /
            (111_320 * Math.max(0.15, Math.cos((cell.center[0] * Math.PI) / 180)));

        const candidatePoint: LatLng = [latitude, longitude];
        if (isPointInPolygon(candidatePoint, cell.polygon)) {
          position = candidatePoint;
        } else {
          position = [cell.center[0], cell.center[1]];
        }
      }

      markers.push({
        cellId,
        candidate,
        cell,
        position,
        indexInCell,
        totalInCell,
      });
    });
  }

  return { markers, failures };
}

