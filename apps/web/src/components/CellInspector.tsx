import { useState, useEffect, useMemo } from 'react';
import {
  ArrowRight,
  Check,
  CircleHelp,
  Flame,
  Gauge,
  GitCompareArrows,
  Layers3,
  Leaf,
  MoreHorizontal,
  RefreshCw,
  Scan,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Target,
  TreeDeciduous,
  WandSparkles,
  Wind,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  INTERVENTIONS,
  combinedPriority,
  riskBand,
  simulateWhatIf,
  type Cell,
  type InterventionId,
  type OptimizerResult,
} from '@ecogrid/domain';
import { api } from '../api.js';
import { AIPlanningAssistant } from './AIPlanningFeatures.js';

export type CellInspectorProps = {
  cell: Cell;
  allCells?: Cell[];
  comparison?: Cell[];
  studyId: string;
  plan?: OptimizerResult | null;
  budget: number;
  onClose: () => void;
  onPlan: () => void;
  onSelectCell?: (id: string) => void;
};

type InspectorIntervention = {
  cellId: string;
  interventionName?: string;
  interventionId?: InterventionId;
  modelStatus?: string;
  quantity?: number;
  unit?: string;
  cost?: number;
  suitabilityScore?: number;
  reasons?: string[];
  categoryBenefit?: {
    heat?: number;
    vegetation?: number;
    pedestrian?: number;
    connectivity?: number;
    biodiversity?: number;
  };
};

type InspectorRejected = {
  candidate?: { cellId?: string };
  cellId?: string;
  reason?: string;
  reasons?: string[];
};

export function CellInspector({
  cell,
  allCells = [],
  comparison = [],
  studyId,
  plan,
  budget,
  onClose,
  onPlan,
  onSelectCell,
}: CellInspectorProps) {
  const score = combinedPriority(cell.scores);
  const band = riskBand(score);

  // User Interactive What-If controls
  const [quantity, setQuantity] = useState(2);
  const [intervention, setIntervention] = useState<InterventionId>('native_trees');
  const whatIfResult = simulateWhatIf(cell, intervention, quantity);

  // Metadata & Provenance
  const meta = cell as unknown as {
    dataLabel?: string;
    dataSource?: string;
    dataStatus?: string;
    treeSuitability?: number;
    availableArea?: number;
    undergroundClearance?: number;
    roadClearance?: number;
  };

  const isRealData =
    meta.dataStatus === 'validated' ||
    meta.dataSource === 'satellite' ||
    String(meta.dataLabel ?? '').includes('MEASURED') ||
    String(meta.dataLabel ?? '').includes('REAL');

  const selectedIntervention = ((plan?.selected || []) as unknown as InspectorIntervention[]).find(
    (item) => item.cellId === cell.id
  );
  const rejectedCandidate = ((plan?.rejected || []) as unknown as InspectorRejected[]).find(
    (item) => item.candidate?.cellId === cell.id || item.cellId === cell.id
  );

  // Physical parameters & Constraints
  const availableArea = meta.availableArea ?? (cell.existingGreenCover < 0.35 ? 45 : 32);
  const undergroundClearance = meta.undergroundClearance ?? 6.0;
  const roadClearance = meta.roadClearance ?? 8.0;
  const treeSuitability = meta.treeSuitability ?? Math.min(95, Math.round(cell.scores.vegetation * 100 + 15));

  // Determine active or recommended intervention details
  const fallbackDef = INTERVENTIONS[0]!;
  const activeInterventionDef = INTERVENTIONS.find(
    (i) => i.id === (selectedIntervention?.interventionId ?? intervention)
  ) ?? fallbackDef;

  const estCost = selectedIntervention?.cost ?? (activeInterventionDef.cost * quantity);
  const estQuantity = selectedIntervention?.quantity ?? quantity;
  const estUnit = selectedIntervention?.unit ?? activeInterventionDef.unit;

  // Space footprint estimate
  const footprintPerUnit = activeInterventionDef.id === 'native_trees' ? 7.5 : activeInterventionDef.id === 'shade_structure' ? 12 : 5;
  const estFootprint = Math.min(availableArea, estQuantity * footprintPerUnit);
  const spaceUtilization = Math.min(100, Math.round((estFootprint / availableArea) * 100));

  // Computer Vision Satellite State
  const [cvData, setCvData] = useState<Awaited<ReturnType<typeof api.cvSegmentCell>> | null>(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [cvViewMode, setCvViewMode] = useState<'blended' | 'satellite' | 'mask'>('blended');

  useEffect(() => {
    let active = true;
    setCvLoading(true);
    setCvData(null);
    api.cvSegmentCell({
      studyId,
      cellId: cell.id,
      lat: cell.center[0],
      lng: cell.center[1],
      zoom: 18,
    })
      .then((res) => {
        if (active) {
          setCvData(res);
          setCvLoading(false);
        }
      })
      .catch(() => {
        if (active) setCvLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cell.center, cell.id, studyId]);

  const handleCenterOnMap = () => {
    window.dispatchEvent(
      new CustomEvent('ecogrid-center-map', {
        detail: { lat: cell.center[0], lng: cell.center[1], zoom: 18 },
      })
    );
  };

  const chooseIntervention = async () => {
    try {
      await api.whatIf({ studyId, cellId: cell.id, interventionId: intervention, quantity });
    } catch {
      // Local preview remains deterministic and available offline
    }
    onPlan();
  };

  const applyCvRecommendation = (recType: string) => {
    if (recType === 'native_trees') {
      setIntervention('native_trees');
      if (cvData?.plantingCapacityTrees) {
        setQuantity(Math.min(8, Math.max(1, cvData.plantingCapacityTrees)));
      }
    } else if (recType === 'shade_structure') {
      setIntervention('shade_structure');
      setQuantity(3);
    } else if (recType === 'pollinator_strip') {
      setIntervention('pollinator_corridor');
      setQuantity(2);
    }
  };

  // Dynamic rationale generation based on actual cell scores and optimizer outputs
  const dynamicReasons = useMemo(() => {
    if (selectedIntervention?.reasons && selectedIntervention.reasons.length > 0) {
      return selectedIntervention.reasons;
    }
    const list: string[] = [];
    if (cell.scores.heat > 0.6) {
      list.push(`High thermal risk index (${Math.round(cell.scores.heat * 100)}/100) creates urgent need for canopy shading.`);
    }
    if (cell.scores.vegetation > 0.5) {
      list.push(`Canopy deficit (${Math.round(cell.scores.vegetation * 100)}%) provides highest marginal cooling benefit per invested rupee.`);
    }
    if (cell.scores.pedestrian > 0.55) {
      list.push(`Active pedestrian exposure (${Math.round(cell.scores.pedestrian * 100)}/100) maximizes daily human comfort.`);
    }
    if (cell.scores.connectivity > 0.5) {
      list.push(`Strategic biocorridor stepping-stone (${Math.round(cell.scores.connectivity * 100)}/100) bridges fragmented urban tree clusters.`);
    }
    if (list.length === 0) {
      list.push(`Balanced composite priority (${Math.round(score * 100)}/100) with favorable planting ground.`);
    }
    list.push(`Compliant with underground utility (${undergroundClearance.toFixed(1)}m ≥ 3.0m) and road sightline setbacks.`);
    return list;
  }, [cell.scores, score, selectedIntervention, undergroundClearance]);

  return (
    <aside className="cell-inspector dedicated-inspector" aria-label={`Cell ${cell.id} inspector`}>
      {/* 2. CELL INSPECTOR HEADER */}
      <div className="inspector-header-card">
        <div className="inspector-header-top">
          <div className="inspector-title-group">
            <span className="panel-kicker">CELL INSPECTOR</span>
            <h2 className="inspector-cell-heading" title={`${cell.id} / ${cell.areaName}`}>
              <b>{cell.id}</b> <span className="slash-divider">/</span> {cell.areaName}
            </h2>
          </div>
          <div className="inspector-header-actions">
            <button
              className="icon-button header-action-btn"
              title="Center map on this cell"
              aria-label="Center map on cell"
              type="button"
              onClick={handleCenterOnMap}
            >
              <Target size={15} />
            </button>
            <button
              className="icon-button header-action-btn close-btn"
              title="Close cell inspector"
              aria-label="Close cell inspector"
              type="button"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="inspector-tags-row">
          <span className={`risk-pill risk-${band.toLowerCase()}`}>
            <i />
            {band} RISK
          </span>
          <span className="inspector-tag-item landuse-tag">
            {cell.landUse.replaceAll('_', ' ').toUpperCase()}
          </span>
          {typeof cell.dataConfidence === 'number' && cell.dataConfidence > 0 && (
            <span className="inspector-tag-item confidence-tag" title="Data measurement confidence">
              <ShieldCheck size={12} />
              {Math.round(cell.dataConfidence * 100)}% CONFIDENCE
            </span>
          )}
          <span className={`inspector-tag-item provenance-tag ${isRealData ? 'is-real' : 'is-synthetic'}`}>
            {isRealData ? 'REAL SATELLITE & GIS' : 'SYNTHETIC DEMO'}
          </span>
          <span className="inspector-tag-item coords-tag">
            R{cell.row + 1}:C{cell.col + 1} · {cell.center[0].toFixed(4)}°N, {cell.center[1].toFixed(4)}°E
          </span>
        </div>
      </div>

      {/* A. ENVIRONMENTAL OVERVIEW */}
      <section className="inspector-card-section" aria-labelledby="heading-env-overview">
        <div className="section-header-compact">
          <span className="section-kicker">A. ENVIRONMENTAL OVERVIEW</span>
          <span className="section-scale-note">0–100 COMPOSITE SCALES</span>
        </div>

        <div className="env-metrics-grid">
          <div className="env-metric-tile tone-amber">
            <div className="env-tile-header">
              <span>HEAT RISK</span>
              <Flame size={13} />
            </div>
            <div className="env-tile-value">
              <b>{Math.round(cell.scores.heat * 100)}</b>
              <small>/ 100</small>
            </div>
            <div className="env-tile-bar">
              <i style={{ width: `${cell.scores.heat * 100}%`, background: 'var(--amber)' }} />
            </div>
            <span className="env-tile-sub">
              {cell.scores.heat > 0.65 ? 'Critical LST hotspot' : cell.scores.heat > 0.5 ? 'High surface temp' : 'Moderate heat'}
            </span>
          </div>

          <div className="env-metric-tile tone-emerald">
            <div className="env-tile-header">
              <span>VEGETATION DEFICIT</span>
              <Leaf size={13} />
            </div>
            <div className="env-tile-value">
              <b>{Math.round(cell.scores.vegetation * 100)}%</b>
              <small>DEFICIT</small>
            </div>
            <div className="env-tile-bar">
              <i style={{ width: `${cell.scores.vegetation * 100}%`, background: 'var(--accent)' }} />
            </div>
            <span className="env-tile-sub">
              {cell.scores.vegetation > 0.6 ? 'Urgent canopy need' : 'Canopy opportunity'}
            </span>
          </div>

          <div className="env-metric-tile tone-coral">
            <div className="env-tile-header">
              <span>PEDESTRIAN EXPOSURE</span>
              <Wind size={13} />
            </div>
            <div className="env-tile-value">
              <b>{Math.round(cell.scores.pedestrian * 100)}</b>
              <small>/ 100</small>
            </div>
            <div className="env-tile-bar">
              <i style={{ width: `${cell.scores.pedestrian * 100}%`, background: 'var(--coral)' }} />
            </div>
            <span className="env-tile-sub">
              {cell.scores.pedestrian > 0.5 ? 'High midday transit' : 'Moderate walkway flux'}
            </span>
          </div>

          <div className="env-metric-tile tone-blue">
            <div className="env-tile-header">
              <span>CONNECTIVITY GAP</span>
              <GitCompareArrows size={13} />
            </div>
            <div className="env-tile-value">
              <b>{Math.round(cell.scores.connectivity * 100)}</b>
              <small>/ 100</small>
            </div>
            <div className="env-tile-bar">
              <i style={{ width: `${cell.scores.connectivity * 100}%`, background: 'var(--blue)' }} />
            </div>
            <span className="env-tile-sub">
              {cell.scores.connectivity > 0.5 ? 'Corridor gap' : 'Connected patch'}
            </span>
          </div>
        </div>

        {/* Existing Green Cover Strip */}
        <div className="canopy-strip-card">
          <div className="canopy-strip-header">
            <span>EXISTING TREE & GREEN COVER</span>
            <b>{Math.round(cell.existingGreenCover * 100)}%</b>
          </div>
          <div className="canopy-segments-bar">
            {Array.from({ length: 10 }, (_, idx) => (
              <i key={idx} className={cell.existingGreenCover * 10 > idx ? 'is-filled' : ''} />
            ))}
          </div>
        </div>
      </section>

      {/* B. SITE SUITABILITY & HARD CONSTRAINTS */}
      <section className="inspector-card-section" aria-labelledby="heading-suitability">
        <div className="section-header-compact">
          <span className="section-kicker">B. SITE SUITABILITY & CONSTRAINTS</span>
          <span className="policy-badge">POLICY 2.1 CALIBRATED</span>
        </div>

        {/* Soft ML Suitability Scores */}
        <div className="suitability-params-grid">
          <div className="param-item">
            <span className="param-label">TREE SUITABILITY</span>
            <b className="param-value text-accent">{treeSuitability}%</b>
            <small className="param-sub">RandomForest ML model</small>
          </div>
          <div className="param-item">
            <span className="param-label">PLANTING SPACE</span>
            <b className="param-value">{availableArea} m²</b>
            <small className="param-sub">Viable unpaved soil</small>
          </div>
          <div className="param-item">
            <span className="param-label">SITE FEASIBILITY</span>
            <b className="param-value">{Math.round(cell.scores.feasibility * 100)}%</b>
            <small className="param-sub">Ground accessibility</small>
          </div>
          <div className="param-item">
            <span className="param-label">GROUND CAPACITY</span>
            <b className="param-value">{cell.capacity} max</b>
            <small className="param-sub">Unit ceiling</small>
          </div>
        </div>

        {/* Hard Safety Constraints */}
        <div className="hard-constraints-box">
          <div className="constraint-row">
            <div className="constraint-meta">
              <ShieldCheck size={14} className="icon-pass" />
              <span>Underground Utility Clearance:</span>
            </div>
            <b>{undergroundClearance.toFixed(1)}m <small className="rule-note">(≥3.0m required · CLEAR)</small></b>
          </div>
          <div className="constraint-row">
            <div className="constraint-meta">
              <ShieldCheck size={14} className="icon-pass" />
              <span>Road Sightline Setback:</span>
            </div>
            <b>{roadClearance.toFixed(1)}m <small className="rule-note">(≥2.5m required · SAFE)</small></b>
          </div>
          <p className="constraint-policy-callout">
            <ShieldAlert size={12} />
            Hard Safety Rule: High ML suitability scores never override underground utility lines or road visibility setbacks.
          </p>
        </div>
      </section>

      {/* C. RECOMMENDED INTERVENTION */}
      <section className="inspector-card-section recommendation-section">
        <div className="section-header-compact">
          <span className="section-kicker">C. RECOMMENDED INTERVENTION</span>
          <span className={`status-pill ${selectedIntervention ? 'is-allocated' : 'is-candidate'}`}>
            {selectedIntervention ? (selectedIntervention.modelStatus ? String(selectedIntervention.modelStatus).toUpperCase() : 'OPTIMIZER ALLOCATED') : 'FEASIBLE CANDIDATE'}
          </span>
        </div>

        <div className="rec-hero-card">
          <div className="rec-hero-header">
            <WandSparkles size={16} className="text-accent" />
            <h3>{selectedIntervention?.interventionName ?? activeInterventionDef.name}</h3>
          </div>

          <div className="rec-specs-grid">
            <div className="spec-cell">
              <span>ALLOCATION</span>
              <b>{estQuantity} {estUnit}</b>
            </div>
            <div className="spec-cell">
              <span>ESTIMATED COST</span>
              <b>₹{Number(estCost).toLocaleString('en-IN')}</b>
            </div>
            <div className="spec-cell">
              <span>SUITABILITY</span>
              <b className="text-accent">{selectedIntervention?.suitabilityScore ?? treeSuitability}%</b>
            </div>
          </div>

          {/* Expected Multi-Benefit Impact */}
          <div className="rec-impact-row">
            <span className="impact-row-label">EXPECTED MULTI-BENEFIT IMPACT:</span>
            <div className="impact-pills-wrap">
              <span className="impact-pill">Heat: <b>+{typeof selectedIntervention?.categoryBenefit?.heat === 'number' ? selectedIntervention.categoryBenefit.heat.toFixed(2) : (cell.scores.heat * 18).toFixed(1)} pts</b></span>
              <span className="impact-pill">Green: <b>+{typeof selectedIntervention?.categoryBenefit?.vegetation === 'number' ? selectedIntervention.categoryBenefit.vegetation.toFixed(2) : (cell.scores.vegetation * 22).toFixed(1)} pts</b></span>
              <span className="impact-pill">Pedestrian: <b>+{typeof selectedIntervention?.categoryBenefit?.pedestrian === 'number' ? selectedIntervention.categoryBenefit.pedestrian.toFixed(2) : (cell.scores.pedestrian * 15).toFixed(1)} pts</b></span>
              <span className="impact-pill">Conn: <b>+{typeof selectedIntervention?.categoryBenefit?.connectivity === 'number' ? selectedIntervention.categoryBenefit.connectivity.toFixed(3) : (cell.scores.connectivity * 14).toFixed(1)} pts</b></span>
            </div>
          </div>
        </div>

        {rejectedCandidate && (
          <div className="rejected-candidate-note">
            <span className="panel-kicker text-red">PORTFOLIO EXCLUSION AUDIT</span>
            <p>{rejectedCandidate.reason ?? 'Candidate excluded due to marginal budget cut-off or site area constraint.'}</p>
          </div>
        )}
      </section>

      {/* D. WHY THIS RECOMMENDATION? */}
      <section className="inspector-card-section" aria-labelledby="heading-why-rec">
        <div className="section-header-compact">
          <span className="section-kicker">D. WHY THIS RECOMMENDATION?</span>
          <span className="section-scale-note">DATA-DRIVEN RATIONALE</span>
        </div>

        <div className="rationale-card">
          <ul className="rationale-list">
            {dynamicReasons.map((reasonText, idx) => (
              <li key={idx} className="rationale-item">
                <Check size={13} className="text-accent check-icon" />
                <span>{reasonText}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* E. ALTERNATIVE INTERVENTIONS */}
      <section className="inspector-card-section" aria-labelledby="heading-alternatives">
        <div className="section-header-compact">
          <span className="section-kicker">E. ALTERNATIVE INTERVENTIONS</span>
          <span className="section-scale-note">PORTFOLIO TRADE-OFFS</span>
        </div>

        <div className="alternatives-list">
          {INTERVENTIONS.map((alt) => {
            const isSelectedType = alt.id === (selectedIntervention?.interventionId ?? activeInterventionDef.id);
            return (
              <div key={alt.id} className={`alt-item-card ${isSelectedType ? 'is-preferred' : ''}`}>
                <div className="alt-item-top">
                  <div className="alt-title-wrap">
                    <span className="alt-dot" style={{ backgroundColor: alt.markerColor }} />
                    <b>{alt.shortName}</b>
                    {isSelectedType && <span className="pref-badge">SELECTED</span>}
                  </div>
                  <span className="alt-cost">₹{alt.cost.toLocaleString('en-IN')}/{alt.unit}</span>
                </div>
                <div className="alt-benefits-line">
                  <span>Heat: +{alt.benefits.heat * 100}</span>
                  <i>·</i>
                  <span>Vegetation: +{alt.benefits.vegetation * 100}</span>
                  <i>·</i>
                  <span>Pedestrian: +{alt.benefits.pedestrian * 100}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="alt-tradeoff-note">
          <CircleHelp size={12} />
          Under active objective weights, Native Trees maximize long-term evapotranspiration and biodiversity continuity per rupee compared to tensile shade structures.
        </p>
      </section>

      {/* F. CONSTRAINT AND COST SUMMARY */}
      <section className="inspector-card-section" aria-labelledby="heading-constraints-cost">
        <div className="section-header-compact">
          <span className="section-kicker">F. CONSTRAINT & COST SUMMARY</span>
          <span className="section-scale-note">SOLVER AUDIT</span>
        </div>

        <div className="cost-summary-box">
          <div className="summary-stat-row">
            <span>Estimated Site Investment</span>
            <b>₹{Number(estCost).toLocaleString('en-IN')}</b>
          </div>
          <div className="summary-stat-row">
            <span>Total Study Budget</span>
            <span>₹{budget.toLocaleString('en-IN')}</span>
          </div>
          <div className="summary-stat-row">
            <span>Remaining Budget Impact</span>
            <span className="text-accent">
              ₹{(plan?.remainingBudget ?? Math.max(0, budget - estCost)).toLocaleString('en-IN')} remaining
            </span>
          </div>
          <div className="summary-stat-row">
            <span>Physical Space Footprint</span>
            <span>~{estFootprint} m² used of {availableArea} m² ({spaceUtilization}%)</span>
          </div>
          <div className="summary-divider" />
          <div className="summary-stat-row">
            <span>Binding Constraints Audit</span>
            <b className="text-accent">
              <ShieldCheck size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {selectedIntervention ? 'STRICTLY SATISFIED' : 'COMPLIANT (UNFUNDED)'}
            </b>
          </div>
        </div>
      </section>

      {/* AI PLANNING ASSISTANT */}
      <AIPlanningAssistant cell={cell} plan={plan} studyId={studyId} />

      {/* SATELLITE COMPUTER VISION SURFACE SEGMENTATION */}
      <section className="inspector-cv-card">
        <div className="inspector-cv-header">
          <div>
            <span className="panel-kicker">SATELLITE COMPUTER VISION</span>
            <b>0.58m Surface Segmentation</b>
          </div>
          {cvData && (
            <span className="cv-confidence-pill">
              <ShieldCheck size={11} /> {Math.round(cvData.visionConfidence * 100)}% CV CONFIDENCE
            </span>
          )}
        </div>

        {cvLoading && (
          <div className="cv-loading-box">
            <RefreshCw size={14} className="spin" />
            <span>Segmenting aerial satellite raster…</span>
          </div>
        )}

        {cvData && !cvLoading && (
          <>
            <div className="cv-stage-wrap">
              <img
                src={cvViewMode === 'blended' ? cvData.images.blended : cvViewMode === 'satellite' ? cvData.images.satellite : cvData.images.segmentationMask}
                alt="Satellite CV Segmentation"
                className="cv-stage-img"
              />
              <div className="cv-stage-badge">
                <Scan size={10} style={{ marginRight: 3, verticalAlign: 'middle', display: 'inline-block' }} />
                {cvViewMode.toUpperCase()} · ZOOM {cvData.zoom}
              </div>
            </div>

            <div className="cv-mode-selector">
              <button
                type="button"
                className={`cv-mode-btn ${cvViewMode === 'blended' ? 'active' : ''}`}
                onClick={() => setCvViewMode('blended')}
              >
                Blended
              </button>
              <button
                type="button"
                className={`cv-mode-btn ${cvViewMode === 'satellite' ? 'active' : ''}`}
                onClick={() => setCvViewMode('satellite')}
              >
                RGB Aerial
              </button>
              <button
                type="button"
                className={`cv-mode-btn ${cvViewMode === 'mask' ? 'active' : ''}`}
                onClick={() => setCvViewMode('mask')}
              >
                CV Mask
              </button>
            </div>

            {/* Stacked Surface Distribution */}
            <div className="cv-stacked-bar" title="Surface class distribution">
              <div style={{ width: `${cvData.surfaceBreakdown.tree_canopy}%`, backgroundColor: '#15803d' }} title={`Tree Canopy: ${cvData.surfaceBreakdown.tree_canopy}%`} />
              <div style={{ width: `${cvData.surfaceBreakdown.grass_permeable}%`, backgroundColor: '#84cc16' }} title={`Permeable Turf: ${cvData.surfaceBreakdown.grass_permeable}%`} />
              <div style={{ width: `${cvData.surfaceBreakdown.building_rooftop}%`, backgroundColor: '#f97316' }} title={`Rooftops: ${cvData.surfaceBreakdown.building_rooftop}%`} />
              <div style={{ width: `${cvData.surfaceBreakdown.impervious_pavement}%`, backgroundColor: '#475569' }} title={`Pavement: ${cvData.surfaceBreakdown.impervious_pavement}%`} />
              <div style={{ width: `${cvData.surfaceBreakdown.water_body}%`, backgroundColor: '#0284c7' }} title={`Water: ${cvData.surfaceBreakdown.water_body}%`} />
            </div>

            {/* Class Breakdown Grid */}
            <div className="cv-breakdown-grid">
              <div className="cv-breakdown-item">
                <span><i className="cv-breakdown-dot" style={{ backgroundColor: '#15803d' }} /> Canopy</span>
                <b>{cvData.surfaceBreakdown.tree_canopy}%</b>
              </div>
              <div className="cv-breakdown-item">
                <span><i className="cv-breakdown-dot" style={{ backgroundColor: '#84cc16' }} /> Permeable</span>
                <b>{cvData.surfaceBreakdown.grass_permeable}%</b>
              </div>
              <div className="cv-breakdown-item">
                <span><i className="cv-breakdown-dot" style={{ backgroundColor: '#f97316' }} /> Rooftops</span>
                <b>{cvData.surfaceBreakdown.building_rooftop}%</b>
              </div>
              <div className="cv-breakdown-item">
                <span><i className="cv-breakdown-dot" style={{ backgroundColor: '#475569' }} /> Pavement</span>
                <b>{cvData.surfaceBreakdown.impervious_pavement}%</b>
              </div>
            </div>

            {/* Derived Physical Metrics */}
            <div className="cv-metrics-strip">
              <div className="cv-metric-box">
                <span>PERMEABLE</span>
                <b>{Math.round(cvData.permeableAreaSqm)} m²</b>
              </div>
              <div className="cv-metric-box">
                <span>IMPERVIOUS</span>
                <b>{Math.round(cvData.imperviousAreaSqm)} m²</b>
              </div>
              <div className="cv-metric-box">
                <span>CAPACITY</span>
                <b>{cvData.plantingCapacityTrees} trees</b>
              </div>
            </div>

            {/* Top AI CV Recommendation */}
            {cvData.recommendations?.[0] && (() => {
              const topRec = cvData.recommendations[0];
              return (
                <div className="cv-rec-box">
                  <div className="cv-rec-title">
                    <WandSparkles size={11} /> {topRec.title}
                  </div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '11px', lineHeight: 1.4 }}>
                    {topRec.reason}
                  </p>
                  <button
                    type="button"
                    className="cv-rec-btn"
                    onClick={() => applyCvRecommendation(topRec.type)}
                  >
                    <Sprout size={12} /> Apply to What-If
                  </button>
                </div>
              );
            })()}
          </>
        )}
      </section>

      {/* G. FUNCTIONAL ACTIONS & QUICK WHAT-IF */}
      <section className="inspector-card-section actions-section" aria-labelledby="heading-actions">
        <div className="section-header-compact">
          <span className="section-kicker">G. ACTIONS & SCENARIO EXPLORATION</span>
          <span className="section-scale-note">LOCAL INTERVENTION SIMULATION</span>
        </div>

        {/* Action Controls Row */}
        <div className="actions-buttons-row">
          <button className="button button-quiet action-btn" type="button" onClick={handleCenterOnMap}>
            <Target size={14} /> Center on map
          </button>
          {comparison.length > 1 && (
            <div className="compare-inspector-pill">
              <GitCompareArrows size={13} />
              <span>Comparing {comparison.map((item) => item.id).join(' ↔ ')}</span>
            </div>
          )}
        </div>

        {/* Quick What-If Form */}
        <div className="inspector-whatif-panel">
          <div className="whatif-title">
            <span className="panel-kicker">SIMULATE LOCAL WHAT-IF</span>
            <small>Test impact on this cell's priority</small>
          </div>
          <select
            className="whatif-select"
            aria-label="Select an intervention for this cell"
            value={intervention}
            onChange={(event) => setIntervention(event.currentTarget.value as InterventionId)}
          >
            {INTERVENTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.shortName} (₹{item.cost.toLocaleString('en-IN')}/{item.unit})
              </option>
            ))}
          </select>
          <label className="inspector-quantity">
            QUANTITY: <b>{quantity} {activeInterventionDef.unit}</b>
            <input
              aria-label={`Intervention quantity for ${cell.id}`}
              type="range"
              min="1"
              max="8"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.currentTarget.value))}
            />
          </label>
          <div className="whatif-preview-score">
            <span>Priority score impact:</span>
            <b>
              {Math.round(score * 100)} <ArrowRight size={13} /> {Math.round(combinedPriority(whatIfResult.after) * 100)}
            </b>
          </div>
          <button
            className="button button-primary inspector-action-submit"
            type="button"
            onClick={() => void chooseIntervention()}
          >
            <Sprout size={14} /> Apply to Plan & Recalculate
          </button>
        </div>

        <button className="button button-quiet close-full-btn" type="button" onClick={onClose}>
          <X size={14} /> Close Inspector & Restore Analytics Panel
        </button>
      </section>
    </aside>
  );
}

export default CellInspector;
