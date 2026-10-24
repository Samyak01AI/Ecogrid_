import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileBarChart,
  Flame,
  Footprints,
  Globe2,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sprout,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  type Cell,
  type InterventionId,
  type OptimizerResult,
  type ScoreWeights,
  optimizePlan,
} from '@ecogrid/domain';
import { api } from '../api.js';
import { useEcoStore } from '../useEcoStore.js';
import type { StudySummary } from '../store-context.js';
import { AIScenarioExplainer } from './AIPlanningFeatures.js';
import GridMap from './GridMap.js';

const ALL_INTERVENTION_IDS: InterventionId[] = [
  'native_trees',
  'shade_structure',
  'pollinator_corridor',
  'green_buffer',
  'cool_surface',
];

interface ScenarioPreset {
  id: string;
  name: string;
  shortDesc: string;
  budgetMultiplier: number;
  weights: ScoreWeights;
  interventions: InterventionId[];
}

const PRESETS: ScenarioPreset[] = [
  {
    id: 'balanced',
    name: 'Balanced Resilience',
    shortDesc: 'Comprehensive portfolio balancing heat, vegetation, walkability, and links.',
    budgetMultiplier: 1.0,
    weights: { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 },
    interventions: ALL_INTERVENTION_IDS,
  },
  {
    id: 'conservative',
    name: 'Conservative Canopy',
    shortDesc: 'Lower-capital baseline focused on trees, shade gazebos, and pollinators.',
    budgetMultiplier: 0.62,
    weights: { heat: 25, vegetation: 40, pedestrian: 20, connectivity: 15 },
    interventions: ['native_trees', 'shade_structure', 'pollinator_corridor'],
  },
  {
    id: 'heat_shield',
    name: 'Maximum Heat Mitigation',
    shortDesc: 'Aggressive cooling with reflective roofs and high-density shade structures.',
    budgetMultiplier: 1.25,
    weights: { heat: 55, vegetation: 15, pedestrian: 20, connectivity: 10 },
    interventions: ALL_INTERVENTION_IDS,
  },
  {
    id: 'biodiversity',
    name: 'Green Corridor & Connectivity',
    shortDesc: 'Maximizes contiguous habitat corridors, green buffers, and pollinator strips.',
    budgetMultiplier: 1.0,
    weights: { heat: 15, vegetation: 35, pedestrian: 15, connectivity: 35 },
    interventions: ['native_trees', 'pollinator_corridor', 'green_buffer'],
  },
  {
    id: 'pedestrian',
    name: 'Pedestrian Active Mobility',
    shortDesc: 'Walkable transit corridors with sidewalk shade and street-edge buffering.',
    budgetMultiplier: 1.1,
    weights: { heat: 25, vegetation: 15, pedestrian: 45, connectivity: 15 },
    interventions: ALL_INTERVENTION_IDS,
  },
];

interface ScenarioLabPageProps {
  cells: Cell[];
  studyId: string;
  activeStudy?: (StudySummary & { dataLabel?: string }) | undefined;
  studies: (StudySummary & { dataLabel?: string })[];
  onSelectStudy: (studyId: string) => Promise<void>;
  onOptimize: () => Promise<void>;
}

export function ScenarioLabPage({
  cells,
  studyId,
  activeStudy,
  studies,
  onSelectStudy,
  onOptimize,
}: ScenarioLabPageProps) {
  const { budget, weights: globalWeights, setPlan, setLayer, pushToast, user } = useEcoStore();

  // Baseline A state
  const [leftBudget, setLeftBudget] = useState<number>(() => Math.round(budget * 0.62));
  const leftWeights: ScoreWeights = useMemo(() => ({ heat: 25, vegetation: 40, pedestrian: 20, connectivity: 15 }), []);
  const leftInterventions: InterventionId[] = useMemo(() => ['native_trees', 'shade_structure', 'pollinator_corridor'], []);

  // Proposal B state
  const [rightBudget, setRightBudget] = useState<number>(budget);
  const [rightPreset, setRightPreset] = useState<string>('balanced');
  const [rightWeights, setRightWeights] = useState<ScoreWeights>(globalWeights);
  const [rightInterventions, setRightInterventions] = useState<InterventionId[]>(ALL_INTERVENTION_IDS);

  // UI state
  const [priorityControlsOpen, setPriorityControlsOpen] = useState(false);
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const [inspectedCellId, setInspectedCellId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plans state
  const [baselinePlan, setBaselinePlan] = useState<OptimizerResult | null>(null);
  const [proposalPlan, setProposalPlan] = useState<OptimizerResult | null>(null);

  // Sync right budget with store when store budget changes
  useEffect(() => {
    setRightBudget(budget);
    setLeftBudget(Math.round(budget * 0.62));
  }, [budget]);

  // Execute solver for both plans
  const solveBothScenarios = useCallback(
    async (showToastNotice = false) => {
      setComparing(true);
      setError(null);
      try {
        const [leftRes, rightRes] = await Promise.all([
          api
            .optimize({
              studyId,
              budget: leftBudget,
              weights: leftWeights,
              enabledInterventions: leftInterventions,
            })
            .catch(() =>
              optimizePlan(cells, {
                budget: leftBudget,
                weights: leftWeights,
                enabledInterventions: leftInterventions,
              })
            ),
          api
            .optimize({
              studyId,
              budget: rightBudget,
              weights: rightWeights,
              enabledInterventions: rightInterventions,
            })
            .catch(() =>
              optimizePlan(cells, {
                budget: rightBudget,
                weights: rightWeights,
                enabledInterventions: rightInterventions,
              })
            ),
        ]);

        setBaselinePlan(leftRes);
        setProposalPlan(rightRes);

        if (showToastNotice) {
          const deltaCost = rightRes.totalCost - leftRes.totalCost;
          const deltaCells = rightRes.cellsImproved - leftRes.cellsImproved;
          pushToast(
            `Comparison updated · Proposal improves ${deltaCells >= 0 ? '+' : ''}${deltaCells} cells with ₹${Math.abs(deltaCost).toLocaleString('en-IN')} ${deltaCost >= 0 ? 'additional investment' : 'savings'}`,
            'success'
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Comparison calculation failed.';
        setError(msg);
        pushToast(msg, 'error');
      } finally {
        setComparing(false);
      }
    },
    [cells, leftBudget, leftInterventions, leftWeights, pushToast, rightBudget, rightInterventions, rightWeights, studyId]
  );

  // Run on initial load and study change
  useEffect(() => {
    void solveBothScenarios(false);
  }, [studyId, solveBothScenarios]);

  // Handle Preset Selection for Proposal B
  const applyProposalPreset = (presetId: string) => {
    setRightPreset(presetId);
    const found = PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setRightWeights(found.weights);
    setRightInterventions(found.interventions);
    setRightBudget(Math.round(budget * found.budgetMultiplier));
  };

  // Handle weight change for Proposal B
  const updateRightWeight = (key: keyof ScoreWeights, val: number) => {
    setRightPreset('custom');
    setRightWeights((prev) => {
      const next = { ...prev, [key]: val };
      return next;
    });
  };

  // Save Proposal
  const handleSaveProposal = async () => {
    if (!user || (user.role !== 'admin' && user.role !== 'planner')) {
      pushToast('Sign in with planner privileges to save persistent comparisons.', 'info');
      return;
    }
    setSaving(true);
    try {
      await api.createScenario({
        studyId,
        name: `Resilience Proposal ${new Date().toLocaleDateString()}`,
        description: `Budget ₹${rightBudget.toLocaleString('en-IN')} with ${rightPreset} priorities`,
        budget: rightBudget,
        weights: rightWeights,
        enabledInterventions: rightInterventions,
      });
      if (proposalPlan) setPlan(proposalPlan);
      pushToast('Proposal saved to study scenario history.', 'success');
    } catch {
      pushToast('Scenario could not be saved to backend database.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Apply proposal as active store plan
  const handleApplyAsActive = () => {
    if (proposalPlan) {
      setPlan(proposalPlan);
      setLayer('recommended');
      pushToast('Proposal B applied as the active municipal plan. Ready for reporting.', 'success');
    }
  };

  // Differences calculation
  const deltaCells = (proposalPlan?.cellsImproved ?? 0) - (baselinePlan?.cellsImproved ?? 0);
  const deltaCost = (proposalPlan?.totalCost ?? 0) - (baselinePlan?.totalCost ?? 0);
  const deltaBenefit = (proposalPlan?.combinedBenefit ?? 0) - (baselinePlan?.combinedBenefit ?? 0);
  const deltaRemaining = (proposalPlan?.remainingBudget ?? 0) - (baselinePlan?.remainingBudget ?? 0);

  const deltaHeat =
    (proposalPlan?.categoryBenefits?.heat ?? 0) - (baselinePlan?.categoryBenefits?.heat ?? 0);
  const deltaVeg =
    (proposalPlan?.categoryBenefits?.vegetation ?? 0) - (baselinePlan?.categoryBenefits?.vegetation ?? 0);
  const deltaPed =
    (proposalPlan?.categoryBenefits?.pedestrian ?? 0) - (baselinePlan?.categoryBenefits?.pedestrian ?? 0);
  const deltaConn =
    (proposalPlan?.categoryBenefits?.connectivity ?? 0) - (baselinePlan?.categoryBenefits?.connectivity ?? 0);

  // Inspected cell candidates
  const inspectedCell = useMemo(
    () => (inspectedCellId ? cells.find((c) => c.id === inspectedCellId) ?? null : null),
    [cells, inspectedCellId]
  );
  const baselineCandidate = useMemo(
    () => baselinePlan?.selected.find((c) => c.cellId === inspectedCellId) ?? null,
    [baselinePlan, inspectedCellId]
  );
  const proposalCandidate = useMemo(
    () => proposalPlan?.selected.find((c) => c.cellId === inspectedCellId) ?? null,
    [proposalPlan, inspectedCellId]
  );

  return (
    <div className="scenario-lab-viewport">
      {/* =========================================================================
          ROW 1: PAGE HEADER
          ========================================================================= */}
      <header className="scenario-lab-header">
        <div className="scenario-header-left">
          <div className="scenario-eyebrow">
            <span className="eyebrow-chip">SCENARIO LAB</span>
            <span className="data-provenance-badge">
              <ShieldCheck size={12} /> {activeStudy?.dataLabel || 'REAL SATELLITE & GIS'}
            </span>
          </div>
          <h1 className="scenario-title">Compare paths forward.</h1>
          <p className="scenario-subtitle">Change the weights. See where each investment takes you.</p>
          <div className="scenario-meta-line">
            <Globe2 size={13} />
            <b>{(activeStudy?.name ?? 'Study Area').toUpperCase()}</b>
            <span className="meta-sep">·</span>
            <span>
              {activeStudy?.columns ?? 10} × {activeStudy?.rows ?? 10} GRID ({cells.length} CELLS)
            </span>
            <span className="meta-sep">·</span>
            <span>
              {Math.abs(activeStudy?.origin[0] ?? 19.076).toFixed(2)}° N,{' '}
              {Math.abs(activeStudy?.origin[1] ?? 72.877).toFixed(2)}° E
            </span>
          </div>
        </div>

        <div className="scenario-header-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void solveBothScenarios(true)}
            disabled={comparing}
          >
            <RefreshCw size={14} className={comparing ? 'spin' : ''} />
            <span>{comparing ? 'Solving...' : 'Compare Scenarios'}</span>
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void onOptimize()}
          >
            <WandSparkles size={14} />
            <span>Optimize Plan</span>
          </button>
          <button
            type="button"
            className="button button-accent-solid"
            onClick={handleApplyAsActive}
            disabled={!proposalPlan}
            title="Promote Proposal B to be the active municipal action plan"
          >
            <CheckCircle2 size={14} />
            <span>Apply as Active</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          ROW 2: SCENARIO CONTROLS (Compact Horizontal Bar)
          ========================================================================= */}
      <section className="scenario-control-bar" aria-label="Scenario configuration controls">
        {/* Study Selector */}
        <div className="control-group study-selector-group">
          <label htmlFor="study-selector-btn">STUDY AREA</label>
          <div className="dropdown-wrapper">
            <button
              id="study-selector-btn"
              type="button"
              className="control-dropdown-btn"
              onClick={() => setStudyMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={studyMenuOpen}
            >
              <Globe2 size={14} className="control-icon" />
              <span className="dropdown-label">{activeStudy?.name ?? 'Select study area'}</span>
              <ChevronDown size={14} />
            </button>
            {studyMenuOpen && (
              <div className="control-popover-menu" role="listbox">
                {studies.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={s.id === studyId}
                    className={`menu-option ${s.id === studyId ? 'is-active' : ''}`}
                    onClick={() => {
                      setStudyMenuOpen(false);
                      void onSelectStudy(s.id);
                    }}
                  >
                    <b>{s.name}</b>
                    <small>
                      {s.cellCount ?? 100} cells · {s.origin[0].toFixed(2)}°N, {s.origin[1].toFixed(2)}°E
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Proposal Preset */}
        <div className="control-group preset-group">
          <label htmlFor="scenario-preset-select">PROPOSAL PRESET</label>
          <div className="select-wrapper">
            <select
              id="scenario-preset-select"
              className="control-select"
              value={rightPreset}
              onChange={(e) => applyProposalPreset(e.target.value)}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {rightPreset === 'custom' && <option value="custom">Custom Weights & Budget</option>}
            </select>
          </div>
        </div>

        {/* Proposal Budget Input */}
        <div className="control-group budget-group">
          <div className="budget-label-row">
            <label htmlFor="proposal-budget-input">PROPOSAL BUDGET</label>
            <span className="budget-quick-val">₹{rightBudget.toLocaleString('en-IN')}</span>
          </div>
          <div className="budget-input-row">
            <input
              id="proposal-budget-input"
              type="range"
              min="50000"
              max="2500000"
              step="25000"
              value={rightBudget}
              onChange={(e) => {
                setRightPreset('custom');
                setRightBudget(Number(e.target.value));
              }}
              className="control-slider"
            />
            <div className="budget-chips">
              {[250000, 500000, 1000000, 1650000].map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`chip ${rightBudget === b ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRightPreset('custom');
                    setRightBudget(b);
                  }}
                >
                  ₹{(b / 100000).toFixed(1)}L
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Priorities Expander */}
        <div className="control-group priorities-group">
          <label>OBJECTIVE PRIORITIES</label>
          <button
            type="button"
            className={`priorities-toggle-btn ${priorityControlsOpen ? 'is-open' : ''}`}
            onClick={() => setPriorityControlsOpen((open) => !open)}
            aria-expanded={priorityControlsOpen}
          >
            <Sliders size={14} />
            <span className="priorities-summary-text">
              H:{rightWeights.heat}% · V:{rightWeights.vegetation}% · P:{rightWeights.pedestrian}% · C:
              {rightWeights.connectivity}%
            </span>
            {priorityControlsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </section>

      {/* Expanded Priority Sliders Drawer */}
      {priorityControlsOpen && (
        <section className="priority-drawer" aria-label="Fine-tune objective weights">
          <div className="drawer-header">
            <div>
              <b>Objective Priority Weights for Proposal B</b>
              <small>Rebalance trade-offs between thermal mitigation, nature restoration, and pedestrian comfort.</small>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPriorityControlsOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="priority-slider-grid">
            <div className="slider-item">
              <div className="slider-label">
                <span>
                  <Flame size={13} color="#f3b44e" /> Heat Reduction
                </span>
                <b>{rightWeights.heat}%</b>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={rightWeights.heat}
                onChange={(e) => updateRightWeight('heat', Number(e.target.value))}
              />
            </div>
            <div className="slider-item">
              <div className="slider-label">
                <span>
                  <Sprout size={13} color="#4cc38a" /> Vegetation Recovery
                </span>
                <b>{rightWeights.vegetation}%</b>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={rightWeights.vegetation}
                onChange={(e) => updateRightWeight('vegetation', Number(e.target.value))}
              />
            </div>
            <div className="slider-item">
              <div className="slider-label">
                <span>
                  <Footprints size={13} color="#60a5fa" /> Pedestrian Comfort
                </span>
                <b>{rightWeights.pedestrian}%</b>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={rightWeights.pedestrian}
                onChange={(e) => updateRightWeight('pedestrian', Number(e.target.value))}
              />
            </div>
            <div className="slider-item">
              <div className="slider-label">
                <span>
                  <Network size={13} color="#a78bfa" /> Green Connectivity
                </span>
                <b>{rightWeights.connectivity}%</b>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={rightWeights.connectivity}
                onChange={(e) => updateRightWeight('connectivity', Number(e.target.value))}
              />
            </div>
          </div>
        </section>
      )}

      {/* Shared Legend Strip */}
      <section className="scenario-legend-strip" aria-label="Intervention legend">
        <span className="legend-strip-title">INTERVENTIONS:</span>
        <div className="legend-items">
          <span className="legend-chip">
            <i className="glyph">♧</i> Native tree (420₹)
          </span>
          <span className="legend-chip">
            <i className="glyph">☂</i> Modular shade (1,650₹)
          </span>
          <span className="legend-chip">
            <i className="glyph">✿</i> Pollinator strip (760₹)
          </span>
          <span className="legend-chip">
            <i className="glyph">❧</i> Green buffer (980₹)
          </span>
          <span className="legend-chip">
            <i className="glyph">☀</i> Cool surface (510₹)
          </span>
          <span className="legend-chip unallocated">
            <i className="glyph-box" /> Unallocated
          </span>
        </div>
        <div className="legend-sync-note">
          <Network size={12} />
          <span>Synchronized viewport panning & zoom enabled</span>
        </div>
      </section>

      {/* Error Notice */}
      {error && (
        <div className="scenario-error-banner" role="alert">
          <X size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void solveBothScenarios(true)}>
            Retry Solver
          </button>
        </div>
      )}

      {/* =========================================================================
          ROW 3: MAIN AREA — TWO EQUAL COMPARISON MAPS (Full Width 2-Column Grid)
          ========================================================================= */}
      <main className="scenario-maps-main-grid" aria-label="Equal dimension scenario comparison maps">
        {/* -------------------- LEFT PANEL: BASELINE A -------------------- */}
        <article className="scenario-map-column baseline-column">
          <div className="map-column-header">
            <div className="header-badges">
              <span className="scenario-type-badge baseline-badge">BASELINE A</span>
              <span className="scenario-subtitle-chip">Conservative Reference</span>
            </div>
            <div className="scenario-assumptions-row">
              <span className="assumption-pill">
                Budget: <b>₹{leftBudget.toLocaleString('en-IN')}</b>
              </span>
              <span className="assumption-pill">Trees · Shade · Pollinators</span>
            </div>
            <div className="header-stat-row">
              <div className="stat-box">
                <small>INVESTMENT DEPLOYED</small>
                <b>₹{(baselinePlan?.totalCost ?? 0).toLocaleString('en-IN')}</b>
              </div>
              <div className="stat-box">
                <small>PLAN BENEFIT</small>
                <b className="benefit-val">{(baselinePlan?.combinedBenefit ?? 0).toFixed(1)} pts</b>
              </div>
              <div className="stat-box">
                <small>CELLS ACTIONED</small>
                <b>
                  {baselinePlan?.cellsImproved ?? 0} <span className="denom">/ {cells.length}</span>
                </b>
              </div>
            </div>
          </div>

          <div className="scenario-large-map-shell">
            <Suspense fallback={<div className="map-loading-skeleton">Initializing Baseline A Map…</div>}>
              <GridMap
                cells={cells}
                selectedCell={inspectedCellId}
                selectedCells={inspectedCellId ? [inspectedCellId] : []}
                onSelectCell={(id) => setInspectedCellId(id)}
                onSelectCells={(ids) => setInspectedCellId(ids[0] ?? null)}
                layer="recommended"
                onLayerChange={() => undefined}
                plan={baselinePlan}
                connectivity={null}
                opacity={0.55}
                showOutlines={true}
                onOpacityChange={() => undefined}
                onOutlineToggle={() => undefined}
                compact={false}
                syncGroup="scenario-lab-sync"
              />
            </Suspense>
          </div>
        </article>

        {/* -------------------- RIGHT PANEL: PROPOSAL B -------------------- */}
        <article className="scenario-map-column proposal-column">
          <div className="map-column-header">
            <div className="header-badges">
              <span className="scenario-type-badge proposal-badge">PROPOSAL B</span>
              <span className="scenario-subtitle-chip proposal-rec-chip">RECOMMENDED PATH</span>
            </div>
            <div className="scenario-assumptions-row">
              <span className="assumption-pill">
                Budget: <b>₹{rightBudget.toLocaleString('en-IN')}</b>
              </span>
              <span className="assumption-pill">All Interventions · {PRESETS.find((p) => p.id === rightPreset)?.name ?? 'Custom'}</span>
            </div>
            <div className="header-stat-row">
              <div className="stat-box">
                <small>INVESTMENT DEPLOYED</small>
                <b className="highlight-cost">₹{(proposalPlan?.totalCost ?? 0).toLocaleString('en-IN')}</b>
              </div>
              <div className="stat-box">
                <small>PLAN BENEFIT</small>
                <b className="benefit-val highlight-benefit">
                  {(proposalPlan?.combinedBenefit ?? 0).toFixed(1)} pts
                </b>
              </div>
              <div className="stat-box">
                <small>CELLS ACTIONED</small>
                <b>
                  {proposalPlan?.cellsImproved ?? 0} <span className="denom">/ {cells.length}</span>
                </b>
              </div>
            </div>
          </div>

          <div className="scenario-large-map-shell">
            <Suspense fallback={<div className="map-loading-skeleton">Initializing Proposal B Map…</div>}>
              <GridMap
                cells={cells}
                selectedCell={inspectedCellId}
                selectedCells={inspectedCellId ? [inspectedCellId] : []}
                onSelectCell={(id) => setInspectedCellId(id)}
                onSelectCells={(ids) => setInspectedCellId(ids[0] ?? null)}
                layer="recommended"
                onLayerChange={() => undefined}
                plan={proposalPlan}
                connectivity={null}
                opacity={0.55}
                showOutlines={true}
                onOpacityChange={() => undefined}
                onOutlineToggle={() => undefined}
                compact={false}
                syncGroup="scenario-lab-sync"
              />
            </Suspense>
          </div>
        </article>
      </main>

      {/* =========================================================================
          INTERACTIVE CELL COMPARISON INSPECTOR (Dedicate Drawer / Banner)
          ========================================================================= */}
      {inspectedCell && (
        <section className="scenario-cell-inspector-card" aria-label="Cell comparison detail">
          <div className="cell-inspector-top">
            <div className="cell-id-badge">
              <span>CELL</span>
              <b>{inspectedCell.id}</b>
            </div>
            <div className="cell-meta">
              <h4>{inspectedCell.areaName}</h4>
              <p>
                {inspectedCell.center[0].toFixed(5)}° N, {inspectedCell.center[1].toFixed(5)}° E · Land Use:{' '}
                <b>{inspectedCell.landUse.replace('_', ' ')}</b> · Surface: <b>{inspectedCell.surfaceType}</b>
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setInspectedCellId(null)}
              aria-label="Close cell inspection"
            >
              <X size={16} />
            </button>
          </div>

          <div className="cell-comparison-split">
            <div className="split-side baseline-side">
              <div className="side-title">BASELINE A ALLOCATION</div>
              {baselineCandidate ? (
                <div className="candidate-card">
                  <div className="candidate-name">
                    <b>{baselineCandidate.interventionName}</b>
                    <span>₹{baselineCandidate.cost.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="candidate-qty">
                    Quantity: {baselineCandidate.quantity} {baselineCandidate.unit} · Combined Benefit:{' '}
                    {baselineCandidate.combinedBenefit.toFixed(2)}
                  </div>
                </div>
              ) : (
                <div className="no-allocation">No intervention allocated under baseline budget constraints.</div>
              )}
            </div>

            <div className="split-divider" />

            <div className="split-side proposal-side">
              <div className="side-title">PROPOSAL B ALLOCATION</div>
              {proposalCandidate ? (
                <div className="candidate-card is-proposal">
                  <div className="candidate-name">
                    <b>{proposalCandidate.interventionName}</b>
                    <span className="cost-tag">₹{proposalCandidate.cost.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="candidate-qty">
                    Quantity: {proposalCandidate.quantity} {proposalCandidate.unit} · Combined Benefit:{' '}
                    {proposalCandidate.combinedBenefit.toFixed(2)}
                  </div>
                </div>
              ) : (
                <div className="no-allocation">No intervention allocated under proposed scenario.</div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* =========================================================================
          ROW 4: FULL-WIDTH COMPARISON SUMMARY TABLE
          ========================================================================= */}
      <section className="scenario-comparison-table-section" aria-label="Scenario comparison summary">
        <div className="table-header-row">
          <div>
            <h3>Comprehensive Scenario Comparison</h3>
            <p>Direct accounting of physical metrics, capital allocations, and environmental co-benefits.</p>
          </div>
          <div className="summary-delta-pill">
            <ArrowUpRight size={16} />
            <span>
              Net Impact Delta: <b>{deltaBenefit >= 0 ? '+' : ''}{deltaBenefit.toFixed(1)} benefit points</b>
            </span>
          </div>
        </div>

        <div className="scenario-table-container">
          <table className="scenario-comparison-table">
            <thead>
              <tr>
                <th scope="col" className="col-measure">MEASURE / ENVIRONMENTAL IMPACT</th>
                <th scope="col" className="col-baseline">BASELINE A</th>
                <th scope="col" className="col-proposal">PROPOSAL B</th>
                <th scope="col" className="col-delta">NET DIFFERENCE (B − A)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="row-label">
                  <b>Cells Improved / Actioned</b>
                  <small>Analysis grid cells receiving physical climate interventions</small>
                </td>
                <td className="col-val">{baselinePlan?.cellsImproved ?? 0} cells</td>
                <td className="col-val bold-val">{proposalPlan?.cellsImproved ?? 0} cells</td>
                <td className={`col-delta ${deltaCells >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaCells >= 0 ? `+${deltaCells}` : `${deltaCells}`} cells
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <b>Total Capital Investment</b>
                  <small>Total cost deployed under municipal budget constraints</small>
                </td>
                <td className="col-val">₹{(baselinePlan?.totalCost ?? 0).toLocaleString('en-IN')}</td>
                <td className="col-val bold-val">₹{(proposalPlan?.totalCost ?? 0).toLocaleString('en-IN')}</td>
                <td className={`col-delta ${deltaCost <= 0 ? 'is-positive' : 'is-neutral'}`}>
                  {deltaCost >= 0 ? `+₹${deltaCost.toLocaleString('en-IN')}` : `-₹${Math.abs(deltaCost).toLocaleString('en-IN')}`}
                </td>
              </tr>
              <tr className="highlight-row">
                <td className="row-label">
                  <b>Plan Benefit Score</b>
                  <small>Composite weighted multi-criteria environmental objective score</small>
                </td>
                <td className="col-val">{(baselinePlan?.combinedBenefit ?? 0).toFixed(1)} pts</td>
                <td className="col-val bold-val">{(proposalPlan?.combinedBenefit ?? 0).toFixed(1)} pts</td>
                <td className={`col-delta ${deltaBenefit >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaBenefit >= 0 ? `+${deltaBenefit.toFixed(1)}` : `${deltaBenefit.toFixed(1)}`} pts
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <b>Budget Remaining</b>
                  <small>Unallocated capital envelope available for maintenance or phase 2</small>
                </td>
                <td className="col-val">₹{(baselinePlan?.remainingBudget ?? 0).toLocaleString('en-IN')}</td>
                <td className="col-val bold-val">₹{(proposalPlan?.remainingBudget ?? 0).toLocaleString('en-IN')}</td>
                <td className="col-delta">
                  {deltaRemaining >= 0 ? `+₹${deltaRemaining.toLocaleString('en-IN')}` : `-₹${Math.abs(deltaRemaining).toLocaleString('en-IN')}`}
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <span>
                    <Flame size={12} color="#f3b44e" /> <b>Heat Mitigation Benefit</b>
                  </span>
                  <small>Surface temperature moderation and microclimate cooling impact</small>
                </td>
                <td className="col-val">{(baselinePlan?.categoryBenefits?.heat ?? 0).toFixed(1)} pts</td>
                <td className="col-val bold-val">{(proposalPlan?.categoryBenefits?.heat ?? 0).toFixed(1)} pts</td>
                <td className={`col-delta ${deltaHeat >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaHeat >= 0 ? `+${deltaHeat.toFixed(1)}` : `${deltaHeat.toFixed(1)}`} pts
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <span>
                    <Sprout size={12} color="#4cc38a" /> <b>Vegetation / Greenery Benefit</b>
                  </span>
                  <small>NDVI canopy deficit recovery and urban biomass replenishment</small>
                </td>
                <td className="col-val">{(baselinePlan?.categoryBenefits?.vegetation ?? 0).toFixed(1)} pts</td>
                <td className="col-val bold-val">{(proposalPlan?.categoryBenefits?.vegetation ?? 0).toFixed(1)} pts</td>
                <td className={`col-delta ${deltaVeg >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaVeg >= 0 ? `+${deltaVeg.toFixed(1)}` : `${deltaVeg.toFixed(1)}`} pts
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <span>
                    <Footprints size={12} color="#60a5fa" /> <b>Pedestrian Comfort Benefit</b>
                  </span>
                  <small>Shading along high-density sidewalks and active transit corridors</small>
                </td>
                <td className="col-val">{(baselinePlan?.categoryBenefits?.pedestrian ?? 0).toFixed(1)} pts</td>
                <td className="col-val bold-val">{(proposalPlan?.categoryBenefits?.pedestrian ?? 0).toFixed(1)} pts</td>
                <td className={`col-delta ${deltaPed >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaPed >= 0 ? `+${deltaPed.toFixed(1)}` : `${deltaPed.toFixed(1)}`} pts
                </td>
              </tr>
              <tr>
                <td className="row-label">
                  <span>
                    <Network size={12} color="#a78bfa" /> <b>Connectivity & Biodiversity</b>
                  </span>
                  <small>Ecological corridor continuity and fragmentation reduction</small>
                </td>
                <td className="col-val">{(baselinePlan?.categoryBenefits?.connectivity ?? 0).toFixed(1)} pts</td>
                <td className="col-val bold-val">{(proposalPlan?.categoryBenefits?.connectivity ?? 0).toFixed(1)} pts</td>
                <td className={`col-delta ${deltaConn >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {deltaConn >= 0 ? `+${deltaConn.toFixed(1)}` : `${deltaConn.toFixed(1)}`} pts
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* =========================================================================
          ROW 5: AI SCENARIO EXPLANATION & ACTION FOOTER
          ========================================================================= */}
      <section className="scenario-bottom-actions-section">
        <AIScenarioExplainer
          studyId={studyId}
          baseline={
            baselinePlan
              ? { budget: leftBudget, weights: leftWeights, plan: baselinePlan }
              : { budget: leftBudget, weights: leftWeights }
          }
          proposal={
            proposalPlan
              ? { budget: rightBudget, weights: rightWeights, plan: proposalPlan }
              : { budget: rightBudget, weights: rightWeights }
          }
        />

        <div className="scenario-footer-bar">
          <div className="footer-left-info">
            <ShieldCheck size={16} color="#4CC38A" />
            <span>
              Both scenarios strictly verify boundary geometry, available envelope capacity, and legal easements.
            </span>
          </div>
          <div className="footer-right-buttons">
            <button
              type="button"
              className="button button-quiet"
              onClick={handleSaveProposal}
              disabled={saving}
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save Proposal'}</span>
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={handleApplyAsActive}
            >
              <CheckCircle2 size={14} />
              <span>Use Proposal as Active Plan</span>
            </button>
            <Link
              to="/reports"
              className="button button-accent-solid"
              onClick={() => {
                if (proposalPlan) setPlan(proposalPlan);
              }}
            >
              <FileBarChart size={14} />
              <span>Continue to Executive Report</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ScenarioLabPage;
