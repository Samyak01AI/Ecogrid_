export const SCORE_KEYS = ['heat', 'vegetation', 'pedestrian', 'connectivity'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type LayerKey = ScoreKey | 'feasibility' | 'priority' | 'recommended';
export type LandUse = 'pedestrian_zone' | 'plaza' | 'parking' | 'building' | 'residential' | 'green_space' | 'sports' | 'road' | 'mixed';
export type SurfaceType = 'soil' | 'paved' | 'mixed' | 'green' | 'building';
export type RiskBand = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type LatLng = readonly [latitude: number, longitude: number];

export interface ScoreSet {
  heat: number;
  vegetation: number;
  pedestrian: number;
  connectivity: number;
  feasibility: number;
}

export interface StudyArea {
  id: string;
  name: string;
  origin: LatLng;
  rows: number;
  columns: number;
  cellSizeLat: number;
  cellSizeLng: number;
  rotation: number;
}

export interface Cell {
  id: string;
  row: number;
  col: number;
  center: LatLng;
  polygon: readonly LatLng[];
  areaName: string;
  landUse: LandUse;
  surfaceType: SurfaceType;
  scores: ScoreSet;
  existingGreenCover: number;
  priorityZone: boolean;
  dataConfidence: number;
  capacity: number;
  treeSuitability?: number;
  availableArea?: number;
  builtSurfaceRatio?: number;
  undergroundClearance?: number;
  roadClearance?: number;
  observationDate?: string;
  dataLabel?: string;
  dataSource?: string;
  dataStatus?: string;
  provenanceFlags?: readonly string[];
}

export type InterventionId = 'native_trees' | 'shade_structure' | 'pollinator_corridor' | 'green_buffer' | 'cool_surface';

export interface Intervention {
  id: InterventionId;
  name: string;
  shortName: string;
  cost: number;
  unit: string;
  minQuantity: number;
  defaultQuantity: number;
  benefits: Readonly<Record<ScoreKey, number>>;
  allowedSurfaces: readonly SurfaceType[];
  allowedLandUses: readonly LandUse[];
  minimumFeasibility: number;
  markerColor: string;
  icon: string;
}

export interface ScoreWeights {
  heat: number;
  vegetation: number;
  pedestrian: number;
  connectivity: number;
}

export interface OptimizerConstraints {
  minFeasibility?: number;
  maxPerCell?: number;
  includeCellIds?: readonly string[];
  excludeCellIds?: readonly string[];
}

export interface OptimizerInput {
  budget: number;
  weights: ScoreWeights;
  enabledInterventions: readonly InterventionId[];
  constraints?: OptimizerConstraints;
}

export interface Candidate {
  cellId: string;
  areaName: string;
  interventionId: InterventionId;
  interventionName: string;
  quantity: number;
  unit: string;
  cost: number;
  categoryBenefit: Readonly<Record<ScoreKey, number>>;
  combinedBenefit: number;
  benefitPerCost: number;
}

export interface RejectedCandidate {
  candidate: Candidate;
  reason: string;
}

export interface OptimizerResult {
  selected: readonly Candidate[];
  rejected: readonly RejectedCandidate[];
  totalCost: number;
  remainingBudget: number;
  utilization: number;
  combinedBenefit: number;
  categoryBenefits: Readonly<Record<ScoreKey, number>>;
  cellsImproved: number;
  validation: { valid: boolean; violations: readonly string[] };
  /** Benefit-weighted mean data confidence (0-1) of the selected cells. */
  planConfidence?: number;
}

export interface WhatIfResult {
  cellId: string;
  interventionId: InterventionId;
  quantity: number;
  before: ScoreSet;
  after: ScoreSet;
  delta: ScoreSet;
}

export interface GreenComponent {
  id: string;
  color: string;
  cellIds: readonly string[];
  isolated: boolean;
}

export interface GreenLink {
  from: string;
  to: string;
  kind: 'existing' | 'new';
}

export interface ConnectivityResult {
  components: readonly GreenComponent[];
  isolatedPatches: readonly string[];
  links: readonly GreenLink[];
  beforeComponents: number;
  afterComponents: number;
  beforeScore: number;
  afterScore: number;
  newConnections: number;
}
