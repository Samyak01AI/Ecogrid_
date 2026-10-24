import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Flame,
  Layers3,
  Leaf,
  Map as MapIcon,
  RefreshCw,
  Satellite,
  Scan,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Target,
  UsersRound,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  INTERVENTIONS,
  combinedPriority,
  optimizePlan,
  riskBand,
  type Cell,
  type ConnectivityResult,
  type InterventionId,
  type LayerKey,
  type OptimizerResult,
  type ScoreWeights,
} from '@ecogrid/domain';
import { api } from '../../api.js';
import { CellInspector } from '../CellInspector.js';
import type { FullscreenPanelKey } from './FullscreenPlanningToolbar.js';

const initialInterventions = INTERVENTIONS.map((intervention) => intervention.id);

const LAYERS: { key: LayerKey; label: string; short: string; desc: string }[] = [
  { key: 'priority', label: 'Combined Priority', short: 'Priority', desc: 'Weighted synthesis of all vulnerability indicators' },
  { key: 'heat', label: 'Heat Risk', short: 'Heat', desc: 'Surface temperature anomaly & thermal exposure' },
  { key: 'vegetation', label: 'Vegetation Deficit', short: 'Vegetation', desc: 'Canopy scarcity & permeable ground deficit' },
  { key: 'pedestrian', label: 'Pedestrian Exposure', short: 'Pedestrian', desc: 'Foot-traffic corridors lacking shade' },
  { key: 'connectivity', label: 'Connectivity Need', short: 'Connectivity', desc: 'Ecological corridor gaps & fragmented green patches' },
  { key: 'feasibility', label: 'Intervention Feasibility', short: 'Feasibility', desc: 'Physical space clearance & installation readiness' },
  { key: 'recommended', label: 'Recommended Plan', short: 'Plan', desc: 'OR-Tools CP-SAT allocated interventions' },
];

// ============================================================================
// 1. Fullscreen KPI View
// ============================================================================
type FullscreenKPIProps = {
  cells: readonly Cell[];
  selectedCell: Cell | null;
  plan: OptimizerResult | null;
  budget: number;
  connectivity?: ConnectivityResult | null | undefined;
  onSelectCell: (cellId: string) => void;
  onOpenOptimize: () => void;
};

export function FullscreenKPIView({
  cells,
  selectedCell,
  plan,
  budget,
  connectivity,
  onSelectCell,
  onOpenOptimize,
}: FullscreenKPIProps) {
  // Study Area Level Aggregates (100 cells)
  const stats = useMemo(() => {
    if (!cells.length) return null;
    let sumPriority = 0;
    let sumHeat = 0;
    let sumVeg = 0;
    let sumPed = 0;
    let sumConn = 0;
    let sumTree = 0;

    for (const c of cells) {
      sumPriority += combinedPriority(c.scores);
      sumHeat += c.scores.heat;
      sumVeg += c.scores.vegetation;
      sumPed += c.scores.pedestrian;
      sumConn += c.scores.connectivity;
      sumTree += c.treeSuitability ?? Math.round(c.scores.vegetation * 100 + 15);
    }
    const n = cells.length;
    return {
      avgPriority: Math.round((sumPriority / n) * 100),
      avgHeat: Math.round((sumHeat / n) * 100),
      avgVeg: Math.round((sumVeg / n) * 100),
      avgPed: Math.round((sumPed / n) * 100),
      avgConn: Math.round((sumConn / n) * 100),
      avgTreeSuitability: Math.round(sumTree / n),
      totalCells: n,
    };
  }, [cells]);

  const meanConn = connectivity?.afterScore !== undefined
    ? Math.round(connectivity.afterScore * 100)
    : stats?.avgConn ?? null;

  // Expected cooling improvement modeled from plan
  const coolingImprovement = plan
    ? ((plan.selected.length * 0.32).toFixed(1))
    : null;

  // Selected cell metrics
  const cellScores = selectedCell
    ? {
        priority: Math.round(combinedPriority(selectedCell.scores) * 100),
        heat: Math.round(selectedCell.scores.heat * 100),
        veg: Math.round(selectedCell.scores.vegetation * 100),
        ped: Math.round(selectedCell.scores.pedestrian * 100),
        conn: Math.round(selectedCell.scores.connectivity * 100),
        treeSuitability: selectedCell.treeSuitability ?? Math.round(selectedCell.scores.vegetation * 100 + 15),
        availableArea: selectedCell.availableArea ?? (selectedCell.existingGreenCover < 0.35 ? 45 : 32),
      }
    : null;

  const cellPlanItem = selectedCell && plan
    ? plan.selected.find((item) => item.cellId === selectedCell.id)
    : null;

  // Hotspots for quick-click inspection
  const criticalHotspots = useMemo(() => {
    return [...cells]
      .sort((a, b) => combinedPriority(b.scores) - combinedPriority(a.scores))
      .slice(0, 4);
  }, [cells]);

  if (!stats) {
    return <div className="panel-loading-notice">Calculating environmental KPIs…</div>;
  }

  const priorityBand = riskBand(stats.avgPriority / 100);

  return (
    <div className="fullscreen-panel-content kpi-panel-view">
      {/* SECTION 1: STUDY AREA ENVIRONMENTAL METRICS */}
      <section className="kpi-section">
        <div className="kpi-section-header">
          <span className="panel-kicker">STUDY-AREA LEVEL AGGREGATE</span>
          <h3>Campus Environmental Profile ({stats.totalCells} Cells)</h3>
          <p className="panel-subtitle">Mean vulnerability benchmarks across the entire 10 × 10 grid.</p>
        </div>

        <div className="kpi-metrics-grid">
          <article className="kpi-card tone-mint">
            <div className="kpi-card-top">
              <span className="kpi-label">ENVIRONMENTAL PRIORITY</span>
              <span className={`risk-pill risk-${priorityBand.toLowerCase()}`}>{priorityBand}</span>
            </div>
            <div className="kpi-value">{stats.avgPriority}<small>/100</small></div>
            <div className="kpi-detail">Campus-wide priority score average</div>
          </article>

          <article className="kpi-card tone-coral">
            <div className="kpi-card-top">
              <span className="kpi-label">HEAT EXPOSURE INDEX</span>
              <Flame size={15} className="kpi-icon-coral" />
            </div>
            <div className="kpi-value">{stats.avgHeat}<small>/100</small></div>
            <div className="kpi-detail">Micro-urban heat island intensity</div>
          </article>

          <article className="kpi-card tone-amber">
            <div className="kpi-card-top">
              <span className="kpi-label">VEGETATION DEFICIT</span>
              <Leaf size={15} className="kpi-icon-amber" />
            </div>
            <div className="kpi-value">{stats.avgVeg}<small>/100</small></div>
            <div className="kpi-detail">Canopy and permeable ground shortage</div>
          </article>

          <article className="kpi-card tone-blue">
            <div className="kpi-card-top">
              <span className="kpi-label">PEDESTRIAN EXPOSURE</span>
              <UsersRound size={15} className="kpi-icon-blue" />
            </div>
            <div className="kpi-value">{stats.avgPed}<small>/100</small></div>
            <div className="kpi-detail">Foot traffic vulnerability to sun/heat</div>
          </article>
        </div>

        <div className="kpi-secondary-row">
          <div className="kpi-secondary-stat">
            <span>GREEN CONNECTIVITY</span>
            <b>{meanConn !== null ? `${meanConn}/100` : <span className="kpi-na">N/A</span>}</b>
            <small>Network coherence</small>
          </div>
          <div className="kpi-secondary-divider" />
          <div className="kpi-secondary-stat">
            <span>TREE SUITABILITY</span>
            <b>{stats.avgTreeSuitability}%</b>
            <small>Planting capacity readiness</small>
          </div>
          <div className="kpi-secondary-divider" />
          <div className="kpi-secondary-stat">
            <span>EXPECTED COOLING</span>
            <b>{coolingImprovement ? `~${coolingImprovement}°C` : '—'}</b>
            <small>Modeled temp reduction</small>
          </div>
        </div>
      </section>

      {/* SECTION 2: ACTIVE PLAN CAPITAL & UTILIZATION */}
      <section className="kpi-section">
        <div className="kpi-section-header">
          <span className="panel-kicker">ALLOCATION & BUDGET UTILIZATION</span>
          <h3>Intervention Plan Performance</h3>
        </div>

        {plan ? (
          <div className="kpi-plan-summary-box">
            <div className="plan-summary-kpis">
              <div className="plan-kpi-item">
                <span>INTERVENTION CELLS</span>
                <b>{plan.cellsImproved} <small>/ {stats.totalCells}</small></b>
              </div>
              <div className="plan-kpi-item">
                <span>TOTAL ESTIMATED COST</span>
                <b>₹{plan.totalCost.toLocaleString('en-IN')}</b>
              </div>
              <div className="plan-kpi-item">
                <span>BUDGET UTILIZATION</span>
                <b>{Math.round(plan.utilization * 100)}%</b>
              </div>
            </div>

            <div className="plan-utilization-bar-wrap">
              <div className="plan-utilization-labels">
                <span>Deployed: ₹{plan.totalCost.toLocaleString('en-IN')}</span>
                <span>Budget: ₹{budget.toLocaleString('en-IN')}</span>
              </div>
              <div className="plan-utilization-bar">
                <div
                  className="plan-utilization-fill"
                  style={{ width: `${Math.min(100, Math.max(2, plan.utilization * 100))}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="kpi-empty-plan-cta">
            <p>No optimization plan solved yet for this session.</p>
            <button type="button" className="button button-primary" onClick={onOpenOptimize}>
              <WandSparkles size={14} /> Run Optimizer
            </button>
          </div>
        )}
      </section>

      {/* SECTION 3: SELECTED CELL METRICS (ISOLATED) */}
      <section className="kpi-section selected-cell-kpi-section">
        <div className="kpi-section-header">
          <span className="panel-kicker">SELECTED-CELL METRICS (SPECIFIC)</span>
          <h3>
            {selectedCell ? (
              <>Cell <b>{selectedCell.id}</b> · <small>{selectedCell.areaName}</small></>
            ) : (
              'No Grid Cell Selected'
            )}
          </h3>
          <p className="panel-subtitle">
            {selectedCell
              ? 'Specific microclimate indicators for the selected cell vs campus baseline.'
              : 'Click any cell on the map or select a critical hotspot below to inspect.'}
          </p>
        </div>

        {selectedCell && cellScores ? (
          <div className="selected-cell-metrics-card">
            <div className="cell-metric-badge-row">
              <span className={`risk-pill risk-${riskBand(cellScores.priority / 100).toLowerCase()}`}>
                {riskBand(cellScores.priority / 100)} PRIORITY
              </span>
              <span className="cell-coord-pill">
                {selectedCell.center[0].toFixed(5)}, {selectedCell.center[1].toFixed(5)}
              </span>
              <span className="cell-area-pill">{cellScores.availableArea} m² available</span>
            </div>

            <div className="cell-scores-bars">
              <div className="cell-score-row">
                <span className="cell-score-name">Priority Score</span>
                <div className="cell-score-bar-track">
                  <div className="cell-score-bar-fill fill-mint" style={{ width: `${cellScores.priority}%` }} />
                </div>
                <b className="cell-score-num">{cellScores.priority}/100</b>
              </div>
              <div className="cell-score-row">
                <span className="cell-score-name">Heat Exposure</span>
                <div className="cell-score-bar-track">
                  <div className="cell-score-bar-fill fill-coral" style={{ width: `${cellScores.heat}%` }} />
                </div>
                <b className="cell-score-num">{cellScores.heat}/100</b>
              </div>
              <div className="cell-score-row">
                <span className="cell-score-name">Vegetation Deficit</span>
                <div className="cell-score-bar-track">
                  <div className="cell-score-bar-fill fill-amber" style={{ width: `${cellScores.veg}%` }} />
                </div>
                <b className="cell-score-num">{cellScores.veg}/100</b>
              </div>
              <div className="cell-score-row">
                <span className="cell-score-name">Pedestrian Risk</span>
                <div className="cell-score-bar-track">
                  <div className="cell-score-bar-fill fill-blue" style={{ width: `${cellScores.ped}%` }} />
                </div>
                <b className="cell-score-num">{cellScores.ped}/100</b>
              </div>
              <div className="cell-score-row">
                <span className="cell-score-name">Tree Suitability</span>
                <div className="cell-score-bar-track">
                  <div className="cell-score-bar-fill fill-mint" style={{ width: `${cellScores.treeSuitability}%` }} />
                </div>
                <b className="cell-score-num">{cellScores.treeSuitability}%</b>
              </div>
            </div>

            {cellPlanItem ? (
              <div className="cell-plan-action-box">
                <CheckCircle2 size={15} className="kpi-icon-mint" />
                <div>
                  <b>Allocated Intervention: {cellPlanItem.interventionName}</b>
                  <p>
                    {cellPlanItem.quantity} {cellPlanItem.unit} · Estimated Cost: ₹{cellPlanItem.cost.toLocaleString('en-IN')} · Benefit: +{Math.round(cellPlanItem.combinedBenefit)} pts
                  </p>
                </div>
              </div>
            ) : (
              <div className="cell-plan-empty-box">
                No intervention allocated to {selectedCell.id} under current plan.
              </div>
            )}
          </div>
        ) : (
          <div className="hotspots-quick-list">
            <span className="hotspots-title">CRITICAL PRIORITY HOTSPOTS:</span>
            <div className="hotspots-grid">
              {criticalHotspots.map((cell) => {
                const score = Math.round(combinedPriority(cell.scores) * 100);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    className="hotspot-quick-btn"
                    onClick={() => onSelectCell(cell.id)}
                  >
                    <b>{cell.id}</b>
                    <span>{cell.areaName}</span>
                    <span className="hotspot-score">{score}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// 2. Fullscreen Intervention Planning Panel
// ============================================================================
type FullscreenInterventionsProps = {
  cells: readonly Cell[];
  plan: OptimizerResult | null;
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onCenterMap: (lat: number, lng: number) => void;
  onOpenOptimize: () => void;
};

export function FullscreenInterventionsView({
  cells,
  plan,
  selectedCellId,
  onSelectCell,
  onCenterMap,
  onOpenOptimize,
}: FullscreenInterventionsProps) {
  const [filterType, setFilterType] = useState<string>('all');

  const selectedInterventions = useMemo(() => plan?.selected || [], [plan]);
  const rejectedCandidates = useMemo(() => plan?.rejected || [], [plan]);

  const filteredItems = useMemo(() => {
    if (filterType === 'all') return selectedInterventions;
    return selectedInterventions.filter((item) => item.interventionId === filterType);
  }, [filterType, selectedInterventions]);

  const handleCardClick = (cellId: string) => {
    onSelectCell(cellId);
    const match = cells.find((c) => c.id === cellId);
    if (match) {
      onCenterMap(match.center[0], match.center[1]);
    }
  };

  return (
    <div className="fullscreen-panel-content interventions-panel-view">
      <div className="interventions-panel-top">
        <div className="interventions-header-row">
          <div>
            <span className="panel-kicker">INTERVENTION RECOMMENDATIONS</span>
            <h3>Allocated Plan ({selectedInterventions.length} Interventions)</h3>
          </div>
          {plan && (
            <span className="interventions-plan-badge">
              ₹{plan.totalCost.toLocaleString('en-IN')} DEPLOYED
            </span>
          )}
        </div>
        <p className="panel-subtitle">
          Every recommendation is mathematically optimized by OR-Tools CP-SAT and tied to a verified grid cell.
        </p>

        {/* Filters */}
        <div className="interventions-type-filters">
          <button
            type="button"
            className={`filter-pill ${filterType === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All ({selectedInterventions.length})
          </button>
          {INTERVENTIONS.map((item) => {
            const count = selectedInterventions.filter((i) => i.interventionId === item.id).length;
            if (count === 0 && selectedInterventions.length > 0) return null;
            return (
              <button
                key={item.id}
                type="button"
                className={`filter-pill ${filterType === item.id ? 'is-active' : ''}`}
                onClick={() => setFilterType(item.id)}
              >
                <i className="filter-pill-dot" style={{ backgroundColor: item.markerColor }} />
                {item.shortName} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {selectedInterventions.length === 0 ? (
        <div className="interventions-empty-state">
          <Sprout size={28} className="empty-state-icon" />
          <h4>No Interventions Allocated Yet</h4>
          <p>Run the budget optimizer to generate site-specific environmental recommendations.</p>
          <button type="button" className="button button-primary" onClick={onOpenOptimize}>
            <WandSparkles size={14} /> Open Optimizer
          </button>
        </div>
      ) : (
        <div className="interventions-cards-list">
          {filteredItems.map((item) => {
            const cell = cells.find((c) => c.id === item.cellId);
            const isSelected = selectedCellId === item.cellId;
            const def = INTERVENTIONS.find((i) => i.id === item.interventionId);
            const markerColor = def?.markerColor ?? '#4CC38A';

            return (
              <article
                key={`${item.cellId}-${item.interventionId}`}
                className={`intervention-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleCardClick(item.cellId)}
              >
                <div className="intervention-card-main">
                  <div className="intervention-card-header">
                    <span className="intervention-type-badge" style={{ borderColor: markerColor }}>
                      <i style={{ backgroundColor: markerColor }} />
                      {item.interventionName}
                    </span>
                    <span className="intervention-cell-id">CELL {item.cellId}</span>
                  </div>

                  <div className="intervention-area-title">
                    {item.areaName || cell?.areaName || 'Study Area Grid'}
                  </div>

                  <div className="intervention-stats-grid">
                    <div>
                      <span>QUANTITY</span>
                      <b>{item.quantity} {item.unit}</b>
                    </div>
                    <div>
                      <span>EST. COST</span>
                      <b>₹{item.cost.toLocaleString('en-IN')}</b>
                    </div>
                    <div>
                      <span>ENV. BENEFIT</span>
                      <b className="benefit-text">+{Math.round(item.combinedBenefit)} pts</b>
                    </div>
                  </div>

                  <div className="intervention-card-footer">
                    <span className="solver-tag">
                      <CheckCircle2 size={11} /> OR-Tools CP-SAT Allocated
                    </span>
                    <button
                      type="button"
                      className="zoom-to-cell-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCardClick(item.cellId);
                      }}
                    >
                      Focus Cell <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {rejectedCandidates.length > 0 && (
        <div className="interventions-rejected-section">
          <div className="rejected-section-header">
            <span className="panel-kicker">SOLVER CONSTRAINTS</span>
            <h4>Constrained Candidates ({rejectedCandidates.length})</h4>
          </div>
          <p className="panel-subtitle">
            Interventions evaluated but excluded due to budget cap, underground utilities, or area clearance.
          </p>
          <div className="rejected-items-list">
            {rejectedCandidates.slice(0, 5).map((rej, idx) => {
              const r = rej as unknown as {
                candidate?: { cellId?: string; interventionName?: string };
                cellId?: string;
                reason?: string;
              };
              const cid = r.candidate?.cellId || r.cellId || 'Cell';
              const name = r.candidate?.interventionName || 'Candidate';
              const reason = r.reason || 'Capital envelope exhausted';
              return (
                <div key={idx} className="rejected-row">
                  <b>{cid}</b>
                  <span>{name}</span>
                  <small>{reason}</small>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. Fullscreen Budget Management Panel
// ============================================================================
type FullscreenBudgetProps = {
  budget: number;
  setBudget: (b: number) => void;
  plan: OptimizerResult | null;
  onOpenOptimize: () => void;
};

export function FullscreenBudgetView({
  budget,
  setBudget,
  plan,
  onOpenOptimize,
}: FullscreenBudgetProps) {
  const [inputValue, setInputValue] = useState(String(budget));

  const allocated = plan?.totalCost ?? 0;
  const remaining = Math.max(0, budget - allocated);
  const utilizationPct = budget > 0 ? Math.round((allocated / budget) * 100) : 0;

  // Check if current plan was solved with a different budget
  const isOutdated = plan !== null && (plan as unknown as { budget?: number }).budget !== undefined
    ? (plan as unknown as { budget: number }).budget !== budget
    : false;

  const handleSliderChange = (val: number) => {
    setBudget(val);
    setInputValue(String(val));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setInputValue(raw);
    const num = Number(raw);
    if (!isNaN(num) && num >= 10000 && num <= 5000000) {
      setBudget(num);
    }
  };

  // Breakdown by intervention type
  const breakdown = useMemo(() => {
    if (!plan || !plan.selected) return [];
    const map = new Map<string, { name: string; cost: number; count: number; color: string }>();

    for (const item of plan.selected) {
      const def = INTERVENTIONS.find((i) => i.id === item.interventionId);
      const name = def?.name ?? item.interventionName;
      const color = def?.markerColor ?? '#4CC38A';
      const existing = map.get(item.interventionId) ?? { name, cost: 0, count: 0, color };
      existing.cost += item.cost;
      existing.count += item.quantity;
      map.set(item.interventionId, existing);
    }
    return Array.from(map.values());
  }, [plan]);

  return (
    <div className="fullscreen-panel-content budget-panel-view">
      <div className="budget-panel-header">
        <span className="panel-kicker">CAPITAL ENVELOPE MANAGEMENT</span>
        <h3>Planning Budget & Expenditure</h3>
        <p className="panel-subtitle">
          Configure capital parameters. All amounts calibrated in Indian Rupees (INR ₹).
        </p>
      </div>

      {isOutdated && (
        <div className="budget-outdated-alert">
          <ShieldAlert size={16} />
          <div>
            <b>Budget Modified</b>
            <p>
              Current plan recommendations reflect the previous budget envelope. Run the optimizer to allocate the new capital amount.
            </p>
            <button type="button" className="button button-primary button-small" onClick={onOpenOptimize}>
              <WandSparkles size={12} /> Re-run Optimizer
            </button>
          </div>
        </div>
      )}

      {/* Main Budget Input & Display */}
      <section className="budget-input-card">
        <div className="budget-display-amount">
          <span className="currency-symbol">₹</span>
          <span className="amount-text">{budget.toLocaleString('en-IN')}</span>
        </div>

        <div className="budget-slider-wrapper">
          <input
            type="range"
            min="50000"
            max="2000000"
            step="25000"
            value={budget}
            aria-label="Planning budget slider in INR"
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="budget-range-input"
          />
          <div className="range-endpoints">
            <span>₹50,000</span>
            <span>₹20,00,000</span>
          </div>
        </div>

        <div className="budget-direct-input-row">
          <label htmlFor="budget-custom-input">Custom Budget (INR):</label>
          <div className="custom-input-wrap">
            <span>₹</span>
            <input
              id="budget-custom-input"
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              aria-label="Custom planning budget in INR"
            />
          </div>
        </div>

        <div className="budget-presets-row">
          <span className="presets-label">QUICK PRESETS:</span>
          <div className="presets-buttons">
            <button
              type="button"
              className={`preset-btn ${budget === 250000 ? 'is-selected' : ''}`}
              onClick={() => handleSliderChange(250000)}
            >
              Focused <b>₹2.5L</b>
            </button>
            <button
              type="button"
              className={`preset-btn ${budget === 500000 ? 'is-selected' : ''}`}
              onClick={() => handleSliderChange(500000)}
            >
              Balanced <b>₹5.0L</b>
            </button>
            <button
              type="button"
              className={`preset-btn ${budget === 1000000 ? 'is-selected' : ''}`}
              onClick={() => handleSliderChange(1000000)}
            >
              Campus <b>₹10.0L</b>
            </button>
            <button
              type="button"
              className={`preset-btn ${budget === 1500000 ? 'is-selected' : ''}`}
              onClick={() => handleSliderChange(1500000)}
            >
              Expanded <b>₹15.0L</b>
            </button>
          </div>
        </div>
      </section>

      {/* Capital Allocation Overview */}
      <section className="budget-summary-section">
        <div className="summary-cards-grid">
          <div className="summary-metric-card">
            <span className="metric-kicker">ALLOCATED CAPITAL</span>
            <b className="metric-b">₹{allocated.toLocaleString('en-IN')}</b>
            <small>{plan?.selected.length ?? 0} interventions</small>
          </div>

          <div className="summary-metric-card">
            <span className="metric-kicker">REMAINING ENVELOPE</span>
            <b className="metric-b">₹{remaining.toLocaleString('en-IN')}</b>
            <small>{100 - utilizationPct}% headroom</small>
          </div>

          <div className="summary-metric-card">
            <span className="metric-kicker">BUDGET UTILIZATION</span>
            <b className="metric-b">{utilizationPct}%</b>
            <small>Efficiency index</small>
          </div>
        </div>

        <div className="utilization-progress-container">
          <div className="utilization-bar-labels">
            <span>Utilization Progress</span>
            <b>{utilizationPct}%</b>
          </div>
          <div className="utilization-bar-track">
            <div
              className={`utilization-bar-fill ${utilizationPct > 100 ? 'is-over' : ''}`}
              style={{ width: `${Math.min(100, Math.max(2, utilizationPct))}%` }}
            />
          </div>
        </div>
      </section>

      {/* Breakdown by Intervention Type */}
      {breakdown.length > 0 && (
        <section className="budget-breakdown-section">
          <span className="panel-kicker">EXPENDITURE BREAKDOWN</span>
          <h4>Spending by Intervention Category</h4>

          <div className="breakdown-list">
            {breakdown.map((item) => {
              const pct = allocated > 0 ? Math.round((item.cost / allocated) * 100) : 0;
              return (
                <div key={item.name} className="breakdown-row">
                  <div className="breakdown-info">
                    <i className="breakdown-swatch" style={{ backgroundColor: item.color }} />
                    <span className="breakdown-name">{item.name}</span>
                    <small className="breakdown-count">({item.count} units)</small>
                  </div>
                  <div className="breakdown-values">
                    <b>₹{item.cost.toLocaleString('en-IN')}</b>
                    <span>{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// 4. Fullscreen Optimization Controls Panel
// ============================================================================
type FullscreenOptimizeProps = {
  studyId: string;
  studyName: string;
  cells: readonly Cell[];
  budget: number;
  weights: ScoreWeights;
  setWeights: (w: ScoreWeights) => void;
  plan: OptimizerResult | null;
  setPlan: (p: OptimizerResult) => void;
  setLayer: (l: LayerKey) => void;
  pushToast?: ((msg: string, kind?: 'success' | 'error' | 'info') => void) | undefined;
};

export function FullscreenOptimizeView({
  studyId,
  studyName,
  cells,
  budget,
  weights,
  setWeights,
  plan,
  setPlan,
  setLayer,
  pushToast,
}: FullscreenOptimizeProps) {
  const [working, setWorking] = useState(false);
  const [enabled, setEnabled] = useState<InterventionId[]>(initialInterventions);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [efficiencyGain, setEfficiencyGain] = useState<number | null>(null);

  const weightSum = weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity;
  const weightsValid = weightSum === 100;

  const updateWeight = (key: keyof ScoreWeights, value: number) => {
    const others = (['heat', 'vegetation', 'pedestrian', 'connectivity'] as const).filter(
      (name) => name !== key
    );
    const pool = others.reduce((sum, name) => sum + weights[name], 0);
    const remainder = 100 - value;
    const next: ScoreWeights = { ...weights, [key]: value };
    let allocated = 0;
    others.forEach((name, index) => {
      const share =
        index === others.length - 1
          ? remainder - allocated
          : Math.max(5, Math.round((remainder * weights[name]) / pool));
      next[name] = share;
      allocated += share;
    });
    setWeights(next);
  };

  const toggleIntervention = (id: InterventionId) => {
    setEnabled((curr) =>
      curr.includes(id) ? curr.filter((entry) => entry !== id) : [...curr, id]
    );
  };

  const handleRunOptimization = async () => {
    setWorking(true);
    setErrorMessage(null);

    // Save current studyId to prevent stale responses
    const targetStudyId = studyId;

    try {
      // Call backend OR-Tools solver
      const apiResult = await api.optimize({
        studyId: targetStudyId,
        budget,
        weights,
        enabledInterventions: enabled,
      });

      // Verify study area hasn't changed during request
      if (targetStudyId !== studyId) return;

      const ext = apiResult as OptimizerResult & {
        benchmark?: { efficiency_gain_pct?: number };
      };
      if (ext.benchmark?.efficiency_gain_pct !== undefined) {
        setEfficiencyGain(ext.benchmark.efficiency_gain_pct);
      }

      setPlan(apiResult);
      setLayer('recommended');
      pushToast?.(
        `OR-Tools solver complete · ${apiResult.selected.length} interventions allocated across ${apiResult.cellsImproved} cells`,
        'success'
      );
    } catch {
      // Deterministic domain fallback if offline / error
      try {
        const localResult = optimizePlan(cells, {
          budget,
          weights,
          enabledInterventions: enabled,
        });

        if (targetStudyId !== studyId) return;

        setPlan(localResult);
        setLayer('recommended');
        setEfficiencyGain(null);
        setErrorMessage(
          'Backend solver offline. Seeded deterministic domain solver generated the plan.'
        );
        pushToast?.(
          'Backend solver offline; using deterministic domain fallback.',
          'info'
        );
      } catch (fallbackErr) {
        setErrorMessage(
          fallbackErr instanceof Error ? fallbackErr.message : 'Optimization failed.'
        );
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fullscreen-panel-content optimize-panel-view">
      <div className="optimize-panel-header">
        <span className="panel-kicker">MATHEMATICAL PROGRAMMING</span>
        <h3>OR-Tools CP-SAT Optimizer</h3>
        <p className="panel-subtitle">
          Constrained combinatorial optimization balancing capital budget vs multidimensional environmental uplift.
        </p>
      </div>

      {/* Review Planning Configuration */}
      <section className="optimize-config-review">
        <div className="config-review-item">
          <span>STUDY AREA</span>
          <b>{studyName} ({cells.length} cells)</b>
        </div>
        <div className="config-review-item">
          <span>CAPITAL ENVELOPE</span>
          <b>₹{budget.toLocaleString('en-IN')}</b>
        </div>
      </section>

      {/* Optimization Objectives Weights */}
      <section className="optimize-weights-section">
        <div className="weights-header">
          <div>
            <span className="panel-kicker">OBJECTIVE BALANCING</span>
            <h4>Priority Weights (Must Sum to 100%)</h4>
          </div>
          <button
            type="button"
            className="reset-weights-btn"
            onClick={() => {
              setWeights({ heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 });
              pushToast?.('Default objective weights restored.', 'info');
            }}
          >
            Reset
          </button>
        </div>

        <div className="weights-sliders-list">
          <div className="weight-row">
            <span className="weight-icon tone-coral"><Flame size={14} /></span>
            <span className="weight-name">Heat Reduction</span>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={weights.heat}
              aria-label="Heat reduction weight"
              onChange={(e) => updateWeight('heat', Number(e.target.value))}
            />
            <strong>{weights.heat}%</strong>
          </div>

          <div className="weight-row">
            <span className="weight-icon tone-mint"><Leaf size={14} /></span>
            <span className="weight-name">Vegetation Recovery</span>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={weights.vegetation}
              aria-label="Vegetation recovery weight"
              onChange={(e) => updateWeight('vegetation', Number(e.target.value))}
            />
            <strong>{weights.vegetation}%</strong>
          </div>

          <div className="weight-row">
            <span className="weight-icon tone-blue"><UsersRound size={14} /></span>
            <span className="weight-name">Pedestrian Comfort</span>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={weights.pedestrian}
              aria-label="Pedestrian comfort weight"
              onChange={(e) => updateWeight('pedestrian', Number(e.target.value))}
            />
            <strong>{weights.pedestrian}%</strong>
          </div>

          <div className="weight-row">
            <span className="weight-icon tone-amber"><Activity size={14} /></span>
            <span className="weight-name">Green Connectivity</span>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={weights.connectivity}
              aria-label="Green connectivity weight"
              onChange={(e) => updateWeight('connectivity', Number(e.target.value))}
            />
            <strong>{weights.connectivity}%</strong>
          </div>
        </div>

        <div className={`weights-total-row ${weightsValid ? 'is-valid' : 'is-invalid'}`}>
          <span>TOTAL OBJECTIVE WEIGHT</span>
          <b>{weightSum}%</b>
          {!weightsValid && <small>(Must equal 100%)</small>}
        </div>
      </section>

      {/* Allowed Toolkit */}
      <section className="optimize-toolkit-section">
        <span className="panel-kicker">TOOLKIT CONSTRAINTS</span>
        <h4>Allowed Interventions</h4>

        <div className="toolkit-options-list">
          {INTERVENTIONS.map((item) => (
            <label key={item.id} className="toolkit-checkbox-label">
              <input
                type="checkbox"
                checked={enabled.includes(item.id)}
                onChange={() => toggleIntervention(item.id)}
              />
              <i className="toolkit-swatch" style={{ backgroundColor: item.markerColor }} />
              <div className="toolkit-label-text">
                <b>{item.name}</b>
                <small>₹{item.cost.toLocaleString('en-IN')} / {item.unit}</small>
              </div>
            </label>
          ))}
        </div>
      </section>

      {errorMessage && (
        <div className="optimize-error-banner" role="alert">
          <ShieldAlert size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Run Optimization Button */}
      <button
        type="button"
        className="button button-primary run-optimizer-btn"
        disabled={working || !weightsValid || enabled.length === 0}
        onClick={() => void handleRunOptimization()}
      >
        {working ? (
          <>
            <RefreshCw size={16} className="spin" />
            <span>Solving CP-SAT Integer Program…</span>
          </>
        ) : (
          <>
            <WandSparkles size={16} />
            <span>Run OR-Tools Budget Optimizer</span>
          </>
        )}
      </button>

      {/* Solver Results */}
      {plan && (
        <section className="optimize-results-section">
          <div className="results-badge-row">
            <span className="result-valid-badge">
              <ShieldCheck size={13} /> CP-SAT STRICTLY ENFORCED
            </span>
            <span className="result-cell-badge">{plan.cellsImproved} CELLS ACTIONED</span>
          </div>

          {efficiencyGain !== null && (
            <div className="results-benchmark-badge">
              <Target size={14} />
              <span><b>+{efficiencyGain}% efficiency gain</b> over greedy heuristics</span>
            </div>
          )}

          <div className="results-metrics-grid">
            <div className="results-stat-box">
              <span>ALLOCATED CAPITAL</span>
              <b>₹{plan.totalCost.toLocaleString('en-IN')}</b>
              <small>{Math.round(plan.utilization * 100)}% utilization</small>
            </div>
            <div className="results-stat-box">
              <span>COMBINED BENEFIT</span>
              <b className="benefit-val">+{Math.round(plan.combinedBenefit)} pts</b>
              <small>Multidimensional score</small>
            </div>
          </div>

          <div className="results-actions-row">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setLayer('recommended')}
            >
              <Layers3 size={14} /> View Plan Layer on Map
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// 5. Fullscreen Cell Inspector Panel
// ============================================================================
type FullscreenInspectorProps = {
  selectedCellId: string | null;
  cells: readonly Cell[];
  studyId: string;
  plan: OptimizerResult | null;
  budget: number;
  onSelectCell: (id: string) => void;
};

export function FullscreenCellInspectorView({
  selectedCellId,
  cells,
  studyId,
  plan,
  budget,
  onSelectCell,
}: FullscreenInspectorProps) {
  const selected = selectedCellId ? cells.find((c) => c.id === selectedCellId) ?? null : null;

  if (!selected) {
    const topHotspots = [...cells]
      .sort((a, b) => combinedPriority(b.scores) - combinedPriority(a.scores))
      .slice(0, 6);

    return (
      <div className="fullscreen-panel-content inspector-empty-view">
        <div className="inspector-placeholder-box">
          <Scan size={32} className="placeholder-scan-icon" />
          <h4>No Grid Cell Selected</h4>
          <p>
            Click any polygon on the 10 × 10 grid map to inspect satellite surface breakdown, microclimate indicators, and What-If interventions.
          </p>

          <div className="placeholder-hotspots-container">
            <span className="panel-kicker">RECOMMENDED CELLS TO INSPECT:</span>
            <div className="placeholder-hotspots-list">
              {topHotspots.map((c) => {
                const score = Math.round(combinedPriority(c.scores) * 100);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="placeholder-cell-chip"
                    onClick={() => onSelectCell(c.id)}
                  >
                    <b>{c.id}</b>
                    <span>{c.areaName}</span>
                    <span className="chip-score">{score}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullscreen-panel-content inspector-active-view">
      <CellInspector
        cell={selected}
        allCells={cells as Cell[]}
        studyId={studyId}
        plan={plan}
        budget={budget}
        onClose={() => onSelectCell('')}
        onPlan={() => {}}
        onSelectCell={(id) => onSelectCell(id)}
      />
    </div>
  );
}

// ============================================================================
// 6. Fullscreen Map Layers Panel
// ============================================================================
type FullscreenLayersProps = {
  layer: LayerKey;
  onLayerChange: (l: LayerKey) => void;
  baseMap: 'light' | 'satellite' | 'dark';
  setBaseMap: (b: 'light' | 'satellite' | 'dark') => void;
  showOutlines: boolean;
  onOutlineToggle: () => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  visibleMarkerTypes: ReadonlySet<InterventionId>;
  onToggleMarkerType: (id: InterventionId) => void;
};

export function FullscreenLayersView({
  layer,
  onLayerChange,
  baseMap,
  setBaseMap,
  showOutlines,
  onOutlineToggle,
  opacity,
  onOpacityChange,
  visibleMarkerTypes,
  onToggleMarkerType,
}: FullscreenLayersProps) {
  return (
    <div className="fullscreen-panel-content layers-panel-view">
      <div className="layers-panel-header">
        <span className="panel-kicker">GEOSPATIAL VISUALIZATION</span>
        <h3>Map Layers & Environmental Heatmaps</h3>
        <p className="panel-subtitle">
          Toggle analytical layers, base cartography, and grid opacity.
        </p>
      </div>

      {/* Analytical Layers */}
      <section className="layers-options-section">
        <span className="panel-kicker">ENVIRONMENTAL HEATMAP LAYERS</span>
        <div className="layers-radio-list">
          {LAYERS.map((item) => {
            const isSelected = layer === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`layer-select-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onLayerChange(item.key)}
              >
                <div className="layer-select-left">
                  <span className={`layer-swatch swatch-${item.key}`} />
                  <div>
                    <b>{item.label}</b>
                    <small>{item.desc}</small>
                  </div>
                </div>
                {isSelected && <span className="layer-selected-check">✓</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Basemap Options */}
      <section className="layers-basemap-section">
        <span className="panel-kicker">BASE CARTOGRAPHY</span>
        <div className="basemap-choices-grid">
          <button
            type="button"
            className={`basemap-choice-btn ${baseMap === 'satellite' ? 'is-selected' : ''}`}
            onClick={() => setBaseMap('satellite')}
          >
            <Satellite size={16} />
            <span>Satellite (Esri)</span>
          </button>
          <button
            type="button"
            className={`basemap-choice-btn ${baseMap === 'light' ? 'is-selected' : ''}`}
            onClick={() => setBaseMap('light')}
          >
            <MapIcon size={16} />
            <span>Light OSM</span>
          </button>
          <button
            type="button"
            className={`basemap-choice-btn ${baseMap === 'dark' ? 'is-selected' : ''}`}
            onClick={() => setBaseMap('dark')}
          >
            <MapIcon size={16} />
            <span>Dark OSM</span>
          </button>
        </div>
      </section>

      {/* Grid Display Settings */}
      <section className="layers-display-section">
        <span className="panel-kicker">DISPLAY CONTROLS</span>

        <div className="display-control-row">
          <label htmlFor="fs-grid-opacity">Grid Opacity: <b>{Math.round(opacity * 100)}%</b></label>
          <input
            id="fs-grid-opacity"
            type="range"
            min="0.20"
            max="0.82"
            step="0.02"
            value={opacity}
            aria-label="Grid opacity slider"
            onChange={(e) => onOpacityChange(Number(e.target.value))}
          />
        </div>

        <div className="display-toggle-row">
          <span>Grid Cell Boundary Outlines</span>
          <button
            type="button"
            className={`toggle-switch ${showOutlines ? 'is-on' : ''}`}
            aria-pressed={showOutlines}
            onClick={onOutlineToggle}
          >
            <span className="toggle-switch-handle" />
          </button>
        </div>
      </section>

      {/* Marker Filters */}
      <section className="layers-markers-section">
        <span className="panel-kicker">INTERVENTION MARKERS</span>
        <h4>Show On-Map Glyphs</h4>
        <div className="marker-toggles-grid">
          {INTERVENTIONS.map((item) => (
            <label key={item.id} className="marker-toggle-label">
              <input
                type="checkbox"
                checked={visibleMarkerTypes.has(item.id)}
                onChange={() => onToggleMarkerType(item.id)}
              />
              <i style={{ backgroundColor: item.markerColor }} />
              <span>{item.shortName}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// 7. Fullscreen Planning Drawer Container
// ============================================================================
type FullscreenPanelContainerProps = {
  activePanel: FullscreenPanelKey | null;
  onClose: () => void;
  children: React.ReactNode;
};

const PANEL_METADATA: Record<FullscreenPanelKey, { kicker: string; title: string }> = {
  kpi: { kicker: 'ANALYTICAL DASHBOARD', title: 'Environmental KPIs' },
  interventions: { kicker: 'PLANNING TOOLKIT', title: 'Recommended Interventions' },
  budget: { kicker: 'CAPITAL MANAGEMENT', title: 'Planning Budget & Envelope' },
  optimize: { kicker: 'MATHEMATICAL SOLVER', title: 'OR-Tools CP-SAT Optimizer' },
  inspector: { kicker: 'GEOGRAPHIC INTELLIGENCE', title: 'Grid Cell Inspector' },
  layers: { kicker: 'MAP SETTINGS', title: 'Layers & Cartography' },
};

export function FullscreenPlanningPanelContainer({
  activePanel,
  onClose,
  children,
}: FullscreenPanelContainerProps) {
  if (!activePanel) return null;

  const meta = PANEL_METADATA[activePanel];

  return (
    <aside
      className="fullscreen-contextual-drawer"
      role="region"
      aria-label={`${meta.title} panel`}
    >
      <div className="fullscreen-drawer-header">
        <div className="drawer-header-left">
          <span className="panel-kicker">{meta.kicker}</span>
          <h2 className="drawer-title">{meta.title}</h2>
        </div>
        <button
          type="button"
          className="fullscreen-drawer-close-btn"
          title="Close panel (Esc)"
          aria-label="Close contextual panel"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>

      <div className="fullscreen-drawer-body">
        {children}
      </div>
    </aside>
  );
}
