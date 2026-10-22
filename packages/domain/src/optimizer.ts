import { combinedPriority } from './grid.js';
import type { Candidate, Cell, Intervention, InterventionId, OptimizerInput, OptimizerResult, RejectedCandidate, ScoreKey, WhatIfResult } from './types.js';

export const INTERVENTIONS: readonly Intervention[] = [
  {
    id: 'native_trees', name: 'Native tree planting', shortName: 'Native trees', cost: 420, unit: 'tree', minQuantity: 1, defaultQuantity: 2,
    benefits: { heat: 0.28, vegetation: 0.34, pedestrian: 0.16, connectivity: 0.14 },
    allowedSurfaces: ['soil', 'mixed', 'green'], allowedLandUses: ['pedestrian_zone', 'plaza', 'residential', 'green_space', 'sports', 'mixed'], minimumFeasibility: 0.32, markerColor: '#4CC38A', icon: 'tree',
  },
  {
    id: 'shade_structure', name: 'Modular shade structure', shortName: 'Shade structure', cost: 1650, unit: 'structure', minQuantity: 1, defaultQuantity: 1,
    benefits: { heat: 0.36, vegetation: 0.04, pedestrian: 0.30, connectivity: 0.06 },
    allowedSurfaces: ['paved', 'mixed'], allowedLandUses: ['pedestrian_zone', 'plaza', 'parking', 'residential', 'sports', 'road', 'mixed'], minimumFeasibility: 0.42, markerColor: '#B7F7D0', icon: 'umbrella',
  },
  {
    id: 'pollinator_corridor', name: 'Pollinator corridor planting', shortName: 'Pollinator link', cost: 760, unit: 'link segment', minQuantity: 1, defaultQuantity: 1,
    benefits: { heat: 0.13, vegetation: 0.31, pedestrian: 0.08, connectivity: 0.39 },
    allowedSurfaces: ['soil', 'mixed', 'green'], allowedLandUses: ['pedestrian_zone', 'plaza', 'residential', 'green_space', 'sports', 'mixed'], minimumFeasibility: 0.48, markerColor: '#90E0B0', icon: 'flower',
  },
  {
    id: 'green_buffer', name: 'Street-edge green buffer', shortName: 'Green buffer', cost: 980, unit: 'buffer segment', minQuantity: 1, defaultQuantity: 1,
    benefits: { heat: 0.23, vegetation: 0.25, pedestrian: 0.19, connectivity: 0.19 },
    allowedSurfaces: ['soil', 'mixed'], allowedLandUses: ['road', 'parking', 'pedestrian_zone', 'residential', 'mixed'], minimumFeasibility: 0.50, markerColor: '#2C9B78', icon: 'sprout',
  },
  {
    id: 'cool_surface', name: 'Cool / reflective surface', shortName: 'Cool surface', cost: 510, unit: '100 m²', minQuantity: 1, defaultQuantity: 1,
    benefits: { heat: 0.33, vegetation: 0.02, pedestrian: 0.17, connectivity: 0.01 },
    allowedSurfaces: ['paved', 'mixed'], allowedLandUses: ['plaza', 'parking', 'building', 'pedestrian_zone', 'road', 'mixed'], minimumFeasibility: 0.58, markerColor: '#F3B44E', icon: 'sun',
  },
];

const CATEGORY_KEYS: readonly ScoreKey[] = ['heat', 'vegetation', 'pedestrian', 'connectivity'];
const emptyBenefits = (): Record<ScoreKey, number> => ({ heat: 0, vegetation: 0, pedestrian: 0, connectivity: 0 });
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function candidateFor(cell: Cell, intervention: Intervention, weights: OptimizerInput['weights']): Candidate {
  const quantity = intervention.defaultQuantity;
  const categoryBenefit = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, intervention.benefits[key] * quantity * cell.scores.feasibility])) as Record<ScoreKey, number>;
  const combinedBenefit = CATEGORY_KEYS.reduce((sum, key) => sum + categoryBenefit[key] * (weights[key] / 100) * cell.scores[key], 0);
  const cost = intervention.cost * quantity;
  return {
    cellId: cell.id,
    areaName: cell.areaName,
    interventionId: intervention.id,
    interventionName: intervention.name,
    quantity,
    unit: intervention.unit,
    cost,
    categoryBenefit,
    combinedBenefit,
    benefitPerCost: cost > 0 ? combinedBenefit / cost : 0,
  };
}

function infeasibilityReason(cell: Cell, intervention: Intervention, minimum: number): string | undefined {
  const flags = cell.provenanceFlags ?? [];
  if (flags.includes('WATER_BODY_VETO') || cell.areaName.includes('Water') || cell.areaName.includes('River') || cell.areaName.includes('Canal')) {
    return 'Water body buffer veto: terrestrial construction strictly prohibited';
  }
  if (flags.includes('OVERHEAD_HT_RESTRICTION') || cell.areaName.includes('High-Tension') || cell.areaName.includes('HT-Line')) {
    if (intervention.id === 'native_trees' || intervention.id === 'shade_structure') {
      return 'Overhead 220kV HT transmission corridor violation: trees and tall structures prohibited';
    }
  }
  if (flags.includes('HERITAGE_RESTRICTION') || cell.areaName.includes('Heritage')) {
    if (intervention.id === 'shade_structure' || intervention.id === 'cool_surface') {
      return 'Central Vista heritage sightline preservation: high-profile shade and reflective surfaces restricted';
    }
  }
  if (flags.includes('AVIATION_OLS_RESTRICTION') || cell.areaName.includes('Runway')) {
    if (intervention.id === 'native_trees' || intervention.id === 'shade_structure') {
      return 'Aviation obstacle limitation surface (OLS): vertical structures prohibited';
    }
  }
  if (cell.undergroundClearance != null && cell.undergroundClearance < 3.0 && intervention.id === 'native_trees') {
    return `Underground utility clearance (${cell.undergroundClearance.toFixed(1)} m) below mandatory 3.0 m safety buffer`;
  }
  if (cell.roadClearance != null && cell.roadClearance < 2.5 && intervention.id === 'native_trees') {
    return `Roadway sightline setback (${cell.roadClearance.toFixed(1)} m) below mandatory 2.5 m vehicular safety buffer`;
  }
  if (!intervention.allowedLandUses.includes(cell.landUse)) return `Not allowed for ${cell.landUse.replaceAll('_', ' ')} land use`;
  if (!intervention.allowedSurfaces.includes(cell.surfaceType)) return `Requires ${intervention.allowedSurfaces.join(' or ')} surface`;
  if (cell.scores.feasibility < Math.max(intervention.minimumFeasibility, minimum)) return `Feasibility ${Math.round(cell.scores.feasibility * 100)}% is below the required threshold`;
  if (cell.capacity < intervention.minQuantity || cell.capacity === 0) return 'Cell has no available intervention capacity';
  return undefined;
}

export function optimizePlan(cells: readonly Cell[], input: OptimizerInput): OptimizerResult {
  const violations: string[] = [];
  const weightTotal = CATEGORY_KEYS.reduce((sum, key) => sum + input.weights[key], 0);
  if (Math.abs(weightTotal - 100) > 0.001) violations.push('Weights must sum to 100%.');
  if (!Number.isFinite(input.budget) || input.budget < 0) violations.push('Budget must be a non-negative finite number.');
  for (const key of CATEGORY_KEYS) {
    if (!Number.isFinite(input.weights[key]) || input.weights[key] < 0) violations.push(`${key} weight must be a non-negative finite number.`);
  }

  const interventionById = new Map<InterventionId, Intervention>(INTERVENTIONS.map((item) => [item.id, item]));
  const enabled = input.enabledInterventions.map((id) => interventionById.get(id)).filter((item): item is Intervention => item !== undefined);
  const constraints = input.constraints ?? {};
  const include = constraints.includeCellIds ? new Set(constraints.includeCellIds) : undefined;
  const exclude = new Set(constraints.excludeCellIds ?? []);
  const rejected: RejectedCandidate[] = [];
  const feasible: Candidate[] = [];

  for (const cell of cells) {
    if ((include && !include.has(cell.id)) || exclude.has(cell.id)) continue;
    for (const intervention of enabled) {
      const candidate = candidateFor(cell, intervention, input.weights);
      const reason = infeasibilityReason(cell, intervention, constraints.minFeasibility ?? 0);
      if (reason) rejected.push({ candidate, reason });
      else feasible.push(candidate);
    }
  }

  feasible.sort((left, right) => right.benefitPerCost - left.benefitPerCost || left.cellId.localeCompare(right.cellId) || left.interventionId.localeCompare(right.interventionId));
  const selected: Candidate[] = [];
  const cellUsage = new Map<string, number>();
  const selectedKinds = new Set<string>();
  let totalCost = 0;
  const maxPerCell = constraints.maxPerCell ?? Number.POSITIVE_INFINITY;

  for (const candidate of feasible) {
    const cell = cells.find((item) => item.id === candidate.cellId);
    if (!cell) continue;
    const cellKey = `${candidate.cellId}:${candidate.interventionId}`;
    if (selectedKinds.has(cellKey)) continue;
    const used = cellUsage.get(candidate.cellId) ?? 0;
    const capacity = Math.min(cell.capacity, maxPerCell);
    if (used + candidate.quantity > capacity) {
      rejected.push({ candidate, reason: 'Would exceed this cell’s remaining intervention capacity' });
      continue;
    }
    if (totalCost + candidate.cost > input.budget) {
      rejected.push({ candidate, reason: 'Insufficient remaining budget for this candidate' });
      continue;
    }
    selected.push(candidate);
    selectedKinds.add(cellKey);
    cellUsage.set(candidate.cellId, used + candidate.quantity);
    totalCost += candidate.cost;
  }

  const categoryBenefits = emptyBenefits();
  let combinedBenefit = 0;
  for (const candidate of selected) {
    combinedBenefit += candidate.combinedBenefit;
    for (const key of CATEGORY_KEYS) categoryBenefits[key] += candidate.categoryBenefit[key] * (input.weights[key] / 100);
  }
  const remainingBudget = Math.max(0, input.budget - totalCost);
  const planViolations = [...violations];
  if (totalCost > input.budget) planViolations.push('Selected interventions exceed the budget.');
  if (selected.some((candidate) => candidate.quantity < (interventionById.get(candidate.interventionId)?.minQuantity ?? 1))) planViolations.push('A selected intervention is below its minimum quantity.');

  return {
    selected,
    rejected,
    totalCost,
    remainingBudget,
    utilization: input.budget > 0 ? totalCost / input.budget : 0,
    combinedBenefit,
    categoryBenefits,
    cellsImproved: new Set(selected.map((candidate) => candidate.cellId)).size,
    validation: { valid: planViolations.length === 0, violations: planViolations },
  };
}

export function simulateWhatIf(cell: Cell, interventionId: InterventionId, quantity: number): WhatIfResult {
  const intervention = INTERVENTIONS.find((item) => item.id === interventionId);
  if (!intervention) throw new Error(`Unknown intervention: ${interventionId}`);
  if (!Number.isInteger(quantity) || quantity < intervention.minQuantity) throw new Error(`Quantity must be an integer of at least ${intervention.minQuantity}.`);
  const scale = Math.min(1, quantity * 0.13 * cell.scores.feasibility);
  const before = { ...cell.scores };
  const after = {
    heat: clamp(before.heat - intervention.benefits.heat * scale),
    vegetation: clamp(before.vegetation - intervention.benefits.vegetation * scale),
    pedestrian: clamp(before.pedestrian - intervention.benefits.pedestrian * scale),
    connectivity: clamp(before.connectivity - intervention.benefits.connectivity * scale),
    feasibility: before.feasibility,
  };
  return {
    cellId: cell.id,
    interventionId,
    quantity,
    before,
    after,
    delta: {
      heat: after.heat - before.heat,
      vegetation: after.vegetation - before.vegetation,
      pedestrian: after.pedestrian - before.pedestrian,
      connectivity: after.connectivity - before.connectivity,
      feasibility: 0,
    },
  };
}

export function summarizePriorityChange(before: Cell, after: Cell): number {
  return combinedPriority(after.scores) - combinedPriority(before.scores);
}
