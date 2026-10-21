import type { Cell, ConnectivityResult, InterventionId, OptimizerInput, OptimizerResult, ScoreWeights, StudyArea, WhatIfResult } from '@ecogrid/domain';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type UserSession = { id: string; email: string; role: 'admin' | 'planner' | 'viewer' };
export type PlaceResult = { id: string; displayName: string; lat: number; lng: number; type: string };
export type Scenario = { id: string; name: string; studyId: string; description?: string; budget: number; weights: ScoreWeights; enabledInterventions: readonly InterventionId[]; plan: OptimizerResult; createdAt: string };

export const api = {
  health: () => request<{ ok: boolean; service: string; provider: string }>('/api/health'),
  studies: () => request<{ studies: (StudyArea & { cellCount: number })[] }>('/api/studies'),
  createStudy: (input: Omit<StudyArea, 'id'>) => request<{ study: StudyArea; cells: Cell[] }>('/api/studies', { method: 'POST', body: JSON.stringify(input) }),
  cells: (studyId: string) => request<{ study: StudyArea; count: number; polygons: number; cells: Cell[] }>(`/api/studies/${encodeURIComponent(studyId)}/cells`),
  searchPlaces: (query: string) => request<{ results: PlaceResult[] }>(`/api/geocode/search?q=${encodeURIComponent(query)}`),
  connectivity: (studyId: string) => request<ConnectivityResult>(`/api/connectivity?studyId=${encodeURIComponent(studyId)}`),
  optimize: (input: OptimizerInput & { studyId?: string }) => request<OptimizerResult>('/api/optimize', { method: 'POST', body: JSON.stringify(input) }),
  whatIf: (input: { studyId?: string; cellId: string; interventionId: InterventionId; quantity: number }) => request<WhatIfResult>('/api/whatif', { method: 'POST', body: JSON.stringify(input) }),
  register: (email: string, password: string) => request<{ user: UserSession }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => request<{ user: UserSession }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  currentUser: () => request<UserSession>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  scenarios: (studyId: string) => request<{ scenarios: Scenario[] }>(`/api/scenarios?studyId=${encodeURIComponent(studyId)}`),
  confidence: (studyId: string) => request<{ mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/confidence`),
  recomputeConfidence: (studyId: string) => request<{ recomputed: number; mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/confidence/recompute`, { method: 'POST', body: '{}' }),
  modelHealth: (studyId: string) => request<{ configured: boolean; reachable: boolean; modelVersion?: string; lastRun?: { source: 'model' | 'fallback'; modelVersion?: string; reason?: string; at: string } }>(`/api/model/health?studyId=${encodeURIComponent(studyId)}`),
  refreshFromModel: (studyId: string) => request<{ source: 'model' | 'fallback'; modelVersion?: string; reason?: string; at: string; updated: number; missing: number; mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/model/refresh`, { method: 'POST', body: '{}' }),
  importScores: (input: { studyId: string; format: 'csv' | 'geojson'; content: string }) => request<{ imported: number; format: 'csv' | 'geojson'; cells: number; persistence: 'database' | 'process-memory' }>('/api/import', { method: 'POST', body: JSON.stringify(input) }),
  createScenario: (input: { studyId: string; name: string; description?: string; budget: number; weights: ScoreWeights; enabledInterventions: readonly InterventionId[] }) => request<Scenario>('/api/scenarios', { method: 'POST', body: JSON.stringify(input) }),
  compareScenarios: (input: { studyId: string; scenarioIds?: readonly string[]; budget?: number; weights?: ScoreWeights }) => request<{ scenarios: unknown[]; delta: { cost: number; benefit: number; cells: number } }>('/api/scenarios/compare', { method: 'POST', body: JSON.stringify(input) }),
  report: (studyId: string, format: 'json' | 'pdf' = 'json') => fetch(`/api/studies/${encodeURIComponent(studyId)}/report?format=${format}`, { credentials: 'include' }),
  exportUrl: (studyId: string, format: 'csv' | 'geojson') => `/api/export?studyId=${encodeURIComponent(studyId)}&format=${format}`,

  // Stage 1-6 Architectural Evolution Endpoints
  pareto: (input: { studyId?: string; budget?: number; weights?: ScoreWeights }) =>
    request<{ status: string; pareto_size: number; pareto_front: Array<{ solution_id: string; name: string; profile: string; total_cost: number; combined_benefit: number; cells_improved: number; objectives: Record<string, number> }>; knee_point?: Record<string, unknown> }>('/api/pareto', { method: 'POST', body: JSON.stringify(input) }),
  mlBenchmark: () =>
    request<{ status: string; active_model: string; benchmark: { baseline_accuracy: number; random_forest_f1: number; xgboost_f1: number; selected_model: string; models: Record<string, unknown> } }>('/api/ml/benchmark'),
  runs: () =>
    request<{ runs: Array<Record<string, unknown>>; audit_entries: Array<Record<string, unknown>> }>('/api/runs'),
  approval: (runId: string) =>
    request<{ runId: string; approvalStatus: 'DRAFT' | 'APPROVED' | 'REJECTED'; approvedBy: string; notes: string; approvedAt?: string }>(`/api/approval/${encodeURIComponent(runId)}`),
  updateApproval: (input: { runId: string; status: 'DRAFT' | 'APPROVED' | 'REJECTED'; approvedBy?: string; notes?: string }) =>
    request<{ ok: boolean; runId: string; approvalStatus: string; approvedBy: string; notes: string }>('/api/approval', { method: 'POST', body: JSON.stringify(input) }),
  monitoring: (studyId: string) =>
    request<{ studyId: string; count: number; observations: Array<{ id: string; cellId: string; areaName: string; intervention: string; baselineTempC: number; predictedTempDropC: number; observedTempC: number; actualTempDropC: number; satelliteSource: string; observationDate: string; verdict: string }> }>(`/api/monitoring/${encodeURIComponent(studyId)}`),
  recordMonitoring: (input: { studyId?: string; cellId: string; areaName: string; intervention: string; baselineTempC: number; observedTempC: number; satelliteSource?: string }) =>
    request<Record<string, unknown>>('/api/monitoring', { method: 'POST', body: JSON.stringify(input) }),
  gisIngest: (studyId?: string) =>
    request<{ status: string; study_area: string; crs_projected: string; cells_resampled: number; layers_sampled: string[]; provenance: string }>('/api/gis/ingest', { method: 'POST', body: JSON.stringify({ studyId }) }),

  // Computer Vision Satellite Surface Segmentation
  cvStatus: () => request<{
    status: string;
    service: string;
    resolution: string;
    classes: Array<{ id: number; name: string; hex: string; label: string }>;
    spectralIndices: string[];
    sensorImagery: string;
  }>('/api/cv/status'),
  cvSegmentCell: (input: { studyId: string; cellId: string; lat?: number; lng?: number; zoom?: number }) =>
    request<{
      status: string;
      cellId: string;
      studyId: string;
      coordinates: { lat: number; lng: number };
      zoom: number;
      resolutionMetersPerPx: number;
      totalAreaSqm: number;
      surfaceBreakdown: {
        impervious_pavement: number;
        tree_canopy: number;
        grass_permeable: number;
        building_rooftop: number;
        water_body: number;
      };
      classColors: Record<string, string>;
      permeableAreaSqm: number;
      imperviousAreaSqm: number;
      rooftopAreaSqm: number;
      plantingCapacityTrees: number;
      visionConfidence: number;
      recommendations: Array<{ type: string; title: string; reason: string }>;
      images: {
        satellite: string;
        segmentationMask: string;
        blended: string;
      };
    }>('/api/cv/segment-cell', { method: 'POST', body: JSON.stringify(input) }),
};

