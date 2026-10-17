import { describe, expect, it } from 'vitest';
import { analyzeConnectivity, combinedPriority, createGrid, DEFAULT_STUDY, optimizePlan, riskBand, simulateWhatIf } from '../src/index.js';

describe('deterministic study grid', () => {
  it('creates exactly 100 stable A01–J10 cells from the default seed', () => {
    const first = createGrid();
    const second = createGrid();
    expect(first).toHaveLength(100);
    expect(first.map((cell) => cell.id)).toEqual(second.map((cell) => cell.id));
    expect(first[0]?.id).toBe('A01');
    expect(first.at(-1)?.id).toBe('J10');
    expect(first.map((cell) => cell.scores)).toEqual(second.map((cell) => cell.scores));
  });

  it('keeps every score in range and computes the stated weighted priority', () => {
    const cells = createGrid(DEFAULT_STUDY);
    expect(cells.every((cell) => Object.values(cell.scores).every((score) => score >= 0 && score <= 1))).toBe(true);
    expect(combinedPriority({ heat: 1, vegetation: 0, pedestrian: 0, connectivity: 0 })).toBeCloseTo(0.3);
    expect(riskBand(0.3)).toBe('LOW');
    expect(riskBand(0.31)).toBe('MODERATE');
    expect(riskBand(0.61)).toBe('HIGH');
    expect(riskBand(0.81)).toBe('CRITICAL');
  });
});

describe('intervention optimizer', () => {
  const input = { budget: 12_000, weights: { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 }, enabledInterventions: ['native_trees', 'shade_structure', 'pollinator_corridor', 'green_buffer', 'cool_surface'] as const };

  it('is repeatable, stays within budget/capacity, and returns a validated plan', () => {
    const cells = createGrid();
    const first = optimizePlan(cells, input);
    const second = optimizePlan(cells, input);
    expect(first).toEqual(second);
    expect(first.validation.valid).toBe(true);
    expect(first.totalCost).toBeLessThanOrEqual(input.budget);
    expect(first.cellsImproved).toBeGreaterThan(0);
    expect(first.utilization).toBeGreaterThan(0);
  });

  it('rejects incompatible cells with a human-readable reason', () => {
    const building = createGrid().find((cell) => cell.landUse === 'building');
    expect(building).toBeDefined();
    const plan = optimizePlan([building as NonNullable<typeof building>], { ...input, enabledInterventions: ['native_trees'] });
    expect(plan.selected).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toContain('land use');
  });

  it('reports invalid weight totals instead of silently normalizing them', () => {
    const plan = optimizePlan(createGrid(), { ...input, weights: { heat: 40, vegetation: 25, pedestrian: 25, connectivity: 20 } });
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.violations[0]).toContain('sum to 100');
  });
});

describe('what-if and connectivity analysis', () => {
  it('returns before and after scores for an allowed treatment', () => {
    const cell = createGrid().find((candidate) => candidate.landUse === 'green_space');
    expect(cell).toBeDefined();
    const result = simulateWhatIf(cell as NonNullable<typeof cell>, 'native_trees', 1);
    expect(result.after.heat).toBeLessThan(result.before.heat);
    expect(result.after.vegetation).toBeLessThan(result.before.vegetation);
  });

  it('returns graph components and proposed links for a seeded plan', () => {
    const cells = createGrid();
    const result = analyzeConnectivity(cells, ['F06', 'G06']);
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.links.some((link) => link.kind === 'new')).toBe(true);
    expect(result.afterScore).toBeGreaterThanOrEqual(result.beforeScore);
  });
});
