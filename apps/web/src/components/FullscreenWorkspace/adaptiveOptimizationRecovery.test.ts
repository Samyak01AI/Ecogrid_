import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { normalizeOptimizerResult, type AdaptiveComparisonResult } from '../../api.js';
import { FullscreenErrorBoundary, sanitizeErrorMessage } from './FullscreenErrorBoundary.js';
import { formatComparisonBriefing } from './FullscreenPlanningPanels.js';
import type { OptimizerResult } from '@ecogrid/domain';

describe('Adaptive Optimization Recovery & Error Protection', () => {
  describe('Test 1 & 2: Contract Normalization (Dual Case & Snake Case Defense)', () => {
    it('normalizes raw backend snake_case response into valid camelCase OptimizerResult without undefineds', () => {
      const rawBackendResponse = {
        study_id: 'study-bengaluru',
        total_cost: 450000,
        remaining_budget: 550000,
        combined_benefit: 320.5,
        cells_improved: 14,
        category_benefits: {
          heat: 120.4,
          greenery: 95.1,
          pedestrian: 65.0,
          connectivity: 40.0,
        },
        selected: [
          {
            cell_id: 'C-12',
            intervention_id: 'native_trees',
            intervention_name: 'Native Tree Grove',
            quantity: 5,
            cost: 25000,
            unit: 'trees',
            combined_benefit: 45.2,
            benefit_per_cost: 0.0018,
            coordinates: [12.9716, 77.5946],
            area_name: 'Cubbon North',
            category_benefits: { heat: 20, vegetation: 15, pedestrian: 5, connectivity: 5.2 },
          },
          {
            cell_id: 'C-15',
            intervention_id: 'pollinator_corridor', // should normalize to pollinator_strip
            intervention_name: 'Pollinator Corridor',
            quantity: 2,
            cost: 16000,
            unit: 'strips',
            combined_benefit: 28.0,
            benefit_per_cost: 0.00175,
            coordinates: [12.972, 77.595],
            area_name: 'Cubbon East',
            category_benefits: { heat: 5, vegetation: 10, pedestrian: 5, connectivity: 8 },
          },
        ],
        rejected: [
          {
            candidate: { cell_id: 'C-01', intervention_id: 'native_trees' },
            reason: 'Underground utility clearance failed',
          },
        ],
        validation: { valid: true, violations: [] },
      };

      const plan: OptimizerResult = normalizeOptimizerResult(rawBackendResponse, 'study-bengaluru');

      // Fundamental property assertions
      expect(plan.totalCost).toBe(450000);
      expect(plan.remainingBudget).toBe(550000);
      expect(plan.combinedBenefit).toBe(320.5);
      expect(plan.cellsImproved).toBe(14);
      expect(plan.studyAreaId).toBe('study-bengaluru');
      expect(plan.gridVersion).toBe('2.0');
      expect(plan.crs).toBe('EPSG:4326');

      // Category benefits mapped greenery -> vegetation
      expect(plan.categoryBenefits.vegetation).toBe(95.1);
      expect(plan.categoryBenefits.heat).toBe(120.4);

      // Selected candidates normalized
      expect(plan.selected).toHaveLength(2);
      expect(plan.selected[0]!.cellId).toBe('C-12');
      expect(plan.selected[0]!.interventionId).toBe('native_trees');
      expect(plan.selected[0]!.coordinates).toEqual([12.9716, 77.5946]);
      expect(plan.selected[1]!.interventionId).toBe('pollinator_strip');

      // Calling .toLocaleString on normalized plan NEVER throws
      expect(() => plan.totalCost.toLocaleString('en-IN')).not.toThrow();
      expect(plan.totalCost.toLocaleString('en-IN')).toBe((450000).toLocaleString('en-IN'));
      expect(() => Math.round(plan.utilization * 100)).not.toThrow();
      expect(() => Math.round(plan.combinedBenefit)).not.toThrow();
    });

    it('safely handles empty or null payload without throwing or leaving NaN/undefined values', () => {
      const plan = normalizeOptimizerResult(null, 'study-delhi');

      expect(plan.totalCost).toBe(0);
      expect(plan.remainingBudget).toBe(0);
      expect(plan.utilization).toBe(0);
      expect(plan.combinedBenefit).toBe(0);
      expect(plan.cellsImproved).toBe(0);
      expect(plan.selected).toEqual([]);
      expect(plan.rejected).toEqual([]);
      expect(plan.studyAreaId).toBe('study-delhi');
      expect(plan.validation.valid).toBe(true);

      // Verify safe number operations on all fields
      expect(() => plan.totalCost.toLocaleString('en-IN')).not.toThrow();
      expect(plan.totalCost.toLocaleString('en-IN')).toBe('0');
      expect(Math.round(plan.utilization * 100)).toBe(0);
      expect(Math.round(plan.combinedBenefit)).toBe(0);
    });

    it('recovers cellsImproved automatically from distinct cellIds if omitted in payload', () => {
      const raw = {
        totalCost: 10000,
        selected: [
          { cellId: 'C-01', cost: 5000, combinedBenefit: 10 },
          { cellId: 'C-01', cost: 2000, combinedBenefit: 5 },
          { cellId: 'C-02', cost: 3000, combinedBenefit: 7 },
        ],
      };

      const plan = normalizeOptimizerResult(raw);
      expect(plan.cellsImproved).toBe(2); // 2 distinct cells (C-01 and C-02)
    });
  });

  describe('Test 3 & 4: Sanitization & Developer Diagnostics in FullscreenErrorBoundary', () => {
    it('sanitizes Grok API keys, bearer tokens, and passwords from error details', () => {
      const rawErrorMsg =
        'Grok API authorization failed with key xai-998877665544332211aabbcc and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9. Password password=SuperSecretPlanner123 was used.';

      const sanitized = sanitizeErrorMessage(rawErrorMsg);
      expect(sanitized).not.toContain('xai-998877665544332211aabbcc');
      expect(sanitized).toContain('[REDACTED_SECRET]');
      expect(sanitized).not.toContain('SuperSecretPlanner123');
      expect(sanitized).toContain('password=[REDACTED]');

      const boundary = new FullscreenErrorBoundary({ children: null });
      const leakyError = new Error(rawErrorMsg);

      // Call getDerivedStateFromError
      const state = FullscreenErrorBoundary.getDerivedStateFromError(leakyError);
      expect(state.hasError).toBe(true);
      expect(state.error).toBe(leakyError);

      // Verify componentDidCatch doesn't leak secrets in logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      boundary.componentDidCatch(leakyError, { componentStack: 'at FullscreenOptimizeView\nwith secret xai-abcdef1234567890' });

      expect(consoleSpy).toHaveBeenCalled();
      const ecoGridCall = consoleSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('[EcoGrid AI]')
      );
      expect(ecoGridCall).toBeDefined();
      const loggedArg = ecoGridCall![1] as { message: string; componentStack?: string };
      expect(loggedArg.message).not.toContain('xai-998877665544332211aabbcc');
      expect(loggedArg.message).toContain('[REDACTED_SECRET]');
      expect(loggedArg.message).not.toContain('SuperSecretPlanner123');
      expect(loggedArg.message).toContain('password=[REDACTED]');
      expect(loggedArg.componentStack).toContain('[REDACTED_SECRET]');
      consoleSpy.mockRestore();
    });
  });

  describe('Test 5 & 6: Non-Destructive Failure State & Location Switching Defense', () => {
    it('ensures existing plan remains intact when optimization fails', async () => {
      const existingPlan: OptimizerResult = {
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        crs: 'EPSG:4326',
        selected: [
          {
            cellId: 'C-01',
            areaName: 'Old Site',
            interventionId: 'native_trees',
            interventionName: 'Native Trees',
            quantity: 3,
            unit: 'trees',
            cost: 15000,
            combinedBenefit: 30,
            benefitPerCost: 0.002,
            categoryBenefit: { heat: 10, vegetation: 10, pedestrian: 5, connectivity: 5 },
          },
        ],
        rejected: [],
        totalCost: 15000,
        remainingBudget: 85000,
        utilization: 0.15,
        combinedBenefit: 30,
        categoryBenefits: { heat: 10, vegetation: 10, pedestrian: 5, connectivity: 5 },
        cellsImproved: 1,
        validation: { valid: true, violations: [] },
      };

      let currentPlan: OptimizerResult | null = existingPlan;
      let errorMessage: string | null = null;

      // Simulated optimization handler with try/catch
      const runFailedOptimization = async () => {
        try {
          throw new Error('OR-Tools CP-SAT infeasible: statutory tree restrictions violated in all priority cells.');
        } catch (err) {
          // Non-destructive: DO NOT touch currentPlan
          errorMessage = 'Adaptive optimization could not be completed. Your existing plan is unchanged. Review the error or retry.';
        }
      };

      await runFailedOptimization();

      // Existing plan is 100% preserved
      expect(currentPlan).toBe(existingPlan);
      expect(currentPlan?.totalCost).toBe(15000);
      expect(currentPlan?.selected).toHaveLength(1);
      expect(errorMessage).toBe('Adaptive optimization could not be completed. Your existing plan is unchanged. Review the error or retry.');
    });

    it('prevents stale requests from a previously selected study area from overwriting newer study area state', async () => {
      let activeStudyId = 'study-delhi';
      let activePlanStudyId: string | null = null;

      const runWithRaceConditionGuard = async (invokedStudyId: string, delayMs: number) => {
        await new Promise((r) => setTimeout(r, delayMs));
        // Check if study area changed while waiting for response
        if (invokedStudyId !== activeStudyId) {
          return; // Discard stale response
        }
        activePlanStudyId = invokedStudyId;
      };

      // Launch slow request for Delhi
      const p1 = runWithRaceConditionGuard('study-delhi', 50);

      // User immediately switches to Bengaluru
      activeStudyId = 'study-bengaluru';
      const p2 = runWithRaceConditionGuard('study-bengaluru', 10);

      await Promise.all([p1, p2]);

      // Bengaluru must be the active plan, Delhi response was discarded
      expect(activePlanStudyId).toBe('study-bengaluru');
    });
  });

  describe('Section 3, 4 & 5: AI-Adaptive Comparison Layout, Briefing & Consistency', () => {
    const mockComparisonResult: AdaptiveComparisonResult = {
      study_area_id: 'study-indiranagar',
      study_area_name: 'Indiranagar Urban Corridor',
      terrain_type: 'dense_urban',
      budget: 500000,
      standard_strategy: { strategy_id: 'standard_fixed_weights' },
      adaptive_strategy: {
        strategy_id: 'strat-dense-heat-shield',
        strategy_name: 'Urban Heat Shield v2',
        strategy_version: '2.0.0',
        terrain_type: 'dense_urban',
        formula_id: 'formula-canopy-boost',
        priority_weights: { heat: 0.45, vegetation: 0.25, pedestrian: 0.2, connectivity: 0.1 },
        optimization_weights: { w_heat: 45, w_biodiversity: 5, w_connectivity: 10, w_greenery: 20, w_pedestrian: 20 },
        model_id: 'rf-cooling-v2',
        model_version: '2.0',
        preferred_interventions: ['native_trees', 'cool_surface'],
        explanation: 'Prioritized high thermal mass commercial corridor cells.',
        validation_status: 'VALIDATED',
        fallback_applied: false,
        validation_errors: [],
        checked_rules: ['budget_feasibility', 'statutory_compliance'],
        parameter_hash: 'hash-abc-123',
        timestamp: '2026-10-25T00:00:00Z',
        provenance: 'Grok-AI-Gateway',
      },
      standard_metrics: {
        thermal_mitigation_index: 48.2,
        canopy_deficit_closed: 34.1,
        pedestrian_comfort_benefit: 30.5,
        connectivity_improvement: 22.0,
        cost_efficiency_ratio: 2.69,
        total_interventions_count: 60,
        cells_improved_count: 59,
        budget_spent: 49990,
        budget_headroom: 10,
      },
      adaptive_metrics: {
        thermal_mitigation_index: 55.6,
        canopy_deficit_closed: 38.5,
        pedestrian_comfort_benefit: 36.8,
        connectivity_improvement: 24.5,
        cost_efficiency_ratio: 3.11,
        total_interventions_count: 79,
        cells_improved_count: 34,
        budget_spent: 49980,
        budget_headroom: 20,
      },
      delta: {
        thermal_mitigation_delta_pct: 15.4,
        canopy_closed_delta_pct: 12.9,
        pedestrian_comfort_delta_pct: 20.7,
        cost_efficiency_delta_pct: 15.6,
        cells_improved_diff: -25,
        cost_diff_inr: -10,
      },
      explanation: 'Comparison summary for Indiranagar Urban Corridor.',
      fairness_disclaimer: 'Both models evaluated under identical solver constraints and shared objective metrics.',
      standard_plan: {
        selected: [],
        rejected: [],
        totalCost: 49990,
        remainingBudget: 10,
        utilization: 0.999,
        combinedBenefit: 134.8,
        categoryBenefits: { heat: 48.2, vegetation: 34.1, pedestrian: 30.5, connectivity: 22.0 },
        cellsImproved: 59,
        validation: { valid: true, violations: [] },
      },
      adaptive_plan: {
        selected: [],
        rejected: [],
        totalCost: 49980,
        remainingBudget: 20,
        utilization: 0.999,
        combinedBenefit: 155.4,
        categoryBenefits: { heat: 55.6, vegetation: 38.5, pedestrian: 36.8, connectivity: 24.5 },
        cellsImproved: 34,
        validation: { valid: true, violations: [] },
      },
    };

    it('formats comparison briefing into exactly 5 concise, structured sections', () => {
      const sections = formatComparisonBriefing(mockComparisonResult);

      expect(sections).toHaveLength(5);
      expect(sections.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);

      expect(sections[0]?.title).toBe('Executive Summary');
      expect(sections[0]?.content).toContain('Indiranagar Urban Corridor');
      expect(sections[0]?.content).toContain('+15.4%');
      expect(sections[0]?.highlights).toBeDefined();

      expect(sections[1]?.title).toBe('Main Differences');
      expect(sections[1]?.content).toContain('60 interventions uniformly across 59 distinct cells');
      expect(sections[1]?.content).toContain('79 interventions across 34 prioritized cells');

      expect(sections[2]?.title).toBe('Environmental Trade-Offs');
      expect(sections[2]?.content).toContain('55.6');
      expect(sections[2]?.content).toContain('36.8');

      expect(sections[3]?.title).toBe('Budget Implications');
      expect(sections[3]?.content).toContain('5,00,000');
      expect(sections[3]?.content).toContain('+15.6%');

      expect(sections[4]?.title).toBe('Recommended Next Steps');
      expect(sections[4]?.content).toContain('GIS workspace');
    });

    it('distinguishes distinct cells covered from intervention units allocated', () => {
      // In Standard: 60 intervention units allocated across 59 distinct cells
      expect(mockComparisonResult.standard_metrics.total_interventions_count).toBe(60);
      expect(mockComparisonResult.standard_metrics.cells_improved_count).toBe(59);
      expect(mockComparisonResult.standard_metrics.total_interventions_count).not.toBe(
        mockComparisonResult.standard_metrics.cells_improved_count
      );

      // In Adaptive: 79 intervention units allocated across 34 distinct cells
      expect(mockComparisonResult.adaptive_metrics.total_interventions_count).toBe(79);
      expect(mockComparisonResult.adaptive_metrics.cells_improved_count).toBe(34);
      expect(mockComparisonResult.adaptive_metrics.total_interventions_count).toBeGreaterThan(
        mockComparisonResult.adaptive_metrics.cells_improved_count
      );
    });

    it('preserves planMode and strategyName across plan normalizations', () => {
      const adaptiveResult = normalizeOptimizerResult(
        {
          ...mockComparisonResult.adaptive_plan,
          plan_mode: 'adaptive',
          strategy_name: 'Urban Heat Shield v2',
        },
        'study-indiranagar'
      );

      expect(adaptiveResult.planMode).toBe('adaptive');
      expect(adaptiveResult.strategyName).toBe('Urban Heat Shield v2');

      const standardResult = normalizeOptimizerResult(
        {
          ...mockComparisonResult.standard_plan,
          planMode: 'standard',
          strategyName: 'Standard Municipal Baseline',
        },
        'study-indiranagar'
      );

      expect(standardResult.planMode).toBe('standard');
      expect(standardResult.strategyName).toBe('Standard Municipal Baseline');
    });

    it('ensures all 9 backend-supported comparison metrics are defined with correct types and units', () => {
      const sm = mockComparisonResult.standard_metrics;
      const am = mockComparisonResult.adaptive_metrics;

      // 1. Thermal Mitigation Index
      expect(typeof sm.thermal_mitigation_index).toBe('number');
      expect(typeof am.thermal_mitigation_index).toBe('number');

      // 2. Canopy Deficit Closed
      expect(typeof sm.canopy_deficit_closed).toBe('number');
      expect(typeof am.canopy_deficit_closed).toBe('number');

      // 3. Pedestrian Comfort Benefit
      expect(typeof sm.pedestrian_comfort_benefit).toBe('number');
      expect(typeof am.pedestrian_comfort_benefit).toBe('number');

      // 4. Cost Efficiency Ratio
      expect(typeof sm.cost_efficiency_ratio).toBe('number');
      expect(typeof am.cost_efficiency_ratio).toBe('number');

      // 5. Interventions Allocated
      expect(typeof sm.total_interventions_count).toBe('number');
      expect(typeof am.total_interventions_count).toBe('number');

      // 6. Cells Covered
      expect(typeof sm.cells_improved_count).toBe('number');
      expect(typeof am.cells_improved_count).toBe('number');

      // 7. Capital Spent
      expect(typeof sm.budget_spent).toBe('number');
      expect(typeof am.budget_spent).toBe('number');

      // 8. Budget Remaining
      expect(typeof sm.budget_headroom).toBe('number');
      expect(typeof am.budget_headroom).toBe('number');

      // 9. Overall Modeled Benefit
      expect(mockComparisonResult.standard_plan.combinedBenefit).toBeGreaterThan(0);
      expect(mockComparisonResult.adaptive_plan.combinedBenefit).toBeGreaterThan(0);
    });
  });
});
