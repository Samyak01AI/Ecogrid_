import type { Candidate, Cell, ConnectivityResult, InterventionId, OptimizerInput, OptimizerResult, ScoreWeights, StudyArea, WhatIfResult } from '@ecogrid/domain';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match && match[3] !== undefined ? decodeURIComponent(match[3]) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  // Attach double-submit CSRF token for state-changing requests when cookie is present
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('ecogrid_csrf');
    if (csrfToken && !headers['X-CSRF-Token']) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message =
      typeof data === 'object' && data !== null && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string'
        ? (data as { detail: string }).detail
        : typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type UserSession = {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'planner' | 'viewer';
  isActive?: boolean;
  createdAt?: string;
};

export type AdminUserItem = {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'planner' | 'viewer';
  isActive: boolean;
  createdAt: string;
};

export type PlaceResult = { id: string; displayName: string; lat: number; lng: number; type: string };
export type Scenario = { id: string; name: string; studyId: string; description?: string; budget: number; weights: ScoreWeights; enabledInterventions: readonly InterventionId[]; plan: OptimizerResult; createdAt: string };

export function normalizeOptimizerResult(raw: unknown, fallbackStudyId?: string): OptimizerResult {
  if (!raw || typeof raw !== 'object') {
    return {
      studyAreaId: fallbackStudyId ?? 'study-delhi',
      gridVersion: '2.0',
      crs: 'EPSG:4326',
      selected: [],
      rejected: [],
      totalCost: 0,
      remainingBudget: 0,
      utilization: 0,
      combinedBenefit: 0,
      categoryBenefits: { heat: 0, vegetation: 0, pedestrian: 0, connectivity: 0 },
      cellsImproved: 0,
      validation: { valid: true, violations: [] },
      planConfidence: 0.9,
    };
  }

  const r = raw as Record<string, unknown>;

  const totalCost = Number.isFinite(r.totalCost)
    ? Number(r.totalCost)
    : Number.isFinite(r.total_cost)
    ? Number(r.total_cost)
    : 0;

  const remainingBudget = Number.isFinite(r.remainingBudget)
    ? Number(r.remainingBudget)
    : Number.isFinite(r.remaining_budget)
    ? Number(r.remaining_budget)
    : 0;

  const utilization = Number.isFinite(r.utilization)
    ? Number(r.utilization)
    : (totalCost + remainingBudget > 0)
    ? totalCost / (totalCost + remainingBudget)
    : 0;

  const combinedBenefit = Number.isFinite(r.combinedBenefit)
    ? Number(r.combinedBenefit)
    : Number.isFinite(r.combined_benefit)
    ? Number(r.combined_benefit)
    : 0;

  const studyAreaId =
    typeof r.studyAreaId === 'string'
      ? r.studyAreaId
      : typeof r.study_area_id === 'string'
      ? r.study_area_id
      : typeof r.studyId === 'string'
      ? r.studyId
      : typeof r.study_id === 'string'
      ? r.study_id
      : fallbackStudyId ?? 'study-delhi';

  const gridVersion =
    typeof r.gridVersion === 'string'
      ? r.gridVersion
      : typeof r.grid_version === 'string'
      ? r.grid_version
      : '2.0';

  const crs = typeof r.crs === 'string' ? r.crs : 'EPSG:4326';

  const rawCat = (r.categoryBenefits || r.category_benefits || {}) as Record<string, unknown>;
  const categoryBenefits = {
    heat: Number.isFinite(rawCat.heat) ? Number(rawCat.heat) : 0,
    vegetation: Number.isFinite(rawCat.vegetation)
      ? Number(rawCat.vegetation)
      : Number.isFinite(rawCat.greenery)
      ? Number(rawCat.greenery)
      : 0,
    pedestrian: Number.isFinite(rawCat.pedestrian) ? Number(rawCat.pedestrian) : 0,
    connectivity: Number.isFinite(rawCat.connectivity) ? Number(rawCat.connectivity) : 0,
  };

  const rawSelected = Array.isArray(r.selected) ? r.selected : [];
  const selected: Candidate[] = rawSelected.map((item: unknown) => {
    const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const cellId = String(c.cellId ?? c.cell_id ?? 'unknown');
    let intId = String(c.interventionId ?? c.intervention_id ?? 'native_trees') as InterventionId;
    if ((intId as string) === 'pollinator_corridor') {
      intId = 'pollinator_strip' as InterventionId;
    }
    const cost = Number.isFinite(c.cost) ? Number(c.cost) : 0;
    const cBen = Number.isFinite(c.combinedBenefit)
      ? Number(c.combinedBenefit)
      : Number.isFinite(c.combined_benefit)
      ? Number(c.combined_benefit)
      : 0;
    const bPerC = Number.isFinite(c.benefitPerCost)
      ? Number(c.benefitPerCost)
      : Number.isFinite(c.benefit_per_cost)
      ? Number(c.benefit_per_cost)
      : (cost > 0 ? cBen / cost : 0);

    const cCat = (c.categoryBenefit || c.category_benefits || {}) as Record<string, unknown>;

    let coords: [number, number] | undefined = undefined;
    if (Array.isArray(c.coordinates) && c.coordinates.length >= 2) {
      const lat = Number(c.coordinates[0]);
      const lng = Number(c.coordinates[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords = [lat, lng];
      }
    }

    const cand: Candidate = {
      cellId,
      areaName: String(c.areaName ?? c.area_name ?? cellId),
      interventionId: intId,
      interventionName: String(c.interventionName ?? c.intervention_name ?? 'Intervention'),
      quantity: Number.isFinite(c.quantity) ? Number(c.quantity) : 1,
      unit: String(c.unit ?? 'units'),
      cost,
      combinedBenefit: cBen,
      benefitPerCost: bPerC,
      categoryBenefit: {
        heat: Number.isFinite(cCat.heat) ? Number(cCat.heat) : 0,
        vegetation: Number.isFinite(cCat.vegetation)
          ? Number(cCat.vegetation)
          : Number.isFinite(cCat.greenery)
          ? Number(cCat.greenery)
          : 0,
        pedestrian: Number.isFinite(cCat.pedestrian) ? Number(cCat.pedestrian) : 0,
        connectivity: Number.isFinite(cCat.connectivity) ? Number(cCat.connectivity) : 0,
      },
      ...(typeof c.studyAreaId === 'string' ? { studyAreaId: c.studyAreaId } : studyAreaId ? { studyAreaId } : {}),
      ...(typeof c.gridVersion === 'string' ? { gridVersion: c.gridVersion } : gridVersion ? { gridVersion } : {}),
      ...(coords ? { coordinates: coords as [number, number] } : {}),
    };
    return cand;
  });

  const cellsImproved = Number.isFinite(r.cellsImproved)
    ? Number(r.cellsImproved)
    : Number.isFinite(r.cells_improved)
    ? Number(r.cells_improved)
    : new Set(selected.map((s) => s.cellId)).size;

  const rawRejected = Array.isArray(r.rejected) ? r.rejected : [];
  const rejected = rawRejected.map((item: unknown) => {
    const rej = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const candRaw = rej.candidate && typeof rej.candidate === 'object' ? rej.candidate : {};
    return {
      candidate: candRaw as Candidate,
      reason: String(rej.reason ?? 'Site feasibility or constraint boundary'),
    };
  });

  const valRaw = (r.validation && typeof r.validation === 'object' ? r.validation : {}) as Record<string, unknown>;
  const validation = {
    valid: Boolean(valRaw.valid ?? true),
    violations: Array.isArray(valRaw.violations) ? valRaw.violations.map(String) : [],
  };

  const planConfidence = Number.isFinite(r.planConfidence)
    ? Number(r.planConfidence)
    : Number.isFinite(r.plan_confidence)
    ? Number(r.plan_confidence)
    : 0.9;

  const optResult: OptimizerResult = {
    selected,
    rejected,
    totalCost,
    remainingBudget,
    utilization,
    combinedBenefit,
    categoryBenefits,
    cellsImproved,
    validation,
    planConfidence,
    ...(r.planMode === 'standard' || r.planMode === 'adaptive'
      ? { planMode: r.planMode }
      : r.plan_mode === 'standard' || r.plan_mode === 'adaptive'
      ? { planMode: r.plan_mode }
      : {}),
    ...(typeof r.strategyName === 'string'
      ? { strategyName: r.strategyName }
      : typeof r.strategy_name === 'string'
      ? { strategyName: r.strategy_name }
      : {}),
    ...(studyAreaId ? { studyAreaId } : {}),
    ...(gridVersion ? { gridVersion } : {}),
    ...(crs ? { crs } : {}),
  };
  return optResult;
}

export const api = {
  health: () => request<{ ok: boolean; service: string; provider: string }>('/api/health'),
  csrf: () => request<{ csrfToken: string }>('/api/auth/csrf'),
  studies: () => request<{ studies: (StudyArea & { cellCount: number })[] }>('/api/studies'),
  createStudy: (input: Omit<StudyArea, 'id'>) => request<{ study: StudyArea; cells: Cell[] }>('/api/studies', { method: 'POST', body: JSON.stringify(input) }),
  cells: (studyId: string) => request<{ study: StudyArea; count: number; polygons: number; cells: Cell[] }>(`/api/studies/${encodeURIComponent(studyId)}/cells`),
  searchPlaces: (query: string) => request<{ results: PlaceResult[] }>(`/api/geocode/search?q=${encodeURIComponent(query)}`),
  connectivity: (studyId: string) => request<ConnectivityResult>(`/api/connectivity?studyId=${encodeURIComponent(studyId)}`),
  optimize: async (input: OptimizerInput & { studyId?: string }): Promise<OptimizerResult> => {
    const res = await request<OptimizerResult>('/api/optimize', { method: 'POST', body: JSON.stringify(input) });
    return normalizeOptimizerResult(res, input.studyId);
  },
  whatIf: (input: { studyId?: string; cellId: string; interventionId: InterventionId; quantity: number }) => request<WhatIfResult>('/api/whatif', { method: 'POST', body: JSON.stringify(input) }),
  register: (
    param1: string | { fullName: string; email: string; password: string; confirmPassword?: string },
    param2?: string,
  ) => {
    if (typeof param1 === 'object') {
      return request<{ user: UserSession }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: param1.fullName,
          email: param1.email,
          password: param1.password,
          confirm_password: param1.confirmPassword || param1.password,
        }),
      });
    }
    return request<{ user: UserSession }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: param1.split('@')[0] || 'User',
        email: param1,
        password: param2 ?? '',
        confirm_password: param2 ?? '',
      }),
    });
  },
  login: (email: string, password: string) => request<{ user: UserSession }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  currentUser: () => request<UserSession>('/api/auth/me'),
  logout: () => request<{ ok: boolean; message?: string }>('/api/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) => request<{ ok: boolean; message: string; dev_reset_token?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (input: { token: string; newPassword: string; confirmPassword: string }) => request<{ ok: boolean; message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: input.token, new_password: input.newPassword, confirm_password: input.confirmPassword }) }),
  changePassword: (input: { currentPassword: string; newPassword: string; confirmPassword: string }) => request<{ ok: boolean; message: string }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: input.currentPassword, new_password: input.newPassword, confirm_password: input.confirmPassword }) }),
  adminUsers: () => request<{ users: AdminUserItem[] }>('/api/admin/users'),
  adminUpdateRole: (userId: string, role: 'admin' | 'planner' | 'viewer') => request<{ user: AdminUserItem }>(`/api/admin/users/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  adminUpdateStatus: (userId: string, isActive: boolean) => request<{ user: AdminUserItem }>(`/api/admin/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
  scenarios: (studyId: string) => request<{ scenarios: Scenario[] }>(`/api/scenarios?studyId=${encodeURIComponent(studyId)}`),
  confidence: (studyId: string) => request<{ mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/confidence`),
  recomputeConfidence: (studyId: string) => request<{ recomputed: number; mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/confidence/recompute`, { method: 'POST', body: '{}' }),
  modelHealth: (studyId: string) => request<{ configured: boolean; reachable: boolean; modelVersion?: string; lastRun?: { source: 'model' | 'fallback'; modelVersion?: string; reason?: string; at: string } }>(`/api/model/health?studyId=${encodeURIComponent(studyId)}`),
  refreshFromModel: (studyId: string) => request<{ source: 'model' | 'fallback'; modelVersion?: string; reason?: string; at: string; updated: number; missing: number; mean: number; p10: number; p90: number; lowCount: number }>(`/api/studies/${encodeURIComponent(studyId)}/model/refresh`, { method: 'POST', body: '{}' }),
  importScores: (input: { studyId: string; format: 'csv' | 'geojson'; content: string }) => request<{ imported: number; format: 'csv' | 'geojson'; cells: number; persistence: 'database' | 'process-memory' }>('/api/import', { method: 'POST', body: JSON.stringify(input) }),
  createScenario: (input: { studyId: string; name: string; description?: string; budget: number; weights: ScoreWeights; enabledInterventions: readonly InterventionId[] }) => request<Scenario>('/api/scenarios', { method: 'POST', body: JSON.stringify(input) }),
  compareScenarios: (input: { studyId: string; scenarioIds?: readonly string[]; budget?: number; weights?: ScoreWeights }) => request<{ scenarios: unknown[]; delta: { cost: number; benefit: number; cells: number } }>('/api/scenarios/compare', { method: 'POST', body: JSON.stringify(input) }),
  report: (studyId: string, format: 'json' | 'pdf' = 'json', budget?: number) =>
    fetch(`/api/studies/${encodeURIComponent(studyId)}/report?format=${format}${budget != null ? `&budget=${encodeURIComponent(budget)}` : ''}`, { credentials: 'include' }),
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

  // Stage 7: AI Planning Assistant & Multi-Key Grok Pool
  aiStatus: () => request<AIPoolStatus>('/api/ai/status'),
  aiAssistant: (input: { studyId?: string; cellId: string; question?: string; planId?: string; cell?: unknown; plan?: unknown }) =>
    request<AIAssistantResponse>('/api/ai/assistant', { method: 'POST', body: JSON.stringify(input) }),
  aiScenarioExplain: (input: { studyId?: string; baseline: unknown; proposal: unknown; delta?: unknown }) =>
    request<AIScenarioExplainResponse>('/api/ai/scenario-explain', { method: 'POST', body: JSON.stringify(input) }),
  aiImpactSummary: (input: { studyId?: string; budget?: number; plan: unknown }) =>
    request<AIImpactSummaryResponse>('/api/ai/impact-summary', { method: 'POST', body: JSON.stringify(input) }),
  aiValidatePlan: (input: { studyId?: string; budget?: number; plan: unknown }) =>
    request<AIValidatePlanResponse>('/api/ai/validate-plan', { method: 'POST', body: JSON.stringify(input) }),

  // Stage 8: Grok-Powered Terrain-Adaptive AI Decision Engine
  adaptiveProfiles: () =>
    request<AdaptiveProfilesResponse>('/api/adaptive/profiles'),
  adaptiveCharacterize: (studyId: string) =>
    request<TerrainProfile>('/api/adaptive/characterize', { method: 'POST', body: JSON.stringify({ study_id: studyId }) }),
  adaptiveStrategy: (input: { studyId: string; budget?: number; userPriorities?: Record<string, number>; focusObjective?: string; forceFallback?: boolean }) =>
    request<ValidatedStrategy>('/api/adaptive/strategy', {
      method: 'POST',
      body: JSON.stringify({
        study_id: input.studyId,
        budget: input.budget,
        user_priorities: input.userPriorities,
        focus_objective: input.focusObjective,
        force_fallback: input.forceFallback,
      }),
    }),
  adaptiveValidate: (input: { studyId: string; budget?: number; strategy: unknown }) =>
    request<ValidatedStrategy>('/api/adaptive/validate', {
      method: 'POST',
      body: JSON.stringify({ study_id: input.studyId, budget: input.budget, strategy: input.strategy }),
    }),
  adaptiveOptimize: async (input: {
    studyId: string;
    budget?: number;
    mode?: 'standard' | 'adaptive';
    customStrategy?: unknown;
    enabledInterventions?: readonly string[];
    gridVersion?: string;
    datasetVersion?: string;
    currency?: string;
    weights?: ScoreWeights;
  }): Promise<AdaptiveOptimizeResponse> => {
    const res = await request<AdaptiveOptimizeResponse>('/api/adaptive/optimize', {
      method: 'POST',
      body: JSON.stringify({
        study_id: input.studyId,
        studyId: input.studyId,
        budget: input.budget,
        mode: input.mode ?? 'adaptive',
        custom_strategy: input.customStrategy,
        customStrategy: input.customStrategy,
        enabled_interventions: input.enabledInterventions,
        enabledInterventions: input.enabledInterventions,
        grid_version: input.gridVersion ?? '2.0',
        gridVersion: input.gridVersion ?? '2.0',
        dataset_version: input.datasetVersion ?? 'CALIBRATED_PUBLIC_DATA',
        datasetVersion: input.datasetVersion ?? 'CALIBRATED_PUBLIC_DATA',
        currency: input.currency ?? 'INR',
        weights: input.weights,
      }),
    });
    const normalizedPlan = normalizeOptimizerResult(res.plan, input.studyId);
    const resolvedMode = res.mode ?? input.mode ?? 'adaptive';
    const strategyObj = res.strategy as Record<string, unknown> | undefined;
    const resolvedStrategyName =
      typeof strategyObj?.strategy_name === 'string'
        ? strategyObj.strategy_name
        : resolvedMode === 'standard'
        ? 'Standard Municipal Baseline'
        : 'AI-Adaptive Optimization';
    return {
      ...res,
      plan: {
        ...normalizedPlan,
        planMode: resolvedMode,
        strategyName: resolvedStrategyName,
      },
    };
  },
  adaptiveCompare: async (input: {
    studyId: string;
    budget?: number;
    enabledInterventions?: readonly string[];
  }): Promise<AdaptiveComparisonResult> => {
    const res = await request<AdaptiveComparisonResult>('/api/adaptive/compare', {
      method: 'POST',
      body: JSON.stringify({
        study_id: input.studyId,
        studyId: input.studyId,
        budget: input.budget,
        enabled_interventions: input.enabledInterventions,
        enabledInterventions: input.enabledInterventions,
      }),
    });
    const standardPlan = normalizeOptimizerResult(res.standard_plan, input.studyId);
    const adaptivePlan = normalizeOptimizerResult(res.adaptive_plan, input.studyId);
    return {
      ...res,
      standard_plan: {
        ...standardPlan,
        planMode: 'standard',
        strategyName: 'Standard Municipal Baseline',
      },
      adaptive_plan: {
        ...adaptivePlan,
        planMode: 'adaptive',
        strategyName: res.adaptive_strategy?.strategy_name ?? 'AI-Adaptive Strategy',
      },
    };
  },
};

export type AIPoolStatus = {
  total_keys: number;
  active_key_index: number | null;
  healthy_count: number;
  cooldown_count: number;
  total_failover_switches: number;
  default_model: string;
  base_url: string;
  keys: Array<{
    index: number;
    masked_key: string;
    status: 'HEALTHY' | 'COOLDOWN' | 'ERROR';
    cooldown_remaining_sec: number;
    request_count: number;
    failover_count: number;
    last_error: string | null;
  }>;
};

export type AIAssistantResponse = {
  answer: string;
  question: string;
  cellId: string;
  areaName: string;
  ai_metadata: {
    provider: string;
    model: string;
    key_index: number;
    total_keys: number;
    failover_count: number;
  };
};

export type AIScenarioExplainResponse = {
  explanation: string;
  deltas: {
    budget_delta: number;
    cost_delta: number;
    benefit_delta: number;
    cells_delta: number;
  };
  ai_metadata: {
    provider: string;
    model: string;
    key_index: number;
    total_keys: number;
    failover_count: number;
  };
};

export type KeyMetricItem = {
  label: string;
  value: string | number;
  unit?: string;
  subtext?: string;
};

export type TradeOffItem = {
  dimension: string;
  observation: string;
  implication: string;
};

export type RecommendationItem = {
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  title: string;
  description: string;
  timeline?: string;
};

export type StructuredBriefing = {
  executiveSummary: string;
  keyMetrics: KeyMetricItem[];
  tradeOffs: TradeOffItem[];
  recommendations: RecommendationItem[];
  limitations: string[];
};

export type AIImpactSummaryResponse = {
  summary_markdown: string;
  structured_briefing?: StructuredBriefing;
  study_name: string;
  metrics: {
    total_cost: number;
    budget: number;
    cells_improved: number;
    combined_benefit: number;
    efficiency_gain_pct: number;
  };
  ai_metadata: {
    provider: string;
    model: string;
    key_index: number;
    total_keys: number;
    failover_count: number;
  };
};

export type AIValidatePlanResponse = {
  validation_report: string;
  backend_enforced: boolean;
  is_valid: boolean;
  violations: Array<Record<string, unknown>>;
  ai_metadata: {
    provider: string;
    model: string;
    key_index: number;
    total_keys: number;
    failover_count: number;
  };
};

export type TerrainType =
  | 'industrial'
  | 'dense_urban'
  | 'residential'
  | 'commercial'
  | 'mixed_use'
  | 'green_belt'
  | 'unknown';

export type TerrainProfile = {
  study_area_id: string;
  study_area_name: string;
  terrain_type: TerrainType;
  confidence: number;
  classification_reason: string;
  natural_terrain: {
    mean_built_surface_ratio: number;
    mean_green_space_ratio: number;
    mean_available_area_m2: number;
    dominant_surface_type: string;
    surface_distribution: Record<string, number>;
    has_water_bodies: boolean;
    has_steep_or_restricted_zones: boolean;
  };
  land_use_context: {
    dominant_land_use: string;
    land_use_distribution: Record<string, number>;
    commercial_intensity: number;
    industrial_intensity: number;
    residential_intensity: number;
    civic_or_heritage_intensity: number;
  };
  environmental_indicators: {
    mean_heat_score: number;
    mean_vegetation_deficit: number;
    mean_pedestrian_exposure: number;
    mean_connectivity_gap: number;
    mean_tree_suitability: number;
    mean_feasibility_score: number;
    high_heat_cells_count: number;
    high_exposure_cells_count: number;
    statutory_restrictions_count: number;
  };
  detected_constraints: string[];
  dataset_provenance: string;
  grid_cells_evaluated: number;
};

export type ValidatedStrategy = {
  strategy_id: string;
  strategy_name: string;
  strategy_version: string;
  terrain_type: TerrainType;
  formula_id: string;
  priority_weights: {
    heat: number;
    vegetation: number;
    pedestrian: number;
    connectivity: number;
  };
  optimization_weights: {
    w_heat: number;
    w_biodiversity: number;
    w_connectivity: number;
    w_greenery: number;
    w_pedestrian: number;
  };
  model_id: string;
  model_version: string;
  preferred_interventions: string[];
  explanation: string;
  validation_status: 'VALIDATED' | 'FALLBACK_APPLIED' | 'REJECTED';
  fallback_applied: boolean;
  fallback_reason?: string | null;
  validation_errors: Array<{ field: string; code: string; message: string; invalid_value?: unknown }>;
  checked_rules: string[];
  parameter_hash: string;
  timestamp: string;
  provenance: string;
};

export type SharedEvaluationMetrics = {
  thermal_mitigation_index: number;
  canopy_deficit_closed: number;
  pedestrian_comfort_benefit: number;
  connectivity_improvement: number;
  cost_efficiency_ratio: number;
  total_interventions_count: number;
  cells_improved_count: number;
  budget_spent: number;
  budget_headroom: number;
};

export type AdaptiveOptimizeResponse = {
  mode: 'standard' | 'adaptive';
  study_id: string;
  terrain_profile: TerrainProfile;
  plan: OptimizerResult;
  strategy: ValidatedStrategy | Record<string, unknown>;
  shared_metrics: SharedEvaluationMetrics;
};

export type AdaptiveComparisonResult = {
  study_area_id: string;
  study_area_name: string;
  terrain_type: TerrainType;
  budget: number;
  standard_plan: OptimizerResult;
  adaptive_plan: OptimizerResult;
  standard_strategy: Record<string, unknown>;
  adaptive_strategy: ValidatedStrategy;
  standard_metrics: SharedEvaluationMetrics;
  adaptive_metrics: SharedEvaluationMetrics;
  delta: {
    thermal_mitigation_delta_pct: number;
    canopy_closed_delta_pct: number;
    pedestrian_comfort_delta_pct: number;
    cost_efficiency_delta_pct: number;
    cells_improved_diff: number;
    cost_diff_inr: number;
  };
  explanation: string;
  fairness_disclaimer: string;
};

export type AdaptiveProfilesResponse = {
  status: string;
  supported_terrains: TerrainType[];
  registered_formulas: Array<{ formula_id: string; name: string; description: string; version: string; required_parameters: string[] }>;
  registered_models: Array<{ model_id: string; model_name: string; model_version: string; supported_terrains: string[] }>;
  baseline_strategies: Record<string, unknown>;
};

