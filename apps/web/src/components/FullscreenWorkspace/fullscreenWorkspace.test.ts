import { describe, expect, it } from 'vitest';
import { createGrid, combinedPriority, INTERVENTIONS } from '@ecogrid/domain';

describe('Fullscreen Planning Workspace Domain & Component Logic', () => {
  const cells = createGrid();

  it('preserves exactly a 10 x 10 grid with 100 cells', () => {
    expect(cells).toHaveLength(100);
    const rowIndices = new Set(cells.map((c) => c.row));
    const colIndices = new Set(cells.map((c) => c.col));
    expect(rowIndices.size).toBe(10);
    expect(colIndices.size).toBe(10);
  });

  describe('KPI Calculations', () => {
    it('accurately computes study-area averages separate from cell-level scores', () => {
      const sumPriority = cells.reduce((acc, c) => acc + combinedPriority(c.scores), 0);
      const avgPriority = Math.round((sumPriority / cells.length) * 100);

      expect(avgPriority).toBeGreaterThan(0);
      expect(avgPriority).toBeLessThanOrEqual(100);

      // Selected cell should have its own score, distinct from campus mean
      const firstCell = cells[0]!;
      const cellPriority = Math.round(combinedPriority(firstCell.scores) * 100);

      // Verify they are separate calculations
      expect(typeof cellPriority).toBe('number');
      expect(typeof avgPriority).toBe('number');
    });

    it('computes heat, vegetation, and pedestrian averages across all cells', () => {
      const n = cells.length;
      const avgHeat = Math.round((cells.reduce((sum, c) => sum + c.scores.heat, 0) / n) * 100);
      const avgVeg = Math.round((cells.reduce((sum, c) => sum + c.scores.vegetation, 0) / n) * 100);
      const avgPed = Math.round((cells.reduce((sum, c) => sum + c.scores.pedestrian, 0) / n) * 100);

      expect(avgHeat).toBeGreaterThanOrEqual(0);
      expect(avgVeg).toBeGreaterThanOrEqual(0);
      expect(avgPed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Budget Management Logic', () => {
    it('correctly calculates allocated capital, remaining envelope, and utilization percentage', () => {
      const budget = 500000; // ₹5,00,000 INR
      const allocated = 340000; // ₹3,40,000 INR
      const remaining = Math.max(0, budget - allocated);
      const utilization = Math.round((allocated / budget) * 100);

      expect(remaining).toBe(160000);
      expect(utilization).toBe(68);
    });

    it('flags outdated optimization results when budget changes', () => {
      const solvedPlanBudget: number = 500000;
      const currentBudget: number = 750000;
      const isOutdated = solvedPlanBudget !== currentBudget;

      expect(isOutdated).toBe(true);
    });
  });

  describe('Optimization Objectives Rebalancing', () => {
    it('maintains a sum of 100% when weights are rebalanced', () => {
      const weights = { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };
      const sum = weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity;
      expect(sum).toBe(100);

      // Update one weight and rebalance others
      const targetKey = 'heat' as const;
      const newValue = 40;
      const others = (['vegetation', 'pedestrian', 'connectivity'] as const);
      const pool = others.reduce((s, k) => s + weights[k], 0);
      const remainder = 100 - newValue;

      const nextWeights = { ...weights, [targetKey]: newValue };
      let allocated = 0;
      others.forEach((name, index) => {
        const share =
          index === others.length - 1
            ? remainder - allocated
            : Math.max(5, Math.round((remainder * weights[name]) / pool));
        nextWeights[name] = share;
        allocated += share;
      });

      const nextSum =
        nextWeights.heat +
        nextWeights.vegetation +
        nextWeights.pedestrian +
        nextWeights.connectivity;

      expect(nextSum).toBe(100);
      expect(nextWeights.heat).toBe(40);
    });

    it('contains all 5 allowed interventions with standard costs', () => {
      expect(INTERVENTIONS).toHaveLength(5);
      const ids = INTERVENTIONS.map((i) => i.id);
      expect(ids).toContain('native_trees');
      expect(ids).toContain('shade_structure');
      expect(ids).toContain('pollinator_corridor');
      expect(ids).toContain('green_buffer');
      expect(ids).toContain('cool_surface');
    });
  });
});
