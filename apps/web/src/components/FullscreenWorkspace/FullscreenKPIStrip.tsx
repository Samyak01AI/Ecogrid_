import { AlertTriangle, ArrowRight, Coins, Gauge, Layers, Sparkles, Target } from 'lucide-react';

interface Props {
  totalBudget: number;
  allocated: number;
  cellsInPlan: number;
  totalCells: number;
  overallBenefit: number;
  budgetOutdated?: boolean | undefined;
  activePlanMode?: 'standard' | 'adaptive' | null | undefined;
  strategyName?: string | undefined;
  totalInterventions?: number | undefined;
  onOpenOptimize?: (() => void) | undefined;
  onOpenBudget?: (() => void) | undefined;
  onOpenKPIs?: (() => void) | undefined;
}

function formatINRCompact(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)}L`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}

export function FullscreenKPIStrip({
  totalBudget,
  allocated,
  cellsInPlan,
  totalCells,
  overallBenefit,
  budgetOutdated = false,
  activePlanMode,
  strategyName,
  totalInterventions,
  onOpenOptimize,
  onOpenBudget,
  onOpenKPIs,
}: Props) {
  const utilizationPct = totalBudget > 0 ? Math.min(100, Math.round((allocated / totalBudget) * 100)) : 0;
  const coveragePct = totalCells > 0 ? Math.round((cellsInPlan / totalCells) * 100) : 0;

  return (
    <div className="fullscreen-kpi-strip" role="region" aria-label="Environmental Planning KPI Summary">
      <div className="kpi-strip-container">
        {/* Metric 0: Active Plan Mode Indicator */}
        {activePlanMode && (
          <>
            <button
              type="button"
              className={`kpi-strip-item kpi-strip-plan-badge ${activePlanMode === 'adaptive' ? 'is-adaptive' : 'is-standard'}`}
              title={`Active Plan: ${activePlanMode === 'adaptive' ? `AI-Adaptive (${strategyName || 'Validated Strategy'})` : 'Standard Municipal Baseline'}. Click to inspect optimizer.`}
              onClick={onOpenOptimize}
            >
              <span className={`kpi-strip-icon-wrap ${activePlanMode === 'adaptive' ? 'tone-mint' : 'tone-blue'}`}>
                {activePlanMode === 'adaptive' ? <Sparkles size={13} /> : <Target size={13} />}
              </span>
              <div className="kpi-strip-text">
                <span className="kpi-strip-label">ACTIVE PLAN</span>
                <span className="kpi-strip-value plan-mode-text">
                  {activePlanMode === 'adaptive' ? 'AI-ADAPTIVE' : 'STANDARD'}
                </span>
              </div>
            </button>
            <span className="kpi-strip-divider" aria-hidden="true" />
          </>
        )}
        {/* Metric 1: Total Budget */}
        <button
          type="button"
          className="kpi-strip-item"
          title="Click to manage capital envelope"
          onClick={onOpenBudget}
        >
          <span className="kpi-strip-icon-wrap tone-default">
            <Coins size={14} />
          </span>
          <div className="kpi-strip-text">
            <span className="kpi-strip-label">TOTAL BUDGET</span>
            <span className="kpi-strip-value">{formatINRCompact(totalBudget)}</span>
          </div>
        </button>

        <span className="kpi-strip-divider" aria-hidden="true" />

        {/* Metric 2: Allocated Budget & Utilization */}
        <button
          type="button"
          className="kpi-strip-item"
          title="Click to inspect allocation details"
          onClick={onOpenBudget}
        >
          <span className={`kpi-strip-icon-wrap ${budgetOutdated ? 'tone-amber' : 'tone-mint'}`}>
            <Gauge size={14} />
          </span>
          <div className="kpi-strip-text">
            <div className="kpi-strip-label-row">
              <span className="kpi-strip-label">ALLOCATED</span>
              <span className={`kpi-strip-badge ${budgetOutdated ? 'badge-amber' : 'badge-mint'}`}>
                {utilizationPct}%
              </span>
            </div>
            <span className="kpi-strip-value">{formatINRCompact(allocated)}</span>
          </div>
        </button>

        <span className="kpi-strip-divider" aria-hidden="true" />

        {/* Metric 3: Cells in Plan & Interventions */}
        <button
          type="button"
          className="kpi-strip-item"
          title={`Click to view actioned cells (${cellsInPlan} distinct cells actioned, ${totalInterventions ?? cellsInPlan} total intervention units allocated)`}
          onClick={onOpenKPIs}
        >
          <span className="kpi-strip-icon-wrap tone-blue">
            <Layers size={14} />
          </span>
          <div className="kpi-strip-text">
            <div className="kpi-strip-label-row">
              <span className="kpi-strip-label">CELLS IN PLAN</span>
              <span className="kpi-strip-badge badge-blue">{coveragePct}%</span>
            </div>
            <span className="kpi-strip-value">
              {cellsInPlan} <span className="kpi-strip-sub">/ {totalCells}</span>
              {typeof totalInterventions === 'number' && totalInterventions > 0 && (
                <span className="kpi-strip-units-pill" title={`${totalInterventions} allocated intervention units`}>
                  · {totalInterventions} units
                </span>
              )}
            </span>
          </div>
        </button>

        <span className="kpi-strip-divider" aria-hidden="true" />

        {/* Metric 4: Overall Modeled Benefit */}
        <button
          type="button"
          className="kpi-strip-item"
          title="Click to inspect environmental benefit model"
          onClick={onOpenKPIs}
        >
          <span className="kpi-strip-icon-wrap tone-mint">
            <Sparkles size={14} />
          </span>
          <div className="kpi-strip-text">
            <span className="kpi-strip-label">MODELED BENEFIT</span>
            <span className="kpi-strip-value positive">
              +{overallBenefit > 0 ? overallBenefit.toFixed(1) : '0.0'} <span className="kpi-strip-sub">pts</span>
            </span>
          </div>
        </button>

        {/* Warning Indicator if budget was modified after solver run */}
        {budgetOutdated && (
          <div className="kpi-strip-alert" role="status">
            <AlertTriangle size={13} className="alert-icon" />
            <span className="alert-text">Budget Changed</span>
            {onOpenOptimize && (
              <button
                type="button"
                className="alert-reoptimize-btn"
                onClick={onOpenOptimize}
                title="Open optimizer to resolve updated budget"
              >
                <span>Re-Solve</span>
                <ArrowRight size={11} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
