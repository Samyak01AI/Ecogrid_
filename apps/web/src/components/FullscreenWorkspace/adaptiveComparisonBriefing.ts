import type { AdaptiveComparisonResult } from '../../api.js';

export type ComparisonBriefingSection = {
  id: string;
  number: number;
  title: string;
  iconType: 'summary' | 'diff' | 'env' | 'budget' | 'next';
  content: string;
  highlights?: Array<{ label: string; value: string }>;
};

export function formatComparisonBriefing(comparison: AdaptiveComparisonResult): ComparisonBriefingSection[] {
  const { standard_metrics, adaptive_metrics, delta, study_area_name, terrain_type, budget, adaptive_strategy } = comparison;

  const terrainLabel = (terrain_type || 'dense_urban').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const strategyName = adaptive_strategy?.strategy_name || 'AI-Adaptive Optimization';

  // Section 1: Executive Summary
  const execSummary = `For ${study_area_name} (${terrainLabel} profile), AI-Adaptive Optimization evaluated '${strategyName}' under a strict municipal budget ceiling of ₹${budget.toLocaleString('en-IN')}. By shifting weights from rigid generic ratios to localized microclimate priorities, the adaptive plan achieves ${delta.thermal_mitigation_delta_pct > 0 ? '+' : ''}${delta.thermal_mitigation_delta_pct}% higher thermal mitigation and ${delta.pedestrian_comfort_delta_pct > 0 ? '+' : ''}${delta.pedestrian_comfort_delta_pct}% improved pedestrian shade comfort relative to the standard baseline.`;

  // Section 2: Main Differences
  const mainDiff = `The Standard Municipal Baseline distributed ${standard_metrics.total_interventions_count} interventions uniformly across ${standard_metrics.cells_improved_count} distinct cells under fixed 30/25/25/20 weights. In contrast, AI-Adaptive concentrated ${adaptive_metrics.total_interventions_count} interventions across ${adaptive_metrics.cells_improved_count} prioritized cells, targeting higher-yield shading and cool surfaces in severe microclimate vulnerability zones.`;

  // Section 3: Environmental Trade-Offs
  const envTradeoffs = `The adaptive shift rebalanced capital toward high-impact cooling corridors. Thermal mitigation index reached ${adaptive_metrics.thermal_mitigation_index} (${delta.thermal_mitigation_delta_pct > 0 ? '+' : ''}${delta.thermal_mitigation_delta_pct}%), and pedestrian comfort reached ${adaptive_metrics.pedestrian_comfort_benefit} (${delta.pedestrian_comfort_delta_pct > 0 ? '+' : ''}${delta.pedestrian_comfort_delta_pct}%). Canopy deficit closed registered at ${adaptive_metrics.canopy_deficit_closed} (${delta.canopy_closed_delta_pct > 0 ? '+' : ''}${delta.canopy_closed_delta_pct}%), while connectivity improvement reached ${adaptive_metrics.connectivity_improvement} vs baseline ${standard_metrics.connectivity_improvement}.`;

  // Section 4: Budget Implications
  const budgetImplications = `Both models strictly adhered to the ₹${budget.toLocaleString('en-IN')} municipal ceiling. Standard spent ₹${(standard_metrics.budget_spent ?? 0).toLocaleString('en-IN')} (remaining ₹${(standard_metrics.budget_headroom ?? 0).toLocaleString('en-IN')}), while Adaptive deployed ₹${(adaptive_metrics.budget_spent ?? 0).toLocaleString('en-IN')} (remaining ₹${(adaptive_metrics.budget_headroom ?? 0).toLocaleString('en-IN')}). Cost efficiency ratio reached ${adaptive_metrics.cost_efficiency_ratio} (${delta.cost_efficiency_delta_pct > 0 ? '+' : ''}${delta.cost_efficiency_delta_pct}% higher composite environmental benefit per ₹10,000 allocated).`;

  // Section 5: Recommended Next Steps
  const nextSteps = `Apply the AI-Adaptive plan to the active GIS workspace for spatial review. Inspect individual high-priority cells with the Cell Inspector to confirm underground utility clearance, and ratify the procurement schedule with municipal stakeholders.`;

  return [
    {
      id: 'exec-summary',
      number: 1,
      title: 'Executive Summary',
      iconType: 'summary',
      content: execSummary,
      highlights: [
        { label: 'Thermal Delta', value: `${delta.thermal_mitigation_delta_pct > 0 ? '+' : ''}${delta.thermal_mitigation_delta_pct}%` },
        { label: 'Comfort Delta', value: `${delta.pedestrian_comfort_delta_pct > 0 ? '+' : ''}${delta.pedestrian_comfort_delta_pct}%` },
      ],
    },
    {
      id: 'main-diff',
      number: 2,
      title: 'Main Differences',
      iconType: 'diff',
      content: mainDiff,
      highlights: [
        { label: 'Standard Coverage', value: `${standard_metrics.cells_improved_count} cells · ${standard_metrics.total_interventions_count} units` },
        { label: 'Adaptive Coverage', value: `${adaptive_metrics.cells_improved_count} cells · ${adaptive_metrics.total_interventions_count} units` },
      ],
    },
    {
      id: 'env-tradeoffs',
      number: 3,
      title: 'Environmental Trade-Offs',
      iconType: 'env',
      content: envTradeoffs,
      highlights: [
        { label: 'Thermal Mitigation', value: `${adaptive_metrics.thermal_mitigation_index}` },
        { label: 'Canopy Closed', value: `${adaptive_metrics.canopy_deficit_closed}` },
      ],
    },
    {
      id: 'budget-implications',
      number: 4,
      title: 'Budget Implications',
      iconType: 'budget',
      content: budgetImplications,
      highlights: [
        { label: 'Capital Deployed', value: `₹${(adaptive_metrics.budget_spent ?? 0).toLocaleString('en-IN')}` },
        { label: 'Efficiency Gain', value: `${delta.cost_efficiency_delta_pct > 0 ? '+' : ''}${delta.cost_efficiency_delta_pct}%` },
      ],
    },
    {
      id: 'next-steps',
      number: 5,
      title: 'Recommended Next Steps',
      iconType: 'next',
      content: nextSteps,
      highlights: [
        { label: 'Immediate Action', value: 'Apply Plan to Active Map' },
        { label: 'Validation', value: 'Cell Inspector Feasibility Check' },
      ],
    },
  ];
}
