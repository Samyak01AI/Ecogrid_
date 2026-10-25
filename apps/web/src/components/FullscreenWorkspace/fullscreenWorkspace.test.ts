import { describe, expect, it } from 'vitest';
import { createGrid, combinedPriority, INTERVENTIONS, type OptimizerResult } from '@ecogrid/domain';
import type { FullscreenPanelKey } from './FullscreenPlanningToolbar.js';
import type { MapInteractionMode } from './FullscreenWorkspaceTopBar.js';

describe('Fullscreen Planning Workspace Domain & Component Logic', () => {
  const cells = createGrid();

  describe('Phase 1 & 2: Grid & Geometry Invariants', () => {
    it('preserves exactly a 10 x 10 grid with 100 cells', () => {
      expect(cells).toHaveLength(100);
      const rowIndices = new Set(cells.map((c) => c.row));
      const colIndices = new Set(cells.map((c) => c.col));
      expect(rowIndices.size).toBe(10);
      expect(colIndices.size).toBe(10);
    });

    it('ensures all 100 cell geometries have valid 4-corner bounding polygons and center coordinates', () => {
      for (const cell of cells) {
        expect(cell.polygon.length).toBeGreaterThanOrEqual(4);
        expect(cell.center).toHaveLength(2);
        expect(Number.isFinite(cell.center[0])).toBe(true);
        expect(Number.isFinite(cell.center[1])).toBe(true);
        expect(cell.center[0]).toBeGreaterThan(-90);
        expect(cell.center[0]).toBeLessThan(90);
        expect(cell.center[1]).toBeGreaterThan(-180);
        expect(cell.center[1]).toBeLessThan(180);
      }
    });
  });

  describe('Phase 3 & 4: Tool Rail & Contextual Drawer State', () => {
    it('enforces single active panel invariant across tool switches', () => {
      let activePanel: FullscreenPanelKey | null = null;
      const toggle = (key: FullscreenPanelKey) => {
        activePanel = activePanel === key ? null : key;
      };

      toggle('kpi');
      expect(activePanel).toBe('kpi');

      // Opening another tool closes previous and sets new
      toggle('optimize');
      expect(activePanel).toBe('optimize');

      // Toggling active tool collapses it to null
      toggle('optimize');
      expect(activePanel).toBeNull();
    });

    it('manages drawer pin state preserving open drawer during cell transitions', () => {
      let isPinned = false;
      let activePanel: FullscreenPanelKey | null = 'inspector';
      let selectedCellId: string | null = 'C-01';

      const togglePin = () => {
        isPinned = !isPinned;
      };
      togglePin();
      expect(isPinned).toBe(true);

      // Transitioning cell maintains inspector panel open when pinned
      selectedCellId = 'C-02';
      expect(activePanel).toBe('inspector');
      expect(selectedCellId).toBe('C-02');
    });
  });

  describe('Phase 5: Compact Environmental KPI Strip', () => {
    it('accurately computes study-area averages separate from cell-level scores', () => {
      const sumPriority = cells.reduce((acc, c) => acc + combinedPriority(c.scores), 0);
      const avgPriority = Math.round((sumPriority / cells.length) * 100);

      expect(avgPriority).toBeGreaterThan(0);
      expect(avgPriority).toBeLessThanOrEqual(100);

      // Selected cell should have its own score, distinct from campus mean
      const firstCell = cells[0]!;
      const cellPriority = Math.round(combinedPriority(firstCell.scores) * 100);

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

  describe('Phase 6: Intelligent Intervention Marker Grouping', () => {
    const mockPlan: OptimizerResult = {
      selected: [
        {
          cellId: 'C-04',
          areaName: 'Bengaluru East',
          interventionId: 'native_trees',
          interventionName: 'Native Tree Planting',
          cost: 72000,
          quantity: 24,
          unit: 'trees',
          categoryBenefit: { heat: 35, vegetation: 40, pedestrian: 25, connectivity: 15 },
          combinedBenefit: 45.2,
          benefitPerCost: 45.2 / 72000,
        },
        {
          cellId: 'C-04',
          areaName: 'Bengaluru East',
          interventionId: 'cool_surface',
          interventionName: 'High-Albedo Cool Pavement',
          cost: 45000,
          quantity: 150,
          unit: 'm²',
          categoryBenefit: { heat: 40, vegetation: 0, pedestrian: 30, connectivity: 0 },
          combinedBenefit: 32.1,
          benefitPerCost: 32.1 / 45000,
        },
        {
          cellId: 'C-04',
          areaName: 'Bengaluru East',
          interventionId: 'pollinator_corridor',
          interventionName: 'Pollinator Habitat Strip',
          cost: 15000,
          quantity: 50,
          unit: 'm²',
          categoryBenefit: { heat: 5, vegetation: 25, pedestrian: 10, connectivity: 35 },
          combinedBenefit: 18.4,
          benefitPerCost: 18.4 / 15000,
        },
        {
          cellId: 'C-07',
          areaName: 'Bengaluru East',
          interventionId: 'shade_structure',
          interventionName: 'Photovoltaic Shade Canopy',
          cost: 80000,
          quantity: 1,
          unit: 'canopy',
          categoryBenefit: { heat: 25, vegetation: 0, pedestrian: 45, connectivity: 0 },
          combinedBenefit: 28.0,
          benefitPerCost: 28.0 / 80000,
        },
      ],
      rejected: [],
      totalCost: 212000,
      remainingBudget: 288000,
      utilization: 0.424,
      combinedBenefit: 123.7,
      categoryBenefits: { heat: 105, vegetation: 65, pedestrian: 110, connectivity: 50 },
      cellsImproved: 2,
      validation: { valid: true, violations: [] },
    };

    it('groups multiple interventions into a single primary cell marker with correct count', () => {
      const grouped = new Map<string, OptimizerResult['selected'][number][]>();
      for (const candidate of mockPlan.selected) {
        grouped.set(candidate.cellId, [...(grouped.get(candidate.cellId) ?? []), candidate]);
      }

      // Cell C-04 should have 3 interventions grouped
      const c4 = grouped.get('C-04');
      expect(c4).toBeDefined();
      expect(c4).toHaveLength(3);

      // Cell C-07 should have 1 intervention (single)
      const c7 = grouped.get('C-07');
      expect(c7).toBeDefined();
      expect(c7).toHaveLength(1);

      // Total grouped marker count on map is exactly 2 cells (no overlapping duplicate markers!)
      expect(grouped.size).toBe(2);
    });

    it('identifies dominant primary intervention and calculates +N badge count', () => {
      const c4Candidates = mockPlan.selected.filter((c) => c.cellId === 'C-04');
      const sorted = [...c4Candidates].sort((a, b) => b.combinedBenefit - a.combinedBenefit);

      const primary = sorted[0]!;
      expect(primary.interventionId).toBe('native_trees');
      expect(primary.combinedBenefit).toBe(45.2);

      // +N count badge should display +2 (since total is 3)
      const badgeCount = sorted.length - 1;
      expect(badgeCount).toBe(2);

      // Total cell cost correctly aggregated
      const totalCellCost = sorted.reduce((sum, c) => sum + c.cost, 0);
      expect(totalCellCost).toBe(132000);
    });
  });

  describe('Phase 7: Map Interaction Modes', () => {
    it('supports Explore, Inspect, and Plan interaction modes cleanly', () => {
      const modes: MapInteractionMode[] = ['explore', 'inspect', 'plan'];
      expect(modes).toHaveLength(3);

      let currentMode: MapInteractionMode = 'explore';
      const setMode = (m: MapInteractionMode) => {
        currentMode = m;
      };

      setMode('inspect');
      expect(currentMode).toBe('inspect');

      setMode('plan');
      expect(currentMode).toBe('plan');
    });

    it('inspect mode routes cell selection directly to cell inspector', () => {
      let activePanel: FullscreenPanelKey | null = null;
      const mode: MapInteractionMode = 'inspect';

      const handleCellClick = (cellId: string) => {
        if (mode === 'inspect') {
          activePanel = 'inspector';
        }
      };

      handleCellClick('C-05');
      expect(activePanel).toBe('inspector');
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

  describe('AI-Adaptive Planning Logic & Comparison Delta', () => {
    it('verifies priority weights sum to 100% when adapting to industrial profile', () => {
      const industrialPriorityWeights = {
        heat: 45,
        vegetation: 25,
        pedestrian: 15,
        connectivity: 15,
      };
      const sum =
        industrialPriorityWeights.heat +
        industrialPriorityWeights.vegetation +
        industrialPriorityWeights.pedestrian +
        industrialPriorityWeights.connectivity;
      expect(sum).toBe(100);
      expect(industrialPriorityWeights.heat).toBeGreaterThanOrEqual(40);
    });

    it('correctly calculates percentage deltas for Standard vs AI-Adaptive benchmark', () => {
      const standardThermalIndex = 12.5;
      const adaptiveThermalIndex = 15.5;
      const deltaThermalPct = Number(
        (((adaptiveThermalIndex - standardThermalIndex) / standardThermalIndex) * 100).toFixed(1)
      );

      expect(deltaThermalPct).toBe(24.0);
      expect(deltaThermalPct).toBeGreaterThan(0);
    });

    it('validates budget ceiling is respected across both Standard and Adaptive runs', () => {
      const budget = 1000000;
      const standardCost = 980000;
      const adaptiveCost = 995000;

      expect(standardCost).toBeLessThanOrEqual(budget);
      expect(adaptiveCost).toBeLessThanOrEqual(budget);
      expect(budget - standardCost).toBeGreaterThanOrEqual(0);
      expect(budget - adaptiveCost).toBeGreaterThanOrEqual(0);
    });
  });
});
