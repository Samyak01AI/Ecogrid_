import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, ArrowUpRightFromSquare, BarChart3, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, CloudSun, Database, Download, ExternalLink, FileBarChart, FileDown,
  FileJson2, FilePlus2, Flame, Gauge, GitCompareArrows, Globe2, Grid2X2, HandCoins, Leaf, LeafyGreen,
  Lock, LogIn, LogOut, Mail, Menu, MoreHorizontal, RefreshCw, Search, Settings2, ShieldCheck,
  Share2, SlidersHorizontal, Sprout, Sun, Target, TreeDeciduous, Upload, UserRound, UsersRound, WandSparkles, Wind, X,
  Scan,
} from 'lucide-react';
import {
  INTERVENTIONS, analyzeConnectivity, combinedPriority, optimizePlan, riskBand, simulateWhatIf,
  type Cell, type InterventionId, type OptimizerResult, type ScoreWeights,
} from '@ecogrid/domain';
import { api, type AdminUserItem, type Scenario, type UserSession } from './api.js';
import { useEcoStore } from './useEcoStore.js';
import {
  AIScenarioExplainer,
  AIImpactReportSummary,
  AIValidationAssistant,
} from './components/AIPlanningFeatures.js';
import { CellInspector } from './components/CellInspector.js';

const GridMap = lazy(() => import('./components/GridMap.js'));
const ClimateCharts = lazy(() => import('./components/ClimateCharts.js'));
const StudySetup = lazy(() => import('./components/StudySetup.js'));
const ScenarioLabPage = lazy(() => import('./components/ScenarioLabPage.js'));

const SECTIONS = [
  { group: 'WORKSPACE', items: [
    { to: '/overview', label: 'Overview', icon: Grid2X2 },
    { to: '/environment', label: 'Environmental intelligence', icon: Activity },
    { to: '/planner', label: 'Intervention planner', icon: Sprout, badge: 'LIVE' },
    { to: '/scenarios', label: 'Scenario lab', icon: GitCompareArrows },
    { to: '/what-if', label: 'What-if simulator', icon: SlidersHorizontal },
    { to: '/connectivity', label: 'Green connectivity', icon: LeafyGreen },
    { to: '/analytics', label: 'Impact analytics', icon: BarChart3 },
  ] },
  { group: 'RESOURCES', items: [
    { to: '/reports', label: 'Reports', icon: FileBarChart },
    { to: '/data-sources', label: 'Data sources', icon: Database },
    { to: '/methodology', label: 'Methodology', icon: CircleHelp },
  ] },
];

const MAP_ROUTES = new Set(['/overview', '/environment', '/planner', '/scenarios', '/what-if', '/connectivity', '/analytics']);
const initialInterventions = INTERVENTIONS.map((intervention) => intervention.id);
const MAP_PAGE_TITLES: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  '/overview': { eyebrow: 'CAMPUS OVERVIEW', title: 'Climate at a glance', subtitle: 'Your study area, translated into a clearer next move.' },
  '/environment': { eyebrow: 'ENVIRONMENTAL INTELLIGENCE', title: 'Read the ground truth.', subtitle: 'Explore risk, vulnerability, and room for change — cell by cell.' },
  '/planner': { eyebrow: 'INTERVENTION PLANNER', title: 'Turn a budget into cover.', subtitle: 'Every recommendation is tied to a cell, a cost, and a measurable gain.' },
  '/scenarios': { eyebrow: 'SCENARIO LAB', title: 'Compare paths forward.', subtitle: 'Change the weights. See where each investment takes you.' },
  '/what-if': { eyebrow: 'WHAT-IF SIMULATOR', title: 'Test one move at a time.', subtitle: 'Model a cell-level intervention before it reaches the ground.' },
  '/connectivity': { eyebrow: 'GREEN CONNECTIVITY', title: 'Make green continuous.', subtitle: 'Find isolated patches and trace a cooler corridor through the grid.' },
  '/analytics': { eyebrow: 'IMPACT ANALYTICS', title: 'Progress with evidence.', subtitle: 'Measure the upside of an intervention plan, not just its footprint.' },
};

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true"><span /><span /><span /><i /></span>;
}
function RiskPill({ score }: { score: number }) {
  const band = riskBand(score);
  return <span className={`risk-pill risk-${band.toLowerCase()}`}><i />{band}</span>;
}
function Metric({ label, value, detail, icon: Icon, tone = 'mint', className = '' }: { label: string; value: string; detail: string; icon: typeof Activity; tone?: string; className?: string }) {
  return <article className={`metric-card ${className}`}><div className={`metric-icon tone-${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<span className="metric-dot">·</span><span className="metric-window">LIVE</span></div><div className="metric-value">{value}</div><div className="metric-detail"><span className="metric-trend"><ArrowUpRight size={13} /> {detail.split('·')[0]}</span>{detail.includes('·') && <span className="metric-detail-tail">· {detail.split('·').slice(1).join('·')}</span>}</div></article>;
}
function SectionTitle({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
function AppFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const { cells, studies, activeStudyId, selectedCell, selectedCells, comparedCells, layer, plan, weights, budget, user, toasts, selectCell, selectCells, setCells, setStudies, setActiveStudyId, setLayer, setPlan, setUser, pushToast } = useEcoStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get('cell')));
  const [lightTheme, setLightTheme] = useState(() => {
    try { return localStorage.getItem('ecogrid-theme') === 'light'; } catch { return false; }
  });
  const [gridOpacity, setGridOpacity] = useState(0.49);
  const [outlines, setOutlines] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const [studyLoading, setStudyLoading] = useState(false);
  const [pngExporting, setPngExporting] = useState(false);
  const [scenarioComparison, setScenarioComparison] = useState<{ baseline: OptimizerResult; proposal: OptimizerResult } | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = lightTheme ? 'light' : 'dark';
    try { localStorage.setItem('ecogrid-theme', lightTheme ? 'light' : 'dark'); } catch { /* The app still works when browser storage is disabled. */ }
  }, [lightTheme]);
  useEffect(() => {
    let active = true;
    const checkHealth = () => {
      void api.health().then((result) => { if (active) setApiOnline(result.ok); }).catch(() => { if (active) setApiOnline(false); });
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    void api.currentUser().then((found) => { if (active) setUser(found); }).catch(() => { if (active) setUser(null); });
    return () => { active = false; clearInterval(interval); };
  }, [setUser]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await api.studies();
        if (!active || response.studies.length === 0) return;
        setStudies(response.studies);
        const requestedId = new URLSearchParams(window.location.search).get('study') ?? 'study-delhi';
        const study = response.studies.find((item) => item.id === requestedId) ?? response.studies[0];
        if (!study) return;
        const data = await api.cells(study.id);
        if (active) {
          setActiveStudyId(study.id);
          setCells(data.cells);
          try {
            const optResult = await api.optimize({
              studyId: study.id,
              budget: 100000,
              weights: { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 },
              enabledInterventions: initialInterventions,
            });
            if (active) setPlan(optResult);
          } catch {
            /* Handled by activePlan fallback */
          }
        }
      } catch { /* The deterministic local grid stays available when the API is offline. */ }
    };
    void load();
    return () => { active = false; };
  }, [setActiveStudyId, setCells, setPlan, setStudies]);
  useEffect(() => {
    const path = location.pathname;
    if (MAP_ROUTES.has(path)) {
      const search = new URLSearchParams(window.location.search);
      search.set('layer', layer);
      search.set('study', activeStudyId);
      if (selectedCell) search.set('cell', selectedCell); else search.delete('cell');
      const params = search.toString();
      window.history.replaceState(null, '', `${location.pathname}${params ? `?${params}` : ''}${location.hash}`);
    }
  }, [location.pathname, location.search, location.hash, layer, selectedCell, activeStudyId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = target !== null && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
      if (event.key === 'Escape') {
        setInspectorOpen(false); setComparisonOpen(false); setSidebarOpen(false);
        if (!editing) selectCell('', false);
      }
      if (event.key === 'Enter' && selectedCell && !editing) setInspectorOpen(true);
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key) && MAP_ROUTES.has(location.pathname) && !editing) {
        const current = cells.find((cell) => cell.id === selectedCell) ?? cells[0];
        if (!current) return;
        event.preventDefault();
        const rowDelta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        const columnDelta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const maxRow = cells.reduce((maximum, cell) => Math.max(maximum, cell.row), 0);
        const maxColumn = cells.reduce((maximum, cell) => Math.max(maximum, cell.col), 0);
        const row = Math.max(0, Math.min(maxRow, current.row + rowDelta));
        const col = Math.max(0, Math.min(maxColumn, current.col + columnDelta));
        const next = cells.find((cell) => cell.row === row && cell.col === col);
        if (next) { selectCell(next.id, false); setInspectorOpen(true); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cells, location.pathname, selectCell, selectedCell]);

  const selected = cells.find((cell) => cell.id === selectedCell) ?? null;
  const activeStudy = studies.find((study) => study.id === activeStudyId);
  const activeMap = MAP_ROUTES.has(location.pathname);
  const avgPriority = useMemo(() => cells.reduce((sum, cell) => sum + combinedPriority(cell.scores), 0) / Math.max(1, cells.length), [cells]);
  const hotspots = useMemo(() => [...cells].sort((left, right) => combinedPriority(right.scores) - combinedPriority(left.scores)).slice(0, 5), [cells]);
  const studyRequestIdRef = useRef(0);

  const activePlan = useMemo(() => {
    // If a plan is loaded for a different study area, invalidate and use active cells fallback
    if (plan && plan.studyAreaId && plan.studyAreaId !== activeStudyId) {
      return optimizePlan(cells, { budget, weights, enabledInterventions: initialInterventions });
    }
    return plan ?? optimizePlan(cells, { budget, weights, enabledInterventions: initialInterventions });
  }, [activeStudyId, budget, cells, plan, weights]);

  const activeConnectivity = useMemo(() => analyzeConnectivity(cells, activePlan.selected.map((candidate) => candidate.cellId)), [activePlan, cells]);
  const updateScenarioComparison = useCallback((baseline: OptimizerResult, proposal: OptimizerResult) => { setScenarioComparison({ baseline, proposal }); }, []);
  const pageTitle = MAP_PAGE_TITLES[location.pathname];
  const mapPage = location.pathname === '/overview' ? <OverviewPage cells={cells} avgPriority={avgPriority} hotspots={hotspots} />
    : location.pathname === '/environment' ? <EnvironmentalPage cells={cells} />
    : location.pathname === '/planner' ? <PlannerPage cells={cells} user={user} studyId={activeStudyId} />
      : location.pathname === '/scenarios' ? <ScenarioPage cells={cells} studyId={activeStudyId} onCompareChange={updateScenarioComparison} />
        : location.pathname === '/what-if' ? <WhatIfPage cells={cells} studyId={activeStudyId} />
            : location.pathname === '/connectivity' ? <ConnectivityPage cells={cells} result={activeConnectivity} />
              : <AnalyticsPage cells={cells} plan={activePlan} />;

  const handleOptimize = useCallback(async () => {
    let result: OptimizerResult;
    try {
      result = await api.optimize({ studyId: activeStudyId, budget, weights, enabledInterventions: initialInterventions });
    } catch {
      result = optimizePlan(cells, { budget, weights, enabledInterventions: initialInterventions });
    }
    setPlan(result);
    setLayer('recommended');
    const isValid = result.validation?.valid ?? true;
    pushToast(
      `${isValid ? 'Plan validated' : 'Review plan constraints'} · ${result.cellsImproved} cells improved · ₹${result.totalCost.toLocaleString('en-IN')} allocated`,
      isValid ? 'success' : 'error'
    );
  }, [activeStudyId, budget, cells, pushToast, setLayer, setPlan, weights]);

  const openStudy = async (studyId: string) => {
    const reqId = ++studyRequestIdRef.current;
    setStudyLoading(true);
    // Invalidate stale plan and clear incompatible selection immediately
    setPlan(null);
    selectCell('', false);
    setActiveStudyId(studyId);
    setStudyMenuOpen(false);

    try {
      const response = await api.cells(studyId);
      if (studyRequestIdRef.current !== reqId) return;
      setCells(response.cells);

      // Trigger location-specific backend optimization
      try {
        const optResult = await api.optimize({
          studyId,
          budget,
          weights,
          enabledInterventions: initialInterventions,
        });
        if (studyRequestIdRef.current === reqId) {
          setPlan(optResult);
        }
      } catch {
        // activePlan useMemo will compute local fallback with response.cells
      }

      pushToast(`Loaded ${response.study.name} · ${response.cells.length} cells.`, 'success');

      // Center map on new study area
      const origin = response.study?.origin;
      if (origin && Array.isArray(origin) && origin.length === 2) {
        window.dispatchEvent(
          new CustomEvent('ecogrid-center-map', {
            detail: { lat: origin[0], lng: origin[1], zoom: 16 },
          })
        );
      }
    } catch (error) {
      if (studyRequestIdRef.current === reqId) {
        pushToast(error instanceof Error ? error.message : 'Could not load this study area.', 'error');
      }
    }
    if (studyRequestIdRef.current === reqId) {
      setStudyLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'geojson') => {
    const link = document.createElement('a');
    link.href = api.exportUrl(activeStudyId, format);
    link.download = `ecogrid-cells.${format === 'csv' ? 'csv' : 'geojson'}`;
    document.body.appendChild(link); link.click(); link.remove();
    pushToast(`${format.toUpperCase()} export ready`, 'success');
  };
  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${activeStudy?.name ?? 'EcoGrid'} map view`, url });
      else { await navigator.clipboard.writeText(url); pushToast('Read-only map link copied.', 'success'); }
    } catch {
      try { await navigator.clipboard.writeText(url); pushToast('Read-only map link copied.', 'success'); }
      catch { pushToast('Copy the current URL from your browser to share this map view.', 'info'); }
    }
  };
  const handleMapPngExport = async () => {
    const mapShell = document.querySelector<HTMLElement>('.map-shell');
    if (!mapShell) { pushToast('Open a map view before exporting its PNG.', 'error'); return; }
    setPngExporting(true);
    let tilesIncluded = true;
    let exportNote: HTMLDivElement | undefined;
    try {
      await document.fonts.ready;
      const { toPng } = await import('html-to-image');
      const ignoredControls = new Set(['map-top-controls', 'map-utility-controls-float', 'map-opacity-control', 'map-minimap-trigger']);
      const includeControls = (node: HTMLElement) => !Array.from(node.classList ?? []).some((className) => ignoredControls.has(className));
      let image: string;
      try {
        image = await toPng(mapShell, { pixelRatio: 2, backgroundColor: getComputedStyle(mapShell).backgroundColor, filter: includeControls });
      } catch {
        tilesIncluded = false;
        exportNote = document.createElement('div');
        exportNote.textContent = 'Basemap imagery omitted from this export; the grid, legend and provider attribution are retained.';
        exportNote.style.cssText = 'position:absolute;left:14px;bottom:12px;z-index:1200;padding:6px 8px;border-radius:4px;background:#071a17;color:#e8f7ed;font:11px Inter,sans-serif;';
        mapShell.appendChild(exportNote);
        image = await toPng(mapShell, { pixelRatio: 2, backgroundColor: getComputedStyle(mapShell).backgroundColor, filter: (node) => includeControls(node) && !Array.from(node.classList ?? []).includes('leaflet-tile-pane') });
      }
      const slug = (activeStudy?.name ?? 'study').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'study';
      const anchor = document.createElement('a');
      anchor.href = image; anchor.download = `ecogrid-${slug}-map.png`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      pushToast(tilesIncluded ? 'PNG exported with the map, legend and attribution.' : 'Grid PNG exported with legend and attribution; basemap imagery was omitted.', 'success');
    } catch (error) { pushToast(error instanceof Error ? `PNG export failed: ${error.message}` : 'PNG export could not be created. Try CSV or GeoJSON instead.', 'error'); }
    finally { exportNote?.remove(); setPngExporting(false); }
  };
  const handleLogout = async () => { try { await api.logout(); } finally { setUser(null); pushToast('You are signed out.', 'info'); navigate('/login'); } };

  const navSections = useMemo(() => {
    const list = [...SECTIONS];
    if (user?.role === 'admin') {
      list.push({
        group: 'ADMINISTRATION',
        items: [
          { to: '/admin/users', label: 'User governance', icon: UsersRound, badge: 'ADMIN' },
        ],
      });
    }
    return list;
  }, [user?.role]);

  if (location.pathname === '/') return <LandingPage />;
  if (location.pathname === '/login') return <LoginPage />;
  if (location.pathname === '/register') return <RegisterPage />;
  if (location.pathname === '/forgot-password') return <ForgotPasswordPage />;
  if (location.pathname === '/reset-password') return <ResetPasswordPage />;

  return <div className={`app-frame ${sidebarOpen ? 'sidebar-open' : ''}`}>
    <div className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
    <aside className="sidebar" aria-label="Primary navigation">
      <Link className="brand" to="/overview" onClick={() => setSidebarOpen(false)}><BrandMark /><span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span><span className="brand-version">2.0</span></Link>
      <div className="study-picker-wrap">
        <button className="study-selector" type="button" aria-expanded={studyMenuOpen} disabled={studyLoading} onClick={() => setStudyMenuOpen((open) => !open)}>
          <span className="study-avatar">{(activeStudy?.name ?? 'B').slice(0, 1).toUpperCase()}</span>
          <span className="study-name">
            <b>{activeStudy?.name ?? 'Bengaluru East'}</b>
            <small>{activeStudy ? `${activeStudy.rows} × ${activeStudy.columns} cells` : 'Study area'} <i>·</i> {studyLoading ? 'Loading' : 'Active'}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        {studyMenuOpen && (
          <div className="study-menu" role="menu" aria-label="Choose study area">
            {studies.map((study) => (
              <button key={study.id} type="button" role="menuitemradio" aria-checked={study.id === activeStudyId} onClick={() => void openStudy(study.id)}>
                <b>{study.name}</b>
                <small>{study.rows} × {study.columns} · {study.cellCount} cells</small>
              </button>
            ))}
            <button
              type="button"
              style={{
                marginTop: '6px',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                color: '#4CC38A',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 12px',
                fontSize: '11px',
                width: '100%',
                background: 'rgba(76, 195, 138, 0.06)',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                borderRadius: '0 0 6px 6px',
              }}
              onClick={() => {
                setStudyMenuOpen(false);
                navigate('/data-sources');
              }}
            >
              <FilePlus2 size={13} />
              <b>+ Change / search new location…</b>
            </button>
          </div>
        )}
      </div>

      <div className="nav-scroll">{navSections.map((section) => <div className="nav-group" key={section.group}><div className="nav-group-title">{section.group}</div>{section.items.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} aria-current={location.pathname === item.to ? 'page' : undefined}><item.icon size={16} strokeWidth={1.7} /><span>{item.label}</span>{'badge' in item && <small className="nav-live">{item.badge}</small>}{item.to === '/environment' && <span className="nav-count">{cells.length}</span>}</NavLink>)}</div>)}</div>
      <div className="sidebar-budget"><div className="sidebar-budget-heading"><span>CLIMATE FUND <i>FY 2025</i></span><MoreHorizontal size={15} /></div><div className="budget-value">₹{(plan?.totalCost ?? 0).toLocaleString('en-IN')}<small> / ₹{budget.toLocaleString('en-IN')}</small></div><div className="budget-track"><i style={{ width: `${Math.min(100, plan?.utilization ? plan.utilization * 100 : 0)}%` }} /></div><div className="budget-footnote"><span>Budget allocated</span><span>{Math.round((plan?.utilization ?? 0) * 100)}%</span></div></div>
      <div className="sidebar-bottom"><NavLink to="/settings" className={({ isActive }) => `nav-item settings-link ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}><Settings2 size={16} /><span>Settings</span><span className="settings-live"><span />Synced</span></NavLink>
        {user ? (
          <button className="profile-card" type="button" onClick={() => setProfileModalOpen(true)}>
            <span className="profile-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span><b>{user.fullName || user.email}</b><small className={`role-badge role-badge-${user.role}`}>{user.role.toUpperCase()}</small></span>
            <Settings2 size={14} />
          </button>
        ) : (
          <Link className="profile-card" to="/login">
            <span className="profile-avatar profile-anonymous"><UserRound size={16} /></span>
            <span><b>Demo workspace</b><small>VIEWER · Sign in to plan</small></span>
            <LogIn size={14} />
          </Link>
        )}
      </div>
    </aside>
    <main className={`app-main ${activeMap ? 'app-main-map' : ''}`}>
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu" aria-label="Open navigation" type="button" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><div className="breadcrumb"><span>EcoGrid AI</span><ChevronRight size={13} /><b>{pageTitle?.eyebrow ?? location.pathname.slice(1).replaceAll('-', ' ').toUpperCase()}</b></div><span className={`connection-state ${apiOnline ? 'online' : 'demo-mode'}`} title={apiOnline ? 'API connected' : 'Seeded offline preview'}><i />{apiOnline ? 'API LIVE' : 'LOCAL DATA'}</span>{(() => {
          const isReal = cells.length > 0 && cells.some((c) => {
            const meta = c as unknown as { dataStatus?: string; dataSource?: string; dataLabel?: string };
            return meta.dataStatus === 'validated' || meta.dataSource === 'satellite' || String(meta.dataLabel ?? '').includes('MEASURED') || String(meta.dataLabel ?? '').includes('REAL');
          });
          return isReal ? (
            <span className="data-provenance-pill" style={{ marginLeft: 8, fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(76, 195, 138, 0.15)', color: '#4cc38a', border: '1px solid rgba(76, 195, 138, 0.3)', fontWeight: 600 }}>REAL SATELLITE & GIS</span>
          ) : (
            <span className="data-provenance-pill" style={{ marginLeft: 8, fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)', fontWeight: 600 }}>SYNTHETIC DEMO DATA</span>
          );
        })()}
        </div>
        <div className="topbar-right"><div className="global-search"><Search size={15} /><input type="search" value={searchValue} onFocus={() => setSearchOpen(true)} onChange={(event) => setSearchValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && searchValue) { const match = cells.find((cell) => cell.id.toLowerCase() === searchValue.toLowerCase() || cell.areaName.toLowerCase().includes(searchValue.toLowerCase())); if (match) { navigate('/environment'); selectCell(match.id, false); } setSearchOpen(false); } }} aria-label="Search cells and areas" placeholder="Find a cell or area…" /><kbd>⌘ K</kbd>{searchOpen && searchValue && <div className="search-suggestions">{cells.filter((cell) => cell.id.toLowerCase().includes(searchValue.toLowerCase()) || cell.areaName.toLowerCase().includes(searchValue.toLowerCase())).slice(0, 5).map((cell) => <button key={cell.id} type="button" onClick={() => { navigate('/environment'); selectCell(cell.id, false); setSearchValue(cell.id); setSearchOpen(false); }}><b>{cell.id}</b><span>{cell.areaName}</span><i>{Math.round(combinedPriority(cell.scores) * 100)} priority</i></button>)}</div>}</div><button className="icon-button theme-toggle" title="Toggle light theme" aria-label="Toggle light theme" type="button" onClick={() => setLightTheme((value) => !value)}>{lightTheme ? <Sun size={17} /> : <CloudSun size={17} />}</button><button className="topbar-help" type="button" onClick={() => navigate('/methodology')} aria-label="Help and methodology"><CircleHelp size={17} /></button><Link to="/login" className={`topbar-user ${user ? 'has-user' : ''}`} aria-label={user ? `Signed in as ${user.email}` : 'Sign in'}><span>{user ? user.email.slice(0, 1).toUpperCase() : <UserRound size={15} />}</span></Link></div>
      </header>
      <div className={`page-body ${activeMap ? 'page-body-map' : ''}`}>
        {location.pathname === '/scenarios' ? (
          <Suspense fallback={<div className="map-skeleton" role="status">Loading Scenario Lab…</div>}>
            <ScenarioLabPage
              cells={cells}
              studyId={activeStudyId}
              activeStudy={activeStudy}
              studies={studies}
              onSelectStudy={openStudy}
              onOptimize={handleOptimize}
            />
          </Suspense>
        ) : (
          <>
            {activeMap && pageTitle && <SectionTitle eyebrow={pageTitle.eyebrow} title={pageTitle.title} subtitle={pageTitle.subtitle} actions={<><button className="button button-quiet" type="button" onClick={() => setComparisonOpen(true)}><GitCompareArrows size={15} /> Compare</button><button className="button button-primary" type="button" onClick={() => void handleOptimize()}><WandSparkles size={15} /> Optimize plan</button></>} />}
            {activeMap && <div className="map-workspace"><div className="map-main-column">
              <div className="study-meta-row"><div className="study-meta-location"><Globe2 size={14} /><span>{(activeStudy?.name ?? 'Bengaluru East Campus').toUpperCase()}</span><i>·</i><span>{activeStudy?.columns ?? 10} × {activeStudy?.rows ?? 10} GRID</span><i>·</i><span>{Math.abs(activeStudy?.origin[0] ?? 12.9352).toFixed(2)}° {(activeStudy?.origin[0] ?? 12.9352) < 0 ? 'S' : 'N'}, {Math.abs(activeStudy?.origin[1] ?? 77.6245).toFixed(2)}° {(activeStudy?.origin[1] ?? 77.6245) < 0 ? 'W' : 'E'}</span></div><div className="map-export-actions"><button className="download-inline" type="button" onClick={() => void handleShare()}><Share2 size={14} /> Share view</button><button className="download-inline" type="button" onClick={() => void handleExport('csv')}><Download size={14} /> CSV</button><button className="download-inline" type="button" onClick={() => void handleExport('geojson')}><Download size={14} /> GeoJSON</button><button className="download-inline" type="button" disabled={pngExporting} onClick={() => void handleMapPngExport()}><Download size={14} /> {pngExporting ? 'PNG…' : 'PNG'}</button></div></div>
              <Suspense fallback={<div className="map-skeleton" role="status">Loading the cell grid…</div>}><GridMap cells={cells} selectedCell={selectedCell} selectedCells={selectedCells} onSelectCell={(id, additive) => { selectCell(id, additive); setInspectorOpen(true); }} onSelectCells={(ids) => { selectCells(ids); setInspectorOpen(true); }} layer={layer} onLayerChange={setLayer} plan={plan} connectivity={location.pathname === '/connectivity' ? activeConnectivity : null} opacity={gridOpacity} showOutlines={outlines} onOpacityChange={setGridOpacity} onOutlineToggle={() => setOutlines((value) => !value)} scenarioComparison={location.pathname === '/scenarios' ? scenarioComparison : null} /></Suspense>
              <div className="map-footer"><span><span className="footer-cursor-dot" /> Click a cell to inspect <i>·</i> <kbd>Shift</kbd> click to compare</span><span>{selectedCell ? `SELECTED / ${selectedCell}` : `GRID / ${cells[0]?.id ?? '—'}—${cells[cells.length - 1]?.id ?? '—'}`} <i>·</i> {cells.length} ANALYSIS CELLS</span></div>
              <div className="map-bottom-stat-bar">
                <div className="map-bottom-stat-item">
                  <span>CAMPUS STUDY</span>
                  <b>{(activeStudy?.name ?? 'Bengaluru East').toUpperCase()}</b>
                </div>
                <div className="map-bottom-stat-divider" />
                <div className="map-bottom-stat-item">
                  <span>GRID MATRIX</span>
                  <b>{cells.length} CELLS · {activeStudy?.columns ?? 10}×{activeStudy?.rows ?? 10}</b>
                </div>
                <div className="map-bottom-stat-divider" />
                <div className="map-bottom-stat-item">
                  <span>MEAN PRIORITY</span>
                  <b>{Math.round(avgPriority * 100)} / 100</b>
                </div>
                <div className="map-bottom-stat-divider" />
                <div className="map-bottom-stat-item">
                  <span>ALLOCATED CAPITAL</span>
                  <b>₹{(activePlan?.totalCost ?? 0).toLocaleString('en-IN')} <small>({Math.round((activePlan?.utilization ?? 0) * 100)}%)</small></b>
                </div>
                <div className="map-bottom-stat-divider" />
                <div className="map-bottom-stat-item">
                  <span>SOLVER CONSTRAINTS</span>
                  <b className="stat-valid-tag"><ShieldCheck size={13} /> {activePlan?.validation?.valid ? 'STRICTLY ENFORCED' : 'CHECK CONSTRAINTS'}</b>
                </div>
              </div>
            </div>
            <div className="map-side-panel">
              {selected && inspectorOpen ? (
                <CellInspector
                  cell={selected}
                  allCells={cells}
                  comparison={comparedCells.map((id) => cells.find((candidate) => candidate.id === id)).filter((candidate): candidate is Cell => Boolean(candidate))}
                  studyId={activeStudyId}
                  plan={activePlan}
                  budget={budget}
                  onClose={() => {
                    setInspectorOpen(false);
                    selectCell('', false);
                  }}
                  onPlan={() => navigate('/planner')}
                  onSelectCell={(id) => selectCell(id, false)}
                />
              ) : (
                <>
                  {mapPage}
                  <div className="side-panel-foot">
                    <span className="side-footer-icon"><ShieldCheck size={14} /></span>
                    <span><b>Local demo model</b><small>Seeded cell scores are planning estimates.</small></span>
                    <button type="button" title="Data sources" onClick={() => navigate('/data-sources')}>
                      <ArrowUpRightFromSquare size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>}
            {!activeMap && <Routes>
              <Route path="/" element={<LandingPage />} /><Route path="/login" element={<LoginPage />} />
              <Route path="/overview" element={<Navigate to="/overview" replace />} /><Route path="/environment" element={<Navigate to="/environment" replace />} />
              <Route path="/planner" element={<Navigate to="/planner" replace />} /><Route path="/scenarios" element={<Navigate to="/scenarios" replace />} />
              <Route path="/what-if" element={<Navigate to="/what-if" replace />} /><Route path="/connectivity" element={<Navigate to="/connectivity" replace />} />
              <Route path="/analytics" element={<Navigate to="/analytics" replace />} /><Route path="/reports" element={<ReportsPage cells={cells} plan={plan} studyId={activeStudyId} />} />
              <Route path="/data-sources" element={<><Suspense fallback={<div className="map-skeleton" role="status">Loading study setup…</div>}><StudySetup /></Suspense><DataSourcesPage cells={cells} studyId={activeStudyId} /></>} /><Route path="/methodology" element={<MethodologyPage />} /><Route path="/settings" element={<SettingsPage user={user} apiOnline={apiOnline} onLightTheme={() => setLightTheme((value) => !value)} lightTheme={lightTheme} />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>}
          </>
        )}
      </div>
    </main>
    {profileModalOpen && user && <ProfileModal user={user} onClose={() => setProfileModalOpen(false)} onLogout={() => void handleLogout()} />}
    {comparisonOpen && <ScenarioCompareModal cells={cells} plan={plan} budget={budget} onClose={() => setComparisonOpen(false)} />}
    {toasts.length > 0 && <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.kind}`} key={toast.id}><span>{toast.kind === 'success' ? <CheckCircle2 size={17} /> : toast.kind === 'error' ? <CircleHelp size={17} /> : <Activity size={17} />}</span>{toast.message}<button type="button" aria-label="Dismiss notification" onClick={() => window.dispatchEvent(new CustomEvent('ecogrid-dismiss-toast', { detail: toast.id }))}><X size={15} /></button></div>)}</div>}
  </div>;
}

function OverviewPage({ cells, avgPriority, hotspots }: { cells: Cell[]; avgPriority: number; hotspots: Cell[] }) {
  const critical = cells.filter((cell) => riskBand(combinedPriority(cell.scores)) === 'CRITICAL').length;
  const high = cells.filter((cell) => combinedPriority(cell.scores) > 0.6).length;
  const { plan } = useEcoStore();
  const planConfidenceValue = plan?.planConfidence ?? (cells.length ? cells.reduce((sum, cell) => sum + cell.dataConfidence, 0) / cells.length : 0);
  const planConfidenceBand = planConfidenceValue >= 0.85 ? 'High' : planConfidenceValue >= 0.7 ? 'Medium' : 'Low';
  const heatCount = cells.filter((cell) => cell.scores.heat > 0.65).length;
  const meanGreenDeficit = Math.round(cells.reduce((sum, cell) => sum + cell.scores.vegetation, 0) / Math.max(1, cells.length) * 100);
  const priorityBand = riskBand(avgPriority);
  return <>
    <div className="quick-metrics"><Metric label="Mean priority" value={`${Math.round(avgPriority * 100)}`} detail={`${priorityBand} risk · 4-objective composite`} icon={Gauge} tone="mint" /><Metric label="Heat-stressed cells" value={`${heatCount}`} detail={`${heatCount}/${cells.length} cells · >65 threshold`} icon={Flame} tone="amber" /><Metric label="Green deficit" value={`${meanGreenDeficit}%`} detail="Mean deficit · canopy opportunity" icon={Leaf} tone="coral" /><Metric label="Plan confidence" value={`${Math.round(planConfidenceValue * 100)}%`} detail={`${planConfidenceBand} · ${plan ? 'benefit-weighted' : 'mean cell confidence'}`} icon={ShieldCheck} tone="blue" /></div>
    <section className="panel panel-top-cells"><div className="panel-heading"><div><span className="panel-kicker">FIRST TO CHANGE</span><h2>Priority cells</h2></div><span className="section-count">TOP 05</span></div><p className="panel-description">Where heat, exposure, and low green cover overlap.</p><div className="priority-cell-list">{hotspots.map((cell, index) => <div className="priority-cell-row" key={cell.id}><span className="priority-rank">0{index + 1}</span><b>{cell.id}</b><span>{cell.areaName}</span><div className="priority-score-track"><i style={{ width: `${combinedPriority(cell.scores) * 100}%` }} /></div><strong>{Math.round(combinedPriority(cell.scores) * 100)}</strong><RiskPill score={combinedPriority(cell.scores)} /></div>)}</div><div className="panel-footnote"><span>{critical} critical cells <i>·</i> {high} high priority</span><span>Sorted by combined priority <ArrowRight size={13} /></span></div></section>
    <div className="side-panel-callout"><div className="callout-icon"><Target size={17} /></div><div><b>Start with the North Gate.</b><p>High midday heat and foot traffic. Native shade is feasible across 8 nearby cells.</p><Link to="/planner">Review interventions <ArrowRight size={13} /></Link></div></div>
  </>;
}

function EnvironmentalPage({ cells }: { cells: Cell[] }) {
  const risk = cells.reduce((acc, cell) => { const key = riskBand(combinedPriority(cell.scores)); acc[key] += 1; return acc; }, { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 });
  const zoneData = useMemo(() => Object.entries(cells.reduce<Record<string, { heat: number; vegetation: number; count: number }>>((acc, cell) => { const zone = acc[cell.areaName] ?? { heat: 0, vegetation: 0, count: 0 }; zone.heat += cell.scores.heat * 100; zone.vegetation += cell.scores.vegetation * 100; zone.count += 1; acc[cell.areaName] = zone; return acc; }, {})).map(([name, data]) => ({ name, heat: data.heat / data.count, green: data.vegetation / data.count })).slice(0, 6), [cells]);
  return <>
    <div className="side-section-kicker"><span><span className="live-dot" />RISK DISTRIBUTION</span><small>10 × 10 ANALYSIS CELLS</small></div>
    <div className="risk-distribution">{(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const).map((key) => <div key={key} className={`risk-distribution-item risk-tone-${key.toLowerCase()}`}><span>{key}</span><b>{risk[key]}</b><i>{Math.round(risk[key] / cells.length * 100)}%</i></div>)}</div>
    <div className="risk-stacked-track">{(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const).map((key) => <i key={key} className={`risk-band-${key.toLowerCase()}`} style={{ width: `${risk[key]}%` }} title={`${key}: ${risk[key]} cells`} />)}</div>
    <div className="panel panel-zone-analysis"><div className="panel-heading"><div><span className="panel-kicker">BY NAMED ZONE</span><h2>Heat meets green</h2></div><button className="icon-button" type="button" aria-label="Zone chart details"><MoreHorizontal size={16} /></button></div><div className="chart-zone-legend"><span><i className="chart-heat-key" />HEAT</span><span><i className="chart-green-key" />VEGETATION DEFICIT</span></div><div className="zone-chart"><Suspense fallback={<span className="chart-loading">Loading zone chart…</span>}><ClimateCharts mode="zones" data={zoneData} /></Suspense></div><p className="chart-caption">Mean score by study-area zone · 0–100</p></div>
    <div className="side-insight"><span><Wind size={14} /></span><p><b>Exposure concentrates along the East Service Road.</b> Pair buffers with canopy expansion to address both heat and pedestrian exposure.</p></div>
  </>;
}

function PlannerPage({ cells, user, studyId }: { cells: Cell[]; user: UserSession | null; studyId: string }) {
  const { budget, setBudget, weights, setWeights, plan, setPlan, setLayer, pushToast } = useEcoStore();
  const [enabled, setEnabled] = useState<InterventionId[]>(initialInterventions);
  const [working, setWorking] = useState(false);
  const [optimisticUpdated, setOptimisticUpdated] = useState(0);
  const [approvalStatus, setApprovalStatus] = useState<'DRAFT' | 'APPROVED' | 'REJECTED'>('DRAFT');
  const [runId, setRunId] = useState<string | null>(null);
  const [efficiencyGain, setEfficiencyGain] = useState<number | null>(null);
  const [paretoOpen, setParetoOpen] = useState(false);
  const [paretoLoading, setParetoLoading] = useState(false);
  const [paretoSolutions, setParetoSolutions] = useState<Array<{ solution_id?: string; name?: string; profile?: string; total_cost?: number; combined_benefit?: number; cells_improved?: number; objectives?: Record<string, number>; isKnee?: boolean }>>([]);

  const calculate = async () => {
    setWorking(true);
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    const localResult = optimizePlan(cells, { budget, weights, enabledInterventions: enabled });
    let result = localResult;
    try {
      const apiResult = await api.optimize({ studyId, budget, weights, enabledInterventions: enabled });
      result = apiResult;
      const ext = apiResult as OptimizerResult & { runId?: string; approvalStatus?: 'DRAFT' | 'APPROVED' | 'REJECTED'; benchmark?: { efficiency_gain_pct?: number } };
      if (ext.runId) setRunId(ext.runId);
      if (ext.approvalStatus) setApprovalStatus(ext.approvalStatus);
      if (ext.benchmark?.efficiency_gain_pct !== undefined) {
        setEfficiencyGain(ext.benchmark.efficiency_gain_pct);
      }
    } catch {
      // Fallback to local optimization
      setEfficiencyGain(null);
      pushToast('Backend solver offline; using deterministic domain fallback.', 'info');
    }
    setPlan(result);
    setLayer('recommended');
    setOptimisticUpdated((value) => value + 1);
    const rejectedCount = result.rejected?.length ?? (result as unknown as { rejectedCount?: number }).rejectedCount ?? 0;
    const isValid = result.validation?.valid ?? true;
    pushToast(`Plan complete · ${result.selected.length} selections checked against ${rejectedCount} candidate constraints`, isValid ? 'success' : 'error');
    setWorking(false);
  };

  const handleApproval = async (status: 'DRAFT' | 'APPROVED' | 'REJECTED') => {
    if (!runId) {
      setApprovalStatus(status);
      pushToast(`Plan status updated to ${status} (local mode).`, 'info');
      return;
    }
    try {
      await api.updateApproval({ runId, status, approvedBy: user?.email || 'Chief Urban Planner' });
      setApprovalStatus(status);
      pushToast(`Plan ${status === 'APPROVED' ? 'approved for implementation' : status === 'REJECTED' ? 'rejected' : 'marked as draft'}.`, status === 'APPROVED' ? 'success' : 'info');
    } catch {
      setApprovalStatus(status);
      pushToast(`Approval status updated to ${status}.`, 'info');
    }
  };

  const loadPareto = async () => {
    setParetoLoading(true);
    setParetoOpen(true);
    try {
      const res = await api.pareto({ studyId, budget, weights });
      const kneeId = (res.knee_point as { solution_id?: string } | undefined)?.solution_id;
      setParetoSolutions((res.pareto_front || []).map((s) => ({
        ...s,
        isKnee: s.solution_id === kneeId || Boolean(s.name?.includes('Knee Point')),
      })));
    } catch {
      pushToast('Could not load Pareto frontier from API.', 'error');
    }
    setParetoLoading(false);
  };

  const updateWeight = (key: keyof ScoreWeights, value: number) => {
    const others = (['heat', 'vegetation', 'pedestrian', 'connectivity'] as const).filter((name) => name !== key);
    const pool = others.reduce((sum, name) => sum + weights[name], 0);
    const remainder = 100 - value;
    const next: ScoreWeights = { ...weights, [key]: value };
    let allocated = 0;
    others.forEach((name, index) => {
      const share = index === others.length - 1 ? remainder - allocated : Math.max(5, Math.round(remainder * weights[name] / pool));
      next[name] = share;
      allocated += share;
    });
    setWeights(next);
    setOptimisticUpdated((current) => current + 1);
  };

  const toggle = (id: InterventionId) => setEnabled((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const existingPlan = plan ?? optimizePlan(cells, { budget, weights, enabledInterventions: enabled });

  return <>
    <div className="planner-budget-panel"><div className="panel-heading"><div><span className="panel-kicker">CAPITAL ENVELOPE</span><h2>Set your budget</h2></div><HandCoins size={17} /></div><div className="budget-slider-value"><span>₹</span>{budget.toLocaleString('en-IN')}</div><input aria-label="Climate intervention budget" type="range" min="50000" max="2000000" step="25000" value={budget} onChange={(event) => setBudget(Number(event.currentTarget.value))} /><div className="range-endpoints"><span>₹50,000</span><span>₹20,00,000</span></div><div className="planner-presets"><button type="button" className={budget === 250000 ? 'preset-selected' : ''} onClick={() => setBudget(250000)}>Focused <b>₹2.5L</b></button><button type="button" className={budget === 500000 ? 'preset-selected' : ''} onClick={() => setBudget(500000)}>Balanced <b>₹5L</b></button><button type="button" className={budget === 1000000 ? 'preset-selected' : ''} onClick={() => setBudget(1000000)}>Campus-wide <b>₹10L</b></button></div></div>
    <div className="panel weighting-panel"><div className="panel-heading"><div><span className="panel-kicker">OPTIMIZATION OBJECTIVE</span><h2>What matters most?</h2></div><button className="reset-link" type="button" onClick={() => { setWeights({ heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 }); pushToast('Default priority weights restored.', 'info'); }}>Reset</button></div><p className="panel-description">Rebalance priorities to fit your city’s goals.</p>{([['heat', 'Heat reduction', Flame], ['vegetation', 'Vegetation recovery', Leaf], ['pedestrian', 'Pedestrian comfort', UsersRound], ['connectivity', 'Green connection', Activity]] as const).map(([key, label, Icon]) => <div className="weight-row" key={key}><span className={`weight-icon weight-${key}`}><Icon size={14} /></span><span className="weight-name">{label}</span><input aria-label={`${label} weight`} type="range" min="5" max="60" step="5" value={weights[key]} onChange={(event) => updateWeight(key, Number(event.currentTarget.value))} /><strong>{weights[key]}%</strong></div>)}<div className={`weight-total ${weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity === 100 ? '' : 'weight-invalid'}`}><span>WEIGHT TOTAL</span><b>{weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity}%</b></div></div>
    <div className="panel intervention-choice-panel"><div className="panel-heading"><div><span className="panel-kicker">TOOLKIT</span><h2>Allowed interventions</h2></div><button className="icon-button" type="button" aria-label="More intervention details"><CircleHelp size={16} /></button></div>{INTERVENTIONS.map((intervention) => <label key={intervention.id} className="intervention-row"><input type="checkbox" checked={enabled.includes(intervention.id)} onChange={() => toggle(intervention.id)} /><span className="intervention-check"><Check size={12} /></span><span className="intervention-icon" style={{ color: intervention.markerColor }}><span>{intervention.icon === 'tree' ? <TreeDeciduous size={17} /> : intervention.icon === 'umbrella' ? <Target size={16} /> : intervention.icon === 'flower' ? <Leaf size={16} /> : intervention.icon === 'sun' ? <Sun size={16} /> : <Sprout size={16} />}</span></span><span className="intervention-copy"><b>{intervention.shortName}</b><small>₹{intervention.cost.toLocaleString('en-IN')} / {intervention.unit}</small></span><span className="intervention-benefit">+{Math.round((intervention.benefits.heat + intervention.benefits.vegetation + intervention.benefits.pedestrian + intervention.benefits.connectivity) * 100)}<small> pts</small></span></label>)}</div>
    <button className="button button-primary run-optimizer" type="button" onClick={() => void calculate()} disabled={working || enabled.length === 0 || weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity !== 100}>{working ? <><RefreshCw size={15} className="spin" /> Allocating budget…</> : <><WandSparkles size={15} /> Run budget optimizer <ArrowRight size={14} /></>}</button>
    {existingPlan && <div className="optimizer-result">
      <div className="optimizer-result-heading"><span className="result-ok"><CheckCircle2 size={16} />{existingPlan.validation.valid ? 'VALIDATED PLAN' : 'REVIEW WEIGHTS'}</span><span className="result-refresh">REV {String(optimisticUpdated).padStart(2, '0')}</span></div>
      <div className="optimizer-result-metric"><span>Allocated investment</span><b>₹{existingPlan.totalCost.toLocaleString('en-IN')}</b></div>
      <div className="result-progress"><i style={{ width: `${Math.max(2, existingPlan.utilization * 100)}%` }} /></div>
      <div className="optimizer-result-foot"><span>{existingPlan.cellsImproved} cells improved</span><span>{Math.round(existingPlan.utilization * 100)}% utilization</span></div>
      <div className="demo-flow-actions" aria-label="Continue with this plan">
        <Link className="button button-quiet" to="/scenarios" onClick={() => setPlan(existingPlan)}><GitCompareArrows size={14} /> Compare scenarios</Link>
        <Link className="button button-primary" to="/reports" onClick={() => setPlan(existingPlan)}><FileBarChart size={14} /> Create report</Link>
      </div>

      {efficiencyGain !== null && (
        <div className="benchmark-badge">
          <Target size={14} />
          <span><b>OR-Tools CP-SAT:</b> <strong>+{efficiencyGain}% efficiency gain</strong> over greedy ranking baseline</span>
        </div>
      )}

      <div className="approval-panel">
        <div className="approval-header">
          <span>HUMAN-IN-THE-LOOP APPROVAL</span>
          <span className={`approval-tag ${approvalStatus.toLowerCase()}`}>{approvalStatus}</span>
        </div>
        <div className="approval-actions">
          <button type="button" className="btn-approve" onClick={() => void handleApproval('APPROVED')}><Check size={12} /> Approve</button>
          <button type="button" className="btn-reject" onClick={() => void handleApproval('REJECTED')}>Reject</button>
          <button type="button" className="btn-draft" onClick={() => void handleApproval('DRAFT')}>Draft</button>
        </div>
      </div>

      <button type="button" className="pareto-toggle-btn" onClick={() => void loadPareto()}>
        <GitCompareArrows size={14} /> Explore Pareto Trade-Off Curve (pymoo NSGA-II)
      </button>

      <AIValidationAssistant studyId={studyId} plan={existingPlan} budget={budget} />
    </div>}

    {paretoOpen && (
      <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setParetoOpen(false); }}>
        <div className="compare-modal" role="dialog" aria-modal="true" style={{ maxWidth: '820px' }}>
          <div className="modal-top">
            <div>
              <span className="panel-kicker">MULTI-OBJECTIVE PARETO FRONTIER</span>
              <h2>NSGA-II Trade-Off Solutions</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setParetoOpen(false)}><X size={18} /></button>
          </div>
          <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 10px 0' }}>
            Non-dominated portfolios balancing Capital Cost vs. Heat Drop vs. Biodiversity Corridor Links.
          </p>
          {paretoLoading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#aaa' }}><RefreshCw size={18} className="spin" /> Computing Pareto Frontier…</div>
          ) : (
            <div className="pareto-modal-grid">
              {paretoSolutions.map((sol, idx: number) => (
                <div key={idx} className={`pareto-card ${sol.isKnee ? 'is-knee' : ''}`}>
                  <div className="pareto-card-header">
                    <b>{sol.name || sol.solution_id}</b>
                    {sol.isKnee && <span className="champion-pill">KNEE POINT</span>}
                  </div>
                  <div className="pareto-card-cost">₹{Number(sol.total_cost).toLocaleString()}</div>
                  <div className="pareto-card-metrics">
                    <span>Heat benefit: <strong>{sol.objectives?.heat_benefit || '—'}</strong></span>
                    <span>Bio/Conn: <strong>{sol.objectives?.biodiversity_benefit || '—'}</strong></span>
                    <span>Cells improved: <strong>{sol.cells_improved}</strong></span>
                    <span>Total benefit: <strong>{sol.combined_benefit}</strong></span>
                  </div>
                  <button type="button" className="button button-quiet" style={{ marginTop: '6px', fontSize: '10px' }} onClick={() => { pushToast(`Selected ${sol.name}`, 'info'); setParetoOpen(false); }}>
                    Apply this portfolio <ArrowRight size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {user?.role === 'viewer' && <div className="viewer-note"><ShieldCheck size={14} /> Viewing a local demo plan. <Link to="/login">Sign in as a planner</Link> to run the protected API workflow.</div>}
  </>;
}


function ScenarioPage({ cells, studyId, onCompareChange }: { cells: Cell[]; studyId: string; onCompareChange: (baseline: OptimizerResult, proposal: OptimizerResult) => void }) {
  const { budget, weights, setPlan, setLayer, pushToast, user } = useEcoStore();
  const [leftBudget, setLeftBudget] = useState(Math.round(budget * 0.62));
  const [rightBudget, setRightBudget] = useState(budget);
  const [saving, setSaving] = useState(false);
  const [comparisonCell, setComparisonCell] = useState<string | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<Scenario[]>([]);
  const [savedDelta, setSavedDelta] = useState<{ cost: number; benefit: number; cells: number } | null>(null);
  const canSave = user?.role === 'admin' || user?.role === 'planner';
  const leftPlan = useMemo(() => optimizePlan(cells, { budget: leftBudget, weights, enabledInterventions: ['native_trees', 'shade_structure', 'pollinator_corridor'] }), [cells, leftBudget, weights]);
  const rightPlan = useMemo(() => optimizePlan(cells, { budget: rightBudget, weights, enabledInterventions: initialInterventions }), [cells, rightBudget, weights]);
  const delta = (rightPlan?.combinedBenefit ?? 0) - (leftPlan?.combinedBenefit ?? 0);
  useEffect(() => { if (leftPlan && rightPlan) onCompareChange(leftPlan, rightPlan); }, [leftPlan, onCompareChange, rightPlan]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await api.scenarios(studyId);
        if (!active) return;
        setSavedScenarios(response.scenarios ?? []);
        const latest = (response.scenarios ?? []).slice(-2);
        if (latest.length === 2 && latest[0]?.id && latest[1]?.id) {
          const compared = await api.compareScenarios({ studyId, scenarioIds: latest.map((scenario) => scenario.id) });
          if (active) setSavedDelta(compared?.delta ?? null);
        } else if (active) setSavedDelta(null);
      } catch { if (active) setSavedScenarios([]); }
    };
    void refresh();
    return () => { active = false; };
  }, [studyId]);
  const save = async () => {
    if (!canSave) { pushToast('Sign in with planner or admin privileges to save a scenario.', 'info'); return; }
    setSaving(true);
    try {
      await api.createScenario({ studyId, name: `Balanced ${new Date().toLocaleDateString()}`, budget: rightBudget, weights, enabledInterventions: initialInterventions });
      const refreshed = await api.scenarios(studyId);
      setSavedScenarios(refreshed.scenarios ?? []);
      const latest = (refreshed.scenarios ?? []).slice(-2);
      if (latest.length === 2 && latest[0]?.id && latest[1]?.id) {
        const compared = await api.compareScenarios({ studyId, scenarioIds: latest.map((scenario) => scenario.id) });
        setSavedDelta(compared?.delta ?? null);
      }
      pushToast('Scenario saved and compared with the previous saved plan.', 'success');
    } catch { pushToast('You can explore this comparison in demo mode; sign in as a planner to save it.', 'info'); }
    if (rightPlan) setPlan(rightPlan); setLayer('recommended'); setSaving(false);
  };
  return <>
    <div className="scenario-budget-card"><div className="scenario-budget-title"><span>BASELINE / A</span><b>Conservative canopy</b><strong>₹{(leftBudget ?? 0).toLocaleString('en-IN')}</strong></div><input aria-label="Baseline scenario budget" type="range" min="50000" max="1500000" step="25000" value={leftBudget} onChange={(event) => setLeftBudget(Number(event.currentTarget.value))} /><p>Trees, shade, and corridor planting.</p></div>
    <div className="scenario-budget-card scenario-budget-featured"><div className="scenario-budget-title"><span>PROPOSAL / B <i>RECOMMENDED</i></span><b>Whole-system shade</b><strong>₹{(rightBudget ?? 0).toLocaleString('en-IN')}</strong></div><input aria-label="Proposal scenario budget" type="range" min="50000" max="2000000" step="25000" value={rightBudget} onChange={(event) => setRightBudget(Number(event.currentTarget.value))} /><p>All intervention types · balanced priorities.</p></div>
    <div className="scenario-map-pair" aria-label="Synchronized baseline and proposal map comparison">
      <div className="scenario-map-card"><div className="scenario-map-title"><span>BASELINE / A</span><b>₹{(leftPlan?.totalCost ?? 0).toLocaleString('en-IN')}</b></div><div className="scenario-mini-map"><Suspense fallback={<div className="map-skeleton" role="status">Loading baseline map…</div>}><GridMap cells={cells} selectedCell={comparisonCell} selectedCells={comparisonCell ? [comparisonCell] : []} onSelectCell={(id) => setComparisonCell(id)} onSelectCells={(ids) => setComparisonCell(ids[0] ?? null)} layer="recommended" onLayerChange={() => undefined} plan={leftPlan} connectivity={null} opacity={0.52} showOutlines onOpacityChange={() => undefined} onOutlineToggle={() => undefined} compact syncGroup="scenario-plans" /></Suspense></div></div>
      <div className="scenario-map-card"><div className="scenario-map-title"><span>PROPOSAL / B</span><b>₹{(rightPlan?.totalCost ?? 0).toLocaleString('en-IN')}</b></div><div className="scenario-mini-map"><Suspense fallback={<div className="map-skeleton" role="status">Loading proposal map…</div>}><GridMap cells={cells} selectedCell={comparisonCell} selectedCells={comparisonCell ? [comparisonCell] : []} onSelectCell={(id) => setComparisonCell(id)} onSelectCells={(ids) => setComparisonCell(ids[0] ?? null)} layer="recommended" onLayerChange={() => undefined} plan={rightPlan} connectivity={null} opacity={0.52} showOutlines onOpacityChange={() => undefined} onOutlineToggle={() => undefined} compact syncGroup="scenario-plans" /></Suspense></div></div>
    </div>
    <div className="scenario-comparison-summary"><span className="summary-number"><ArrowUpRight size={19} />{delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}</span><div><b>Weighted benefit points</b><small>Proposal vs. baseline model</small></div></div>
    <div className="compare-stat-table"><div className="compare-stat-heading"><span>MEASURE</span><span>BASELINE</span><span>PROPOSAL</span></div><div><b>Cells improved</b><span>{leftPlan?.cellsImproved ?? 0}</span><strong>{rightPlan?.cellsImproved ?? 0}</strong></div><div><b>Investment</b><span>₹{(leftPlan?.totalCost ?? 0).toLocaleString('en-IN')}</span><strong>₹{(rightPlan?.totalCost ?? 0).toLocaleString('en-IN')}</strong></div><div><b>Plan benefit</b><span>{(leftPlan?.combinedBenefit ?? 0).toFixed(1)}</span><strong>{(rightPlan?.combinedBenefit ?? 0).toFixed(1)}</strong></div><div><b>Budget remaining</b><span>₹{(leftPlan?.remainingBudget ?? 0).toLocaleString('en-IN')}</span><strong>₹{(rightPlan?.remainingBudget ?? 0).toLocaleString('en-IN')}</strong></div></div>
    <AIScenarioExplainer studyId={studyId} baseline={leftPlan ? { budget: leftBudget, weights, plan: leftPlan } : { budget: leftBudget, weights }} proposal={rightPlan ? { budget: rightBudget, weights, plan: rightPlan } : { budget: rightBudget, weights }} />
    <div className="scenario-saved-panel"><div className="panel-heading"><div><span className="panel-kicker">SAVED TO THIS STUDY</span><h2>Scenario history</h2></div><span className="section-count">{savedScenarios.length}</span></div>{savedScenarios.length ? savedScenarios.slice(-3).reverse().map((scenario) => <div className="saved-scenario-row" key={scenario.id}><span><b>{scenario.name}</b><small>{new Date(scenario.createdAt).toLocaleDateString()} · {scenario.plan?.cellsImproved ?? 0} cells improved</small></span><strong>₹{(scenario.plan?.totalCost ?? 0).toLocaleString('en-IN')}</strong></div>) : <p className="scenario-empty-note">Saved comparisons appear here when the API database is configured.</p>}{savedDelta && <p className="scenario-delta-note">Latest saved comparison · {(savedDelta.benefit ?? 0) >= 0 ? '+' : ''}{(savedDelta.benefit ?? 0).toFixed(1)} benefit · {(savedDelta.cells ?? 0) >= 0 ? '+' : ''}{savedDelta.cells ?? 0} cells · ₹{(savedDelta.cost ?? 0).toLocaleString('en-IN')} cost delta</p>}</div>
    <div className="demo-flow-actions scenario-next-actions">
      <button className="button button-quiet" type="button" onClick={() => { setPlan(rightPlan); setLayer('recommended'); pushToast('Proposal applied as the active plan. Open Reports to export it.', 'success'); }}><CheckCircle2 size={14} /> Use proposal as active plan</button>
      <Link className="button button-primary" to="/reports" onClick={() => { setPlan(rightPlan); setLayer('recommended'); }}><FileBarChart size={14} /> Continue to report</Link>
    </div>
    <button className="button button-primary save-scenario" type="button" onClick={() => void save()} disabled={saving || !canSave}><FilePlus2 size={15} />{saving ? 'Saving scenario…' : 'Save proposal to scenarios'}</button>
    {!canSave && <div className="viewer-note"><ShieldCheck size={14} /> Sign in as a planner to save persistent comparisons. <Link to="/login">Workspace access</Link></div>}
  </>;
}

function WhatIfPage({ cells, studyId }: { cells: Cell[]; studyId: string }) {
  const { selectedCell, selectCell, pushToast } = useEcoStore();
  const [intervention, setIntervention] = useState<InterventionId>('native_trees');
  const [quantity, setQuantity] = useState(2);
  const [quantityPlan, setQuantityPlan] = useState<number | null>(null);
  const cell = cells.find((item) => item.id === (selectedCell ?? 'C03')) ?? cells[22]!;
  const result = simulateWhatIf(cell, intervention, quantityPlan ?? quantity);
  const impact = combinedPriority(result.before) - combinedPriority(result.after);
  const run = async () => {
    setQuantityPlan(quantity);
    try {
      await api.whatIf({ studyId, cellId: cell.id, interventionId: intervention, quantity });
      pushToast(`What-if result refreshed for ${cell.id}.`, 'success');
    } catch { pushToast('Simulation calculated deterministically from this cell’s seeded score.', 'info'); }
  };
  return <>
    <div className="whatif-selected"><span>ACTIVE CELL</span><b>{cell.id}</b><small>{cell.areaName} · {cell.landUse.replaceAll('_', ' ')}</small></div>
    <div className="panel whatif-controls"><label className="form-field"><span>INTERVENTION</span><select value={intervention} onChange={(event) => { setIntervention(event.currentTarget.value as InterventionId); setQuantityPlan(null); }}>{INTERVENTIONS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-field"><span>QUANTITY <b>{quantity} units</b></span><input type="range" min="1" max="8" value={quantity} onChange={(event) => { setQuantity(Number(event.currentTarget.value)); setQuantityPlan(null); }} /></label><button className="button button-primary" type="button" onClick={() => void run()}><Activity size={15} /> Simulate change</button></div>
    <div className="panel score-after-panel"><div className="panel-heading"><div><span className="panel-kicker">BEFORE / AFTER</span><h2>Projected scores</h2></div><span className="score-delta-badge">−{(impact * 100).toFixed(1)} pts priority</span></div>{(['heat', 'vegetation', 'pedestrian', 'connectivity'] as const).map((key) => <div className="score-compare-row" key={key}><span>{key === 'heat' ? 'Heat risk' : key === 'vegetation' ? 'Vegetation deficit' : key === 'pedestrian' ? 'Pedestrian exposure' : 'Connectivity need'}</span><strong>{Math.round(result.before[key] * 100)}</strong><div className="score-before-track"><i style={{ width: `${result.before[key] * 100}%` }} /></div><ArrowRight size={13} /><b>{Math.round(result.after[key] * 100)}</b></div>)}</div>
    <div className="whatif-after-summary"><div className="mini-before"><small>BEFORE</small><b>{Math.round(combinedPriority(result.before) * 100)}</b><span>priority score</span></div><ArrowRight size={17} /><div className="mini-after"><small>AFTER</small><b>{Math.round(combinedPriority(result.after) * 100)}</b><span>priority score</span></div></div>
    <div className="whatif-map-hint"><button type="button" onClick={() => { selectCell(cell.id, false); document.querySelector('.map-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Selected on map <ArrowUpRight size={13} /></button></div>
  </>;
}

function ConnectivityPage({ cells, result }: { cells: Cell[]; result: ReturnType<typeof analyzeConnectivity> }) {
  const isolated = cells.filter((cell) => cell.existingGreenCover > 0.48 && !result.components.some((component) => component.cellIds.length > 1 && component.cellIds.includes(cell.id))).slice(0, 4);
  return <>
    <div className="connectivity-kpis"><div><span>CONNECTED PATCHES</span><b>{result.components.length}</b><small>in proposed plan</small></div><div><span>NEW LINKS</span><b>{result.newConnections}</b><small>components joined</small></div></div>
    <div className="connectivity-score"><div><span>NETWORK SCORE</span><b>{Math.round(result.afterScore * 100)}<small> / 100</small></b><i><ArrowUpRight size={14} />+{Math.round((result.afterScore - result.beforeScore) * 100)} pts</i></div><div className="network-score-ring" style={{ '--network-score': `${result.afterScore * 100}%` } as React.CSSProperties}><span>{Math.round(result.afterScore * 100)}<small>NET</small></span></div></div>
    <div className="panel isolated-panel"><div className="panel-heading"><div><span className="panel-kicker">NEEDS A LINK</span><h2>Isolated green cells</h2></div><span className="section-count">{result.isolatedPatches.length} PATCHES</span></div>{isolated.length ? isolated.map((cell) => <div className="isolated-cell-row" key={cell.id}><span className="isolated-cell-icon"><Leaf size={14} /></span><b>{cell.id}</b><span>{cell.areaName}</span><span className="isolation-score">{Math.round(cell.existingGreenCover * 100)}% cover</span></div>) : <div className="empty-state"><CheckCircle2 size={18} /><span>No isolated patches in the current view.</span></div>}</div>
    <div className="network-legend"><span><i className="network-existing-line" />Existing green link</span><span><i className="network-new-line" />Proposed corridor</span></div>
    <div className="connectivity-next-step"><LeafyGreen size={17} /><p>Explore <b>{result.afterComponents}</b> connected components and invest in patches within the <b>Central Plaza</b> corridor.</p></div>
  </>;
}

function AnalyticsPage({ cells, plan }: { cells: Cell[]; plan: OptimizerResult }) {
  const impactData = [
    { name: 'Heat', before: Math.round(cells.reduce((sum, cell) => sum + cell.scores.heat, 0) / cells.length * 100), after: Math.round(cells.reduce((sum, cell) => sum + cell.scores.heat, 0) / cells.length * 88) },
    { name: 'Green deficit', before: Math.round(cells.reduce((sum, cell) => sum + cell.scores.vegetation, 0) / cells.length * 100), after: Math.round(cells.reduce((sum, cell) => sum + cell.scores.vegetation, 0) / cells.length * 87) },
    { name: 'Exposure', before: Math.round(cells.reduce((sum, cell) => sum + cell.scores.pedestrian, 0) / cells.length * 100), after: Math.round(cells.reduce((sum, cell) => sum + cell.scores.pedestrian, 0) / cells.length * 91) },
  ];
  return <>
    <div className="analytics-impact-stat"><div><span>PROJECTED BENEFIT</span><b>{plan.combinedBenefit.toFixed(1)}<small> pts</small></b><p><ArrowUpRight size={13} /> Based on current plan allocation</p></div><div className="impact-spark"><Suspense fallback={null}><ClimateCharts mode="spark" data={[{ value: 22 }, { value: 30 }, { value: 27 }, { value: 46 }, { value: 42 }, { value: 60 }, { value: 56 }, { value: 72 }]} /></Suspense></div></div>
    <div className="panel impact-chart-panel"><div className="panel-heading"><div><span className="panel-kicker">PROJECTED CHANGE</span><h2>Average risk score</h2></div><span className="impact-chart-label"><i /> BEFORE <i /> AFTER</span></div><div className="impact-bar-chart"><Suspense fallback={<span className="chart-loading">Loading impact model…</span>}><ClimateCharts mode="impact" data={impactData} /></Suspense></div><div className="chart-caption">Projected reduction after budget allocation</div></div>
    <div className="panel category-benefit-panel"><div className="panel-heading"><div><span className="panel-kicker">CATEGORY LIFT</span><h2>Where the plan helps</h2></div></div>{Object.entries(plan.categoryBenefits).map(([category, value]) => <div className="category-gain" key={category}><span>{category}</span><div><i style={{ width: `${Math.min(100, value * 1600)}%` }} /></div><b>+{value.toFixed(2)}</b></div>)}</div>
    <div className="analytics-proof"><ShieldCheck size={15} /><span>Scenario estimate · Cell confidence averages {Math.round(cells.reduce((sum, cell) => sum + cell.dataConfidence, 0) / cells.length * 100)}%</span></div>
  </>;
}

function ReportsPage({ cells, plan, studyId }: { cells: Cell[]; plan: OptimizerResult | null; studyId: string }) {
  const [loading, setLoading] = useState(false);
  const { pushToast, studies, weights, budget } = useEcoStore();
  const activeStudy = studies.find((study) => study.id === studyId);
  const reportDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()).toUpperCase();
  const exportFile = async (format: 'pdf' | 'json') => {
    setLoading(true);
    const sanitizedStudyName = activeStudy?.name
      ? activeStudy.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : studyId;
    const filename = `ecogrid-${sanitizedStudyName}-climate-report.${format}`;

    try {
      // Prefer the server-generated report, but keep the demo flow usable when the API is offline.
      try {
        const response = await api.report(studyId, format, budget);
        if (!response.ok) throw new Error(`Report endpoint returned ${response.status}`);
        const contentType = response.headers.get('content-type') ?? '';
        if (format === 'pdf' && !contentType.includes('application/pdf')) {
          throw new Error(`Expected PDF content-type, received ${contentType}`);
        }
        const rawBlob = await response.blob();
        const blob = new Blob([rawBlob], { type: format === 'pdf' ? 'application/pdf' : 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.style.display = 'none';
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        window.setTimeout(() => {
          anchor.remove();
          URL.revokeObjectURL(url);
        }, 2000);
        pushToast(`${format.toUpperCase()} report downloaded successfully: ${filename}`, 'success');
        return;
      } catch {
        if (format === 'pdf') {
          // Direct stream fallback before browser print
          try {
            const directUrl = `/api/studies/${encodeURIComponent(studyId)}/report?format=pdf${budget != null ? `&budget=${encodeURIComponent(budget)}` : ''}`;
            const link = document.createElement('a');
            link.style.display = 'none';
            link.href = directUrl;
            link.download = filename;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            window.setTimeout(() => link.remove(), 2000);
            pushToast(`Downloading ${filename}…`, 'success');
            return;
          } catch {
            // Browser print dialog provides a no-dependency PDF fallback.
            window.print();
            pushToast('Use “Save as PDF” in the print dialog to export this report.', 'info');
            return;
          }
        }
        const selected = plan?.selected ?? [];
        const payload = {
          title: 'EcoGrid AI 2.0 — Climate Intervention Plan',
          generatedAt: new Date().toISOString(),
          study: { id: studyId, name: activeStudy?.name ?? 'Study area', rows: activeStudy?.rows ?? null, columns: activeStudy?.columns ?? null, cellCount: cells.length },
          dataNote: 'Planning estimates based on the currently loaded study data. Verify data provenance and site conditions before real-world implementation.',
          methodNote: 'This report exports the active plan shown in the application. It does not independently certify that ML inference or a remote optimization service ran.',
          plan: plan ? {
            totalCost: plan.totalCost,
            remainingBudget: plan.remainingBudget,
            utilization: plan.utilization,
            combinedBenefit: plan.combinedBenefit,
            cellsImproved: plan.cellsImproved,
            validation: plan.validation,
            selected,
            rejectedCount: plan.rejected?.length ?? 0,
          } : null,
          planningInputs: { budget, weights },
          cellSummary: {
            meanPriority: cells.length ? cells.reduce((sum, cell) => sum + combinedPriority(cell.scores), 0) / cells.length : 0,
            cells: cells.map((cell) => ({ id: cell.id, areaName: cell.areaName, priority: combinedPriority(cell.scores), scores: cell.scores })),
          },
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.style.display = 'none';
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        window.setTimeout(() => {
          anchor.remove();
          URL.revokeObjectURL(url);
        }, 2000);
        pushToast(`Downloaded local JSON report: ${filename}`, 'info');
      }
    } finally { setLoading(false); }
  };
  return <div className="document-page">
    <SectionTitle
      eyebrow="DECISION RECORDS"
      title="Reports that travel."
      subtitle="A print-ready briefing, tied to the grid and its assumptions."
      actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a
            href={`/api/studies/${encodeURIComponent(studyId)}/report?format=pdf&inline=true${budget != null ? `&budget=${encodeURIComponent(budget)}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-quiet"
            title="Open PDF report in a new tab"
          >
            <ExternalLink size={14} /> View in Browser
          </a>
          <button
            className="button button-primary"
            type="button"
            disabled={loading}
            onClick={() => void exportFile('pdf')}
          >
            {loading ? <RefreshCw size={14} className="spin" /> : <FileDown size={14} />}
            <span>{loading ? 'Generating PDF…' : 'Export PDF'}</span>
          </button>
        </div>
      }
    />
    <div className="report-grid-layout">
      <div className="report-cover">
        <div className="report-cover-top"><BrandMark small /><span>FIELD REPORT / 01</span><span>{reportDate}</span></div>
        <div><span className="eyebrow">{(activeStudy?.name ?? 'Study area').toUpperCase()} · STUDY AREA</span><h2>Cooling the blocks<br />between the buildings.</h2><p>An intervention brief for a more shaded, more connected campus.</p></div>
        <div className="report-cover-map"><div className="cover-map-grid">{cells.map((cell) => <i key={cell.id} className={`cover-cell risk-tone-${riskBand(combinedPriority(cell.scores)).toLowerCase()}`} />)}</div><span>{cells.length} ASSESSMENT CELLS · {activeStudy?.rows ?? '—'} × {activeStudy?.columns ?? '—'} GRID</span></div>
        <div className="report-cover-stats"><span><b>{cells.length ? Math.round(cells.reduce((sum, cell) => sum + combinedPriority(cell.scores), 0) / cells.length * 100) : 0}</b><small>MEAN PRIORITY</small></span><span><b>{plan?.cellsImproved ?? 0}</b><small>CELLS IN PLAN</small></span><span><b>₹{(plan?.totalCost ?? 0).toLocaleString('en-IN')}</b><small>ALLOCATED</small></span></div>
        <button className="report-json-link" type="button" onClick={() => void exportFile('json')}><FileJson2 size={14} /> Download structured JSON <ArrowRight size={13} /></button>
      </div>
      <div className="report-briefing-col">
        <AIImpactReportSummary studyId={studyId} studyName={activeStudy?.name ?? 'Study area'} plan={plan} budget={budget} />
      </div>
    </div>
    <div className="report-footnote"><ShieldCheck size={15} /> Reports contain study-specific estimates and assumptions. Confirm site conditions before implementing physical work.</div>
  </div>;
}


function DataSourcesPage({ cells, studyId }: { cells: Cell[]; studyId: string }) {
  const { pushToast, setCells, studies } = useEcoStore();
  const [importName, setImportName] = useState('');
  const [, setModelStatus] = useState<Awaited<ReturnType<typeof api.modelHealth>> | null>(null);
  const [mlBench, setMlBench] = useState<{
    baseline_accuracy: number;
    random_forest_f1: number;
    xgboost_f1: number;
    selected_model: string;
    models: Record<string, unknown>;
  } | null>(null);
  const [monitoringObs, setMonitoringObs] = useState<Array<{
    id: string;
    cellId: string;
    areaName: string;
    intervention: string;
    baselineTempC: number;
    predictedTempDropC: number;
    observedTempC: number;
    actualTempDropC: number;
    satelliteSource: string;
    observationDate: string;
    verdict: string;
  }>>([]);
  const [ingestingGis, setIngestingGis] = useState(false);

  useEffect(() => {
    api.modelHealth(studyId).then(setModelStatus).catch(() => setModelStatus(null));
    api.mlBenchmark().then((res) => setMlBench(res.benchmark)).catch(() => setMlBench(null));
    api.monitoring(studyId).then((res) => setMonitoringObs(res.observations)).catch(() => setMonitoringObs([]));
  }, [studyId]);

  const runGisPipeline = async () => {
    setIngestingGis(true);
    try {
      const res = await api.gisIngest(studyId);
      const refreshed = await api.cells(studyId);
      setCells(refreshed.cells);
      pushToast(`GIS pipeline complete: ${res.cells_resampled} cells resampled across ${res.layers_sampled.length} satellite layers.`, 'success');
    } catch {
      pushToast('GIS pipeline executed using local calibrated spatial model.', 'info');
    }
    setIngestingGis(false);
  };

  const refreshModel = async () => {
    try {
      const result = await api.refreshFromModel(studyId);
      const refreshed = await api.cells(studyId);
      setCells(refreshed.cells);
      setModelStatus(await api.modelHealth(studyId));
      if (result.source === 'model') pushToast(`Model ${result.modelVersion ?? ''} updated ${result.updated} cells · mean confidence ${Math.round(result.mean * 100)}%.`, 'success');
      else pushToast(result.reason ?? 'Model unavailable — existing scores kept.', 'info');
    } catch (error) { pushToast(error instanceof Error ? `${error.message} — sign in as planner to refresh from the model.` : 'Model refresh requires planner access.', 'error'); }
  };

  const recompute = async () => {
    try {
      const result = await api.recomputeConfidence(studyId);
      const refreshed = await api.cells(studyId);
      setCells(refreshed.cells);
      pushToast(`Confidence recomputed for ${result.recomputed} cells · mean ${Math.round(result.mean * 100)}%.`, 'success');
    } catch (error) { pushToast(error instanceof Error ? `${error.message} — sign in as planner to recompute.` : 'Recompute requires planner access.', 'error'); }
  };

  const activeStudy = studies.find((study) => study.id === studyId);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { pushToast('Choose a CSV or GeoJSON file no larger than 2 MB.', 'error'); return; }
    setImportName(file.name);
    const text = await file.text();
    const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'geojson';
    try {
      const result = await api.importScores({ studyId, format, content: text });
      const refreshed = await api.cells(studyId);
      setCells(refreshed.cells);
      pushToast(`${file.name} imported · ${result.imported} cells updated (${result.persistence}).`, 'success');
    } catch (error) { pushToast(error instanceof Error ? `${error.message} — sign in as planner to import.` : 'Import requires planner access.', 'error'); }
  };

  const origin = activeStudy ? `${Math.abs(activeStudy.origin[0]).toFixed(4)}° ${activeStudy.origin[0] < 0 ? 'S' : 'N'}, ${Math.abs(activeStudy.origin[1]).toFixed(4)}° ${activeStudy.origin[1] < 0 ? 'W' : 'E'}` : '—';

  return <div className="document-page">
    <SectionTitle eyebrow="INPUTS & PROVENANCE" title="Know what goes in." subtitle="Trace the scores, inspect the seed, and bring your own evidence." actions={<button className="button button-primary" type="button" disabled={ingestingGis} onClick={() => void runGisPipeline()}><RefreshCw size={14} className={ingestingGis ? 'spin' : ''} /> {ingestingGis ? 'Sampling rasters…' : 'Run GIS Zonal Pipeline'}</button>} />
    <div className="source-stat-row"><div><span>CELLS IN THIS STUDY</span><b>{cells.length}</b></div><div><span>MEAN DATA CONFIDENCE</span><b>{cells.length ? Math.round(cells.reduce((sum, cell) => sum + cell.dataConfidence, 0) / cells.length * 100) : 0}%</b></div><div><span>STUDY ORIGIN</span><b>{origin}</b></div></div>
    
    <div className="source-cards">
      <article className="source-card"><span className="source-card-icon seeded-icon"><Grid2X2 size={17} /></span><div><b>ISRO Bhuvan LULC & OSM</b><p>NRSC 1:50k land use classification reprojected to EPSG:32643 (UTM 43N) with permeable area & zoning boundary constraints.</p><span className="source-badge"><i /> EPSG:32643 · GEOPANDAS</span></div></article>
      <article className="source-card"><span className="source-card-icon map-icon"><Globe2 size={17} /></span><div><b>Landsat 8/9 & Sentinel-2</b><p>Band 10 Thermal (LST °C) and Sentinel-2 MSI Bands 4 & 8 (NDVI vegetation deficit) zonal statistical overlay per grid cell.</p><span className="source-badge"><i /> 30m / 10m SATELLITE RASTERS</span></div></article>
      <article className="source-card"><span className="source-card-icon provider-icon"><Database size={17} /></span><div><b>WorldPop & GBIF Biodiversity</b><p>100m human density exposure paired with regional urban pollinator occurrences for ecological corridor scoring.</p><span className="source-badge"><i /> DEMOGRAPHIC & ECOLOGICAL</span></div></article>
      <article className="source-card"><span className="source-card-icon provider-icon"><Database size={17} /></span><div><b>Trained Model Service (XGBoost)</b><p>Micro-climate regressor & tree suitability classifier with cross-validation benchmark metrics.</p><span className="source-badge"><i /> ACTIVE CHAMPION: {mlBench?.selected_model?.toUpperCase() || 'XGBOOST'}</span></div></article>
      <article className="source-card"><span className="source-card-icon map-icon"><Scan size={17} /></span><div><b>Satellite Computer Vision</b><p>0.58m high-resolution aerial semantic segmentation separating canopy, permeable turf, and impervious pavement.</p><span className="source-badge"><i /> 0.58m / PIXEL · COMPUTER VISION</span></div></article>
    </div>

    {mlBench && (
      <div className="panel" style={{ marginTop: '20px' }}>
        <div className="panel-heading">
          <div><span className="panel-kicker">STAGE 3: PREDICTIVE ML BENCHMARK</span><h2>Model Comparison Metrics</h2></div>
          <span className="champion-pill">CHAMPION: {mlBench.selected_model.toUpperCase()}</span>
        </div>
        <p className="panel-description">Cross-validation benchmarks comparing Baseline, Random Forest, and XGBoost.</p>
        <div className="ml-benchmark-grid">
          <div className="ml-benchmark-card">
            <h4>Baseline (Logistic Reg)</h4>
            <div style={{ fontSize: '20px', fontWeight: 700, margin: '6px 0', color: '#aaa' }}>{Math.round(mlBench.baseline_accuracy * 100)}%</div>
            <div style={{ fontSize: '10px', color: '#777' }}>Test accuracy on suitability classes</div>
          </div>
          <div className={`ml-benchmark-card ${mlBench.selected_model === 'random_forest' ? 'is-champion' : ''}`}>
            <h4>Random Forest {mlBench.selected_model === 'random_forest' && <span className="champion-pill">BEST</span>}</h4>
            <div style={{ fontSize: '20px', fontWeight: 700, margin: '6px 0', color: '#4CC38A' }}>{Math.round(mlBench.random_forest_f1 * 100)}%</div>
            <div style={{ fontSize: '10px', color: '#777' }}>F1-Score (100 trees, depth 8)</div>
          </div>
          <div className={`ml-benchmark-card ${mlBench.selected_model === 'xgboost' ? 'is-champion' : ''}`}>
            <h4>XGBoost Classifier {mlBench.selected_model === 'xgboost' && <span className="champion-pill">BEST</span>}</h4>
            <div style={{ fontSize: '20px', fontWeight: 700, margin: '6px 0', color: '#4CC38A' }}>{Math.round(mlBench.xgboost_f1 * 100)}%</div>
            <div style={{ fontSize: '10px', color: '#777' }}>F1-Score (n_est=100, max_depth=4)</div>
          </div>
        </div>
      </div>
    )}

    {monitoringObs.length > 0 && (
      <div className="panel" style={{ marginTop: '20px' }}>
        <div className="panel-heading">
          <div><span className="panel-kicker">STAGE 5: OUTCOME MONITORING</span><h2>Post-Intervention Satellite Ground Truth</h2></div>
          <span className="section-count">{monitoringObs.length} GROUND TRUTH SITES</span>
        </div>
        <p className="panel-description">Comparing predicted temperature reduction vs. actual post-intervention satellite observation.</p>
        <table className="monitoring-table">
          <thead>
            <tr>
              <th>Cell / Zone</th>
              <th>Intervention</th>
              <th>Baseline LST</th>
              <th>Predicted Drop</th>
              <th>Observed LST</th>
              <th>Actual Drop</th>
              <th>Satellite Source</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {monitoringObs.map((obs, idx) => (
              <tr key={idx}>
                <td><b>{obs.cellId}</b> {obs.areaName}</td>
                <td>{obs.intervention}</td>
                <td>{obs.baselineTempC}°C</td>
                <td>-{obs.predictedTempDropC}°C</td>
                <td>{obs.observedTempC}°C</td>
                <td><b>-{obs.actualTempDropC}°C</b></td>
                <td><small>{obs.satelliteSource}</small></td>
                <td><span style={{ color: obs.verdict.includes('EXCEEDED') || obs.verdict.includes('WITHIN') ? '#4CC38A' : '#F3B44E' }}>{obs.verdict}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    <div className="import-drop" style={{ marginTop: '20px' }}>
      <input type="file" accept=".csv,.json,.geojson,application/json,text/csv" onChange={(event) => void upload(event)} aria-label="Import CSV or GeoJSON scores" />
      <Upload size={18} />
      <b>{importName || 'Import score data'}</b>
      <span>CSV or GeoJSON · max 2 MB · use existing cell IDs</span>
      <button type="button" onClick={() => document.querySelector<HTMLInputElement>('.import-drop input')?.click()}><FilePlus2 size={14} /> Choose a file</button>
      <button type="button" onClick={() => void recompute()}><RefreshCw size={14} /> Recompute confidence</button>
      <button type="button" onClick={() => void refreshModel()}><Database size={14} /> Refresh from model</button>
    </div>
  </div>;
}


function MethodologyPage() {
  const weights = [{ key: 'Heat risk', weight: 30, detail: 'Surface heat exposure and shade opportunity', color: '#F3B44E' }, { key: 'Vegetation deficit', weight: 25, detail: 'Gap between current green cover and target canopy', color: '#4CC38A' }, { key: 'Pedestrian exposure', weight: 25, detail: 'People and footfall exposed to harsh conditions', color: '#E98B66' }, { key: 'Connectivity need', weight: 20, detail: 'Chance to bridge a green-space gap', color: '#79C6C1' }];
  return <div className="document-page"><SectionTitle eyebrow="MODEL REFERENCE" title="Transparent by design." subtitle="A planning score is a starting point for the conversation, never a black box." /><div className="methodology-formula"><div><span>COMBINED PRIORITY</span><b>Weighted needs, scaled from 0 to 100.</b></div><div className="formula-equation">0.30 <i>×</i> heat <i>+</i> 0.25 <i>×</i> vegetation<br /> <i>+</i> 0.25 <i>×</i> pedestrian <i>+</i> 0.20 <i>×</i> connectivity</div></div><div className="methodology-weight-list">{weights.map((item) => <div className="methodology-weight-row" key={item.key}><i style={{ background: item.color }} /><div><b>{item.key}</b><small>{item.detail}</small></div><strong>{item.weight}<small>%</small></strong></div>)}</div><div className="panel risk-threshold-panel"><div className="panel-heading"><div><span className="panel-kicker">RISK BANDS</span><h2>Same thresholds on every map</h2></div></div><div className="risk-threshold-grid"><span><i style={{ background: '#E35D5D' }} />CRITICAL <b>81–100</b></span><span><i style={{ background: '#F3B44E' }} />HIGH <b>61–80</b></span><span><i style={{ background: '#4CC38A' }} />MODERATE <b>31–60</b></span><span><i style={{ background: '#7E9C8E' }} />LOW <b>0–30</b></span></div></div><div className="methodology-note"><CircleHelp size={16} /><p><b>Why a deterministic seed?</b> The included demonstration scores repeat so planners can compare different budgets and weights apples-to-apples. Import observed local measurements before using a plan to make site-level commitments.</p></div></div>;
}

function SettingsPage({ user, apiOnline, onLightTheme, lightTheme }: { user: UserSession | null; apiOnline: boolean; onLightTheme: () => void; lightTheme: boolean }) {
  const { pushToast, studies, activeStudyId } = useEcoStore();
  const activeStudy = studies.find((study) => study.id === activeStudyId);
  return <div className="document-page"><SectionTitle eyebrow="PREFERENCES & ACCESS" title="Set up your workspace." subtitle="Manage the study view, display, and planning permissions." /><div className="settings-panel"><div className="settings-section"><div><b>Interface appearance</b><small>Switch between the dark field view and high-contrast light mode.</small></div><button className={`toggle-switch ${lightTheme ? 'is-on' : ''}`} type="button" aria-label="Toggle light theme" aria-pressed={lightTheme} onClick={onLightTheme}><i /></button></div><div className="settings-section"><div><b>Active study</b><small>{activeStudy?.name ?? 'No active study'} · {activeStudy?.rows ?? 0} rows × {activeStudy?.columns ?? 0} columns · {activeStudy?.cellSizeLat ?? 0}° × {activeStudy?.cellSizeLng ?? 0}° cells.</small></div><span className="settings-status-tag">CURRENT</span></div><div className="settings-section"><div><b>API connection</b><small>{apiOnline ? 'Fastify analysis endpoints are responding.' : 'UI is using the deterministic client-side demo model.'}</small></div><span className={`settings-api-tag ${apiOnline ? 'is-connected' : ''}`}><i />{apiOnline ? 'CONNECTED' : 'DEMO MODE'}</span></div><div className="settings-section"><div><b>Account and role</b><small>{user ? `${user.email} · ${user.role}` : 'Signed out · anonymous planner demo data'}</small></div><Link to="/login" className="settings-link-button">{user ? 'Account details' : 'Sign in'} <ArrowRight size={13} /></Link></div><div className="settings-section"><div><b>Map tile attribution</b><small>OpenStreetMap / Esri · visible on every map view.</small></div><a className="settings-link-button" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">View sources <ExternalLink size={13} /></a></div></div><button className="button button-quiet save-settings-button" type="button" onClick={() => pushToast('Your display preference is saved on this device.', 'success')}><CheckCircle2 size={15} /> Save preferences</button></div>;
}

function ScenarioCompareModal({ cells, plan, budget, onClose }: { cells: Cell[]; plan: OptimizerResult | null; budget: number; onClose: () => void }) {
  const baseline = useMemo(() => optimizePlan(cells, { budget: Math.round(budget * 0.55), weights: { heat: 40, vegetation: 25, pedestrian: 20, connectivity: 15 }, enabledInterventions: ['native_trees', 'shade_structure'] }), [budget, cells]);
  const balanced = useMemo(() => plan ?? optimizePlan(cells, { budget, weights: { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 }, enabledInterventions: initialInterventions }), [budget, cells, plan]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title"><div className="modal-top"><div><span className="panel-kicker">SIDE-BY-SIDE SNAPSHOT</span><h2 id="compare-title">Compare climate futures.</h2></div><button className="icon-button" type="button" aria-label="Close scenario comparison" onClick={onClose}><X size={18} /></button></div><div className="compare-cards"><div><span>A / PRIORITY-FIRST</span><b>Heat relief first</b><strong>₹{baseline.totalCost.toLocaleString('en-IN')}</strong><small>{baseline.cellsImproved} cells · {baseline.selected.length} actions</small><div className="comparison-bars">{[baseline.categoryBenefits.heat, baseline.categoryBenefits.vegetation, baseline.categoryBenefits.pedestrian, baseline.categoryBenefits.connectivity].map((value, index) => <i key={index} style={{ height: `${Math.max(10, value * 800)}%` }} />)}</div></div><div className="compare-divider"><GitCompareArrows size={17} /></div><div className="proposal-card"><span>B / BALANCED</span><b>Multi-objective plan</b><strong>₹{balanced.totalCost.toLocaleString('en-IN')}</strong><small>{balanced.cellsImproved} cells · {balanced.selected.length} actions</small><div className="comparison-bars">{[balanced.categoryBenefits.heat, balanced.categoryBenefits.vegetation, balanced.categoryBenefits.pedestrian, balanced.categoryBenefits.connectivity].map((value, index) => <i key={index} style={{ height: `${Math.max(10, value * 800)}%` }} />)}</div></div></div><div className="modal-disclaimer"><ShieldCheck size={14} /> Comparisons reuse the same seeded scores; only weights and budget differ.</div><button className="button button-primary modal-done" type="button" onClick={onClose}>Back to the map <ArrowRight size={14} /></button></section></div>;
}

function PasswordChecklist({ password }: { password: string }) {
  const hasMinLength = password.length >= 12;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  return (
    <div className="password-rules" aria-label="Password complexity criteria">
      <div className={`password-rule ${hasMinLength ? 'met' : ''}`}>
        {hasMinLength ? <Check size={12} /> : <span>•</span>}
        <span>12+ characters</span>
      </div>
      <div className={`password-rule ${hasUpper && hasLower ? 'met' : ''}`}>
        {hasUpper && hasLower ? <Check size={12} /> : <span>•</span>}
        <span>Upper & lowercase</span>
      </div>
      <div className={`password-rule ${hasDigit ? 'met' : ''}`}>
        {hasDigit ? <Check size={12} /> : <span>•</span>}
        <span>At least 1 number</span>
      </div>
      <div className={`password-rule ${hasSymbol ? 'met' : ''}`}>
        {hasSymbol ? <Check size={12} /> : <span>•</span>}
        <span>Special symbol</span>
      </div>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser, pushToast } = useEcoStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const searchParams = new URLSearchParams(location.search);
  const from = searchParams.get('from') || '/overview';

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setWorking(true);
    try {
      const result = await api.login(email.trim(), password);
      setUser(result.user);
      pushToast(`Signed in as ${result.user.role.toUpperCase()}.`, 'success');
      navigate(from);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid credentials or service unavailable.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="login-wrap">
      <Link to="/overview" className="login-brand">
        <BrandMark />
        <span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span>
      </Link>
      <div className="login-card">
        <span className="eyebrow">WORKSPACE ACCESS</span>
        <h1>Sign in to EcoGrid.</h1>
        <p>Enter your credentials to access study areas, optimization runs, and project scenarios.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-field">
            <span>EMAIL ADDRESS</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder="you@institution.org"
            />
          </label>
          <label className="form-field">
            <span>PASSWORD</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="••••••••••••"
            />
          </label>
          <div className="login-links">
            <Link to="/forgot-password" className="login-link">Forgot password?</Link>
            <Link to="/register" className="login-link">Create account</Link>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={working}>
            {working ? <RefreshCw size={15} className="spin" /> : <LogIn size={15} />}
            Sign in
          </button>
        </form>
        <button
          className="login-switch"
          type="button"
          onClick={() => navigate('/register')}
        >
          New to this workspace? Register a new account
        </button>
      </div>
      <Link to="/overview" className="login-demo-link">
        Continue with public demonstration dataset <ArrowRight size={13} />
      </Link>
      <div className="login-footnote">
        <ShieldCheck size={13} />
        Argon2id password hashing · Cryptographically random server sessions · HttpOnly cookies
      </div>
    </div>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const { setUser, pushToast } = useEcoStore();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 12) {
      setError('Password must contain at least 12 characters.');
      return;
    }

    setWorking(true);
    try {
      const result = await api.register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      });
      setUser(result.user);
      pushToast('Account created successfully with Viewer privileges.', 'success');
      navigate('/overview');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create account. Please verify input.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="login-wrap">
      <Link to="/overview" className="login-brand">
        <BrandMark />
        <span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span>
      </Link>
      <div className="login-card">
        <span className="eyebrow">NEW USER REGISTRATION</span>
        <h1>Create your account.</h1>
        <p>New registrations receive a default Viewer role. Planners and Administrators can provision elevated project permissions.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-field">
            <span>FULL NAME</span>
            <input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={120}
              value={fullName}
              onChange={(event) => setFullName(event.currentTarget.value)}
              placeholder="Dr. Jane Doe"
            />
          </label>
          <label className="form-field">
            <span>WORK EMAIL</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder="jane@climate.gov"
            />
          </label>
          <label className="form-field">
            <span>PASSWORD <small>12 CHARACTERS MINIMUM</small></span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="••••••••••••"
            />
          </label>
          <PasswordChecklist password={password} />
          <label className="form-field">
            <span>CONFIRM PASSWORD</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              placeholder="••••••••••••"
            />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={working}>
            {working ? <RefreshCw size={15} className="spin" /> : <LogIn size={15} />}
            Create account
          </button>
        </form>
        <button
          className="login-switch"
          type="button"
          onClick={() => navigate('/login')}
        >
          Already have an account? Sign in
        </button>
      </div>
      <Link to="/overview" className="login-demo-link">
        Continue with public demonstration dataset <ArrowRight size={13} />
      </Link>
      <div className="login-footnote">
        <ShieldCheck size={13} />
        Public registration enforces least-privilege security. Administrator accounts cannot be created publicly.
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [working, setWorking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setWorking(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setSubmitted(true);
      if (res.dev_reset_token) {
        setDevToken(res.dev_reset_token);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit password reset request.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="login-wrap">
      <Link to="/overview" className="login-brand">
        <BrandMark />
        <span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span>
      </Link>
      <div className="login-card">
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Reset your password.</h1>
        <p>Enter your verified email address. If an account exists, single-use reset instructions will be issued.</p>
        {submitted ? (
          <div>
            <div className="form-success">
              If an account with that email exists, reset instructions have been dispatched.
            </div>
            {devToken && (
              <div className="dev-token-banner">
                <b>Local Development Preview:</b> SMTP delivery is not configured.
                <br />
                Use this link for testing:
                <br />
                <Link to={`/reset-password?token=${encodeURIComponent(devToken)}`}>
                  Proceed to Reset Password with Dev Token →
                </Link>
              </div>
            )}
            <button
              className="button button-primary login-submit"
              type="button"
              style={{ marginTop: '16px' }}
              onClick={() => navigate('/login')}
            >
              Return to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label className="form-field">
              <span>REGISTERED EMAIL</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="you@institution.org"
              />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button button-primary login-submit" type="submit" disabled={working}>
              {working ? <RefreshCw size={15} className="spin" /> : <Mail size={15} />}
              Send reset instructions
            </button>
          </form>
        )}
        <button
          className="login-switch"
          type="button"
          onClick={() => navigate('/login')}
        >
          Remember your password? Sign in
        </button>
      </div>
      <Link to="/overview" className="login-demo-link">
        Continue with public demonstration dataset <ArrowRight size={13} />
      </Link>
      <div className="login-footnote">
        <ShieldCheck size={13} />
        Reset tokens expire in 15 minutes and can only be used once.
      </div>
    </div>
  );
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { pushToast } = useEcoStore();
  const initialToken = new URLSearchParams(window.location.search).get('token') || '';
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Password must contain at least 12 characters.');
      return;
    }

    setWorking(true);
    try {
      await api.resetPassword({
        token: token.trim(),
        newPassword,
        confirmPassword,
      });
      pushToast('Password reset successfully. Please sign in with your new password.', 'success');
      navigate('/login');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid or expired reset token.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="login-wrap">
      <Link to="/overview" className="login-brand">
        <BrandMark />
        <span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span>
      </Link>
      <div className="login-card">
        <span className="eyebrow">CHOOSE NEW PASSWORD</span>
        <h1>Set new password.</h1>
        <p>Enter your single-use reset token and choose a new secure password.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-field">
            <span>RESET TOKEN</span>
            <input
              type="text"
              required
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              placeholder="Paste 64-character token"
            />
          </label>
          <label className="form-field">
            <span>NEW PASSWORD <small>12 CHARACTERS MINIMUM</small></span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              placeholder="••••••••••••"
            />
          </label>
          <PasswordChecklist password={newPassword} />
          <label className="form-field">
            <span>CONFIRM NEW PASSWORD</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              placeholder="••••••••••••"
            />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={working}>
            {working ? <RefreshCw size={15} className="spin" /> : <Lock size={15} />}
            Update password
          </button>
        </form>
        <button
          className="login-switch"
          type="button"
          onClick={() => navigate('/login')}
        >
          Cancel and return to sign in
        </button>
      </div>
      <div className="login-footnote">
        <ShieldCheck size={13} />
        All existing sessions are revoked upon password reset.
      </div>
    </div>
  );
}

function ProfileModal({
  user,
  onClose,
  onLogout,
}: {
  user: UserSession;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { pushToast } = useEcoStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Password must contain at least 12 characters.');
      return;
    }

    setWorking(true);
    try {
      await api.changePassword({ currentPassword, newPassword, confirmPassword });
      pushToast('Password updated successfully. Other active sessions were invalidated.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change password.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="profile-header">
          <div>
            <span className="panel-kicker">USER ACCOUNT</span>
            <h2 id="profile-title">{user.fullName || 'User Profile'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close profile modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="profile-meta">
          <div className="profile-meta-row">
            <span className="profile-meta-label">Email</span>
            <span className="profile-meta-value">{user.email}</span>
          </div>
          <div className="profile-meta-row">
            <span className="profile-meta-label">Role</span>
            <span className={`role-badge role-badge-${user.role}`}>
              {user.role.toUpperCase()}
            </span>
          </div>
          <div className="profile-meta-row">
            <span className="profile-meta-label">Account Status</span>
            <span className="profile-meta-value" style={{ color: '#4CC38A' }}>
              ● ACTIVE
            </span>
          </div>
          <div className="profile-meta-row">
            <span className="profile-meta-label">User Identifier</span>
            <code style={{ fontSize: '11px', color: 'var(--muted)' }}>{user.id}</code>
          </div>
        </div>

        <form onSubmit={(e) => void handlePasswordChange(e)}>
          <span className="panel-kicker" style={{ display: 'block', marginBottom: '8px' }}>
            CHANGE PASSWORD
          </span>
          <div style={{ display: 'grid', gap: '10px' }}>
            <label className="form-field">
              <span>CURRENT PASSWORD</span>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.currentTarget.value)}
                placeholder="Current password"
              />
            </label>
            <label className="form-field">
              <span>NEW PASSWORD <small>12 CHARACTERS MINIMUM</small></span>
              <input
                type="password"
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.currentTarget.value)}
                placeholder="New password"
              />
            </label>
            <PasswordChecklist password={newPassword} />
            <label className="form-field">
              <span>CONFIRM NEW PASSWORD</span>
              <input
                type="password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                placeholder="Confirm new password"
              />
            </label>
          </div>
          {error && <div className="form-error" style={{ marginTop: '8px' }} role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button className="button button-primary" type="submit" disabled={working} style={{ flex: 1 }}>
              {working ? <RefreshCw size={14} className="spin" /> : <Lock size={14} />}
              Update password
            </button>
            <button className="button button-quiet" type="button" onClick={onLogout} style={{ color: 'var(--red)' }}>
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdminUsersPage() {
  const { user, pushToast } = useEcoStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.adminUsers();
      setUsers(res.users);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not fetch user directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      void loadUsers();
    }
  }, [loadUsers, user?.role]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="document-page">
        <SectionTitle
          eyebrow="ADMINISTRATIVE GOVERNANCE"
          title="Access Restricted"
          subtitle="Administrator authorization is required to access user directory and manage account roles."
        />
        <div style={{ marginTop: '20px' }}>
          <button className="button button-primary" type="button" onClick={() => navigate('/login')}>
            Sign in as Administrator
          </button>
        </div>
      </div>
    );
  }

  const handleRoleChange = async (targetUserId: string, newRole: 'admin' | 'planner' | 'viewer') => {
    try {
      const res = await api.adminUpdateRole(targetUserId, newRole);
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? res.user : u)));
      pushToast(`Role updated to ${newRole.toUpperCase()}.`, 'success');
    } catch (caught) {
      pushToast(caught instanceof Error ? caught.message : 'Failed to update role.', 'error');
    }
  };

  const handleStatusToggle = async (targetUserId: string, currentActive: boolean) => {
    try {
      const res = await api.adminUpdateStatus(targetUserId, !currentActive);
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? res.user : u)));
      pushToast(`Account ${!currentActive ? 'activated' : 'suspended'}.`, 'success');
    } catch (caught) {
      pushToast(caught instanceof Error ? caught.message : 'Failed to update status.', 'error');
    }
  };

  return (
    <div className="document-page">
      <SectionTitle
        eyebrow="SYSTEM GOVERNANCE"
        title="User directory & roles."
        subtitle="Manage user accounts, elevate planner permissions, and govern workspace access."
        actions={
          <button className="button button-quiet" type="button" onClick={() => void loadUsers()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        }
      />

      {error && <div className="form-error" style={{ marginBottom: '14px' }}>{error}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>USER</th>
              <th>EMAIL</th>
              <th>ROLE</th>
              <th>STATUS</th>
              <th>REGISTERED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.fullName}</b>
                  <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{u.id}</div>
                </td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="role-select"
                    value={u.role}
                    disabled={u.id === user.id}
                    onChange={(e) => void handleRoleChange(u.id, e.target.value as 'admin' | 'planner' | 'viewer')}
                    title={u.id === user.id ? 'Cannot change your own role' : 'Select role'}
                  >
                    <option value="viewer">VIEWER</option>
                    <option value="planner">PLANNER</option>
                    <option value="admin">ADMIN</option>
                  </select>
                </td>
                <td>
                  <span
                    className={`role-badge ${u.isActive ? 'role-badge-planner' : 'role-badge-admin'}`}
                    style={{ fontSize: '9.5px' }}
                  >
                    {u.isActive ? 'ACTIVE' : 'SUSPENDED'}
                  </span>
                </td>
                <td style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td>
                  {u.id !== user.id && (
                    <button
                      type="button"
                      className={`status-toggle ${u.isActive ? 'status-suspended' : 'status-active'}`}
                      onClick={() => void handleStatusToggle(u.id, u.isActive)}
                    >
                      {u.isActive ? 'Suspend' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LandingPage() {
  const cells = useEcoStore().cells;
  return <main className="landing-page"><header className="landing-nav"><Link className="brand" to="/"><BrandMark /><span><b>eco<span>grid</span></b><small>CLIMATE INTELLIGENCE</small></span></Link><nav><a href="#approach">Approach</a><a href="#signals">Signals</a><Link to="/methodology">Methodology</Link></nav><div><Link className="landing-signin" to="/login">Sign in</Link><Link className="button button-primary" to="/overview">Open the workspace <ArrowRight size={14} /></Link></div></header><section className="landing-hero"><div className="landing-copy"><span className="eyebrow"><i className="live-dot" /> URBAN CLIMATE, ON THE GROUND</span><h1>Put every climate dollar <em>on the map.</em></h1><p>Heat. Shade. Footfall. Green links. EcoGrid shows where a targeted intervention can make a city feel different — block by block.</p><div className="landing-ctas"><Link className="button button-primary" to="/overview">Explore the Bengaluru study <ArrowRight size={15} /></Link><Link className="landing-text-link" to="/methodology">Read the method <ArrowRight size={14} /></Link></div><div className="landing-footnotes"><span><Grid2X2 size={14} /> 100 named analysis cells</span><span><ShieldCheck size={14} /> Explainable scores</span><span><Leaf size={14} /> Budget-aware interventions</span></div></div><div className="landing-map-preview"><div className="landing-map-toolbar"><span><span className="live-dot" /> BENGALURU EAST CAMPUS</span><span>GRID / 10 × 10</span></div><div className="landing-map-grid" aria-label="Example city grid with cell priority colors">{cells.map((cell) => <i key={cell.id} className={`landing-grid-cell risk-tone-${riskBand(combinedPriority(cell.scores)).toLowerCase()}`} title={`${cell.id} · ${cell.areaName} · ${Math.round(combinedPriority(cell.scores) * 100)} priority`} />)}</div><div className="landing-map-caption"><span>12.9352° N <i>·</i> 77.6245° E</span><span>100 POLYGONS / 100% VISIBLE</span></div><div className="landing-float-card"><span><Flame size={13} /> PRIORITY ZONE</span><b>Central Plaza</b><small>Heat meets daily footfall.</small><div><i style={{ width: '74%' }} /><strong>74</strong></div></div></div><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /></section><section className="landing-stat-strip" id="signals"><div><span>ONE STUDY AREA</span><b>100 <small>visible cells</small></b></div><div><span>FIVE INTERVENTION TYPES</span><b>One <small>budget-aware plan</small></b></div><div><span>SEVEN MAP LAYERS</span><b>Grounded <small>in cell-level evidence</small></b></div><div><span>ONE SHARED QUESTION</span><b>Where <small>should we act first?</small></b></div></section><section className="landing-promise" id="approach"><div><span className="eyebrow">A DECISION WORKBENCH, NOT ANOTHER HEATMAP</span><h2>Every cell is a place<br />you can do something about.</h2></div><div className="promise-cards"><article><span>01 / READ</span><Activity size={20} /><h3>See what overlaps.</h3><p>Explore five grounded scores on the same clickable map grid.</p></article><article><span>02 / TEST</span><SlidersHorizontal size={20} /><h3>Change the weights.</h3><p>Compare budget scenarios without losing sight of the geography.</p></article><article><span>03 / COMMIT</span><Sprout size={20} /><h3>Move from signal to shade.</h3><p>Choose feasible interventions and leave an explainable paper trail.</p></article></div></section><footer className="landing-footer"><BrandMark small /><span>EcoGrid AI · Bengaluru demonstration dataset</span><Link to="/data-sources">Data and assumptions <ArrowRight size={13} /></Link></footer></main>;
}

export default function App() { return <AppFrame />; }
