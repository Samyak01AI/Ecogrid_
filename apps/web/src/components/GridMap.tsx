import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  DEFAULT_STUDY,
  INTERVENTIONS,
  combinedPriority,
  layoutInterventionsForMap,
  layerScore,
  riskBand,
  type Cell,
  type ConnectivityResult,
  type InterventionId,
  type LayerKey,
  type OptimizerResult,
  type ScoreWeights,
} from '@ecogrid/domain';
import { Activity, Crosshair, Expand, Layers3, Map as MapIcon, Minus, Plus, Satellite, Shrink, Target } from 'lucide-react';
import { StoreContext } from '../store-context.js';
import {
  FullscreenWorkspaceTopBar,
  type MapInteractionMode,
} from './FullscreenWorkspace/FullscreenWorkspaceTopBar.js';
import { FullscreenKPIStrip } from './FullscreenWorkspace/FullscreenKPIStrip.js';
import {
  FullscreenPlanningToolbar,
  type FullscreenPanelKey,
} from './FullscreenWorkspace/FullscreenPlanningToolbar.js';
import {
  FullscreenPlanningPanelContainer,
  FullscreenKPIView,
  FullscreenInterventionsView,
  FullscreenBudgetView,
  FullscreenOptimizeView,
  FullscreenCellInspectorView,
  FullscreenLayersView,
} from './FullscreenWorkspace/FullscreenPlanningPanels.js';
import { FullscreenErrorBoundary } from './FullscreenWorkspace/FullscreenErrorBoundary.js';
import './FullscreenWorkspace/fullscreenWorkspace.css';

type BaseMap = 'light' | 'satellite' | 'dark';
type Props = {
  cells: readonly Cell[];
  selectedCell: string | null;
  selectedCells: readonly string[];
  onSelectCell: (cellId: string, additive: boolean) => void;
  onSelectCells: (cellIds: string[]) => void;
  layer: LayerKey;
  onLayerChange: (layer: LayerKey) => void;
  plan: OptimizerResult | null;
  connectivity?: ConnectivityResult | null;
  opacity: number;
  showOutlines: boolean;
  onOpacityChange: (value: number) => void;
  onOutlineToggle: () => void;
  originPicker?: { position: readonly [number, number]; onChange: (latitude: number, longitude: number) => void };
  scenarioComparison?: { baseline: OptimizerResult; proposal: OptimizerResult } | null;
  compact?: boolean;
  syncGroup?: string;
};

const LAYERS: { key: LayerKey; label: string; short: string }[] = [
  { key: 'priority', label: 'Combined priority', short: 'Priority' },
  { key: 'heat', label: 'Heat risk', short: 'Heat' },
  { key: 'vegetation', label: 'Vegetation deficit', short: 'Vegetation' },
  { key: 'pedestrian', label: 'Pedestrian exposure', short: 'Pedestrian' },
  { key: 'connectivity', label: 'Connectivity need', short: 'Connectivity' },
  { key: 'feasibility', label: 'Intervention feasibility', short: 'Feasibility' },
  { key: 'recommended', label: 'Recommended plan', short: 'Plan' },
];
const RISK_COLORS = { LOW: '#7E9C8E', MODERATE: '#4CC38A', HIGH: '#F3B44E', CRITICAL: '#E35D5D' } as const;
const originMarkerIcon = L.divIcon({ className: 'study-origin-marker', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
const BASEMAPS: Record<BaseMap, { label: string; url: string; attribution: string }> = {
  light: { label: 'Light', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
  dark: { label: 'Dark', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
};
const INTERVENTION_BY_ID = new Map(INTERVENTIONS.map((intervention) => [intervention.id, intervention] as const));
const MARKER_GLYPHS: Record<InterventionId, string> = {
  native_trees: '♧',
  shade_structure: '☂',
  pollinator_corridor: '✿',
  green_buffer: '❧',
  cool_surface: '☀',
};

function cellColor(cell: Cell, layer: LayerKey, deltaView: boolean, deltaBenefit: number): string {
  if (deltaView) return Math.abs(deltaBenefit) < 0.0001 ? '#72887E' : deltaBenefit > 0 ? '#4CC38A' : '#E35D5D';
  if (layer === 'recommended') return RISK_COLORS.LOW;
  const score = layerScore(cell, layer);
  return RISK_COLORS[riskBand(score)];
}

function ResizeAndFit({ bounds }: { bounds: L.LatLngBoundsExpression }): null {
  const map = useMap();
  const boundsKey = JSON.stringify(bounds);
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => { map.invalidateSize({ pan: false, debounceMoveend: true }); });
    observer.observe(container);
    map.invalidateSize({ pan: false, debounceMoveend: true });
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    const zoom = Number(params.get('zoom'));
    const frame = window.requestAnimationFrame(() => {
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(zoom) && zoom >= 2 && zoom <= 20) map.setView([lat, lng], zoom, { animate: false });
      else map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: false });
    });
    const handleCenter = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number; zoom?: number }>).detail;
      if (detail && Number.isFinite(detail.lat) && Number.isFinite(detail.lng)) {
        map.setView([detail.lat, detail.lng], detail.zoom ?? 18, { animate: true });
      }
    };
    const handleReset = () => {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: true });
    };
    window.addEventListener('ecogrid-center-map', handleCenter);
    window.addEventListener('ecogrid-reset-map', handleReset);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('ecogrid-center-map', handleCenter);
      window.removeEventListener('ecogrid-reset-map', handleReset);
    };
  }, [bounds, boundsKey, map]);
  return null;
}

function MapLayoutInvalidator({
  isFullscreen,
  activePanel,
}: {
  isFullscreen: boolean;
  activePanel: FullscreenPanelKey | null;
}): null {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => {
      try {
        map.invalidateSize({ pan: false, debounceMoveend: true });
      } catch {
        // map container might be detaching
      }
    };

    const t1 = window.setTimeout(invalidate, 80);
    const t2 = window.setTimeout(invalidate, 260);
    const t3 = window.setTimeout(invalidate, 450);

    const onResize = () => invalidate();
    window.addEventListener('resize', onResize);
    window.addEventListener('ecogrid-invalidate-map-size', onResize);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('ecogrid-invalidate-map-size', onResize);
    };
  }, [map, isFullscreen, activePanel]);
  return null;
}

function MapSyncBridge({ group }: { group: string }): null {
  const map = useMap();
  useEffect(() => {
    const name = `ecogrid-map-sync:${group}`;
    const source = map.getContainer();
    const send = () => {
      const center = map.getCenter();
      window.dispatchEvent(new CustomEvent(name, { detail: { source, center: [center.lat, center.lng], zoom: map.getZoom() } }));
    };
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ source: HTMLElement; center: [number, number]; zoom: number }>).detail;
      if (!detail || detail.source === source) return;
      const center = map.getCenter();
      if (Math.abs(center.lat - detail.center[0]) < 0.000001 && Math.abs(center.lng - detail.center[1]) < 0.000001 && map.getZoom() === detail.zoom) return;
      map.setView(detail.center, detail.zoom, { animate: false });
    };
    map.on('moveend', send);
    window.addEventListener(name, receive);
    return () => { map.off('moveend', send); window.removeEventListener(name, receive); };
  }, [group, map]);
  return null;
}

function MapSignals({ onCoordinate }: { onCoordinate: (coordinate: string) => void }): null {
  useMapEvents({ mousemove(event) { onCoordinate(`${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`); } });
  return null;
}

function DynamicScaleControl(): null {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({ position: 'bottomleft', maxWidth: 92, metric: true, imperial: true, updateWhenIdle: true });
    control.addTo(map);
    return () => { control.remove(); };
  }, [map]);
  return null;
}

function GeographicMiniMap({ baseMap }: { baseMap: BaseMap }): null {
  const map = useMap();
  useEffect(() => {
    let overviewMap: L.Map | null = null;
    let viewport: L.Rectangle | null = null;
    const synchronize = () => {
      if (!overviewMap || !viewport) return;
      overviewMap.setView(map.getCenter(), Math.max(2, map.getZoom() - 5), { animate: false });
      viewport.setBounds(map.getBounds());
    };
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-control map-minimap-control');
      const mapContainer = L.DomUtil.create('div', 'map-minimap-map', container);
      mapContainer.setAttribute('role', 'img');
      mapContainer.setAttribute('aria-label', 'Geographic overview. Click a location to recenter the main map.');
      const attribution = L.DomUtil.create('span', 'map-minimap-attribution', container);
      attribution.textContent = baseMap === 'satellite' ? 'Tiles © Esri' : '© OpenStreetMap contributors';
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      const overview = L.map(mapContainer, { attributionControl: false, zoomControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
      overviewMap = overview;
      L.tileLayer(BASEMAPS[baseMap].url, { maxZoom: 19, attribution: BASEMAPS[baseMap].attribution }).addTo(overview);
      const extent = L.rectangle(map.getBounds(), { color: '#B7F7D0', weight: 1.5, opacity: 1, fillColor: '#4CC38A', fillOpacity: 0.14, interactive: false, className: 'map-minimap-viewport' });
      viewport = extent;
      extent.addTo(overview);
      overview.on('click', (event) => map.setView(event.latlng, map.getZoom(), { animate: true }));
      window.requestAnimationFrame(() => { overview.invalidateSize({ pan: false }); synchronize(); });
      return container;
    };
    control.addTo(map);
    map.on('moveend zoomend resize', synchronize);
    synchronize();
    return () => {
      map.off('moveend zoomend resize', synchronize);
      overviewMap?.remove();
      overviewMap = null;
      viewport = null;
      control.remove();
    };
  }, [map, baseMap]);
  return null;
}

function MarkerFilterControl({ compact, activeTypes, count, total, open, onToggleOpen, onToggleType }: {
  compact: boolean;
  activeTypes: ReadonlySet<InterventionId>;
  count: number;
  total: number;
  open: boolean;
  onToggleOpen: () => void;
  onToggleType: (id: InterventionId) => void;
}) {
  if (!total) return null;
  return <div className={`map-marker-filter${compact ? ' map-marker-filter-compact' : ''}`}>
    <button className={`map-tool-button ${open ? 'is-active' : ''}`} type="button" aria-label="Filter intervention markers" aria-expanded={open} onClick={onToggleOpen}><Layers3 size={14} /><span>Markers {count}/{total}</span></button>
    {open && <div className="map-marker-filter-popover" role="group" aria-label="Filter intervention types">
      <span className="marker-filter-heading">SHOW PLAN TYPES</span>
      {INTERVENTIONS.map((item) => <label className="marker-filter-option" key={item.id}>
        <input type="checkbox" value={item.id} aria-label={`Show ${item.shortName}`} checked={activeTypes.has(item.id)} onChange={() => onToggleType(item.id)} />
        <i className="marker-filter-swatch" style={{ backgroundColor: item.markerColor }}>{MARKER_GLYPHS[item.id]}</i>
        <span>{item.shortName}</span>
      </label>)}
    </div>}
  </div>;
}

function CellPolygon({ cell, selected, layer, opacity, outlines, planActive, deltaView, deltaBenefit, onSelect }: {
  cell: Cell; selected: boolean; layer: LayerKey; opacity: number; outlines: boolean; planActive: boolean; deltaView: boolean; deltaBenefit: number; onSelect: (cellId: string, additive: boolean) => void;
}) {
  const pathRef = useRef<L.Polygon | null>(null);
  const assignPath = useCallback((shape: L.Polygon | null) => {
    pathRef.current = shape;
    shape?.getElement()?.setAttribute('data-cell-id', cell.id);
    if (selected) shape?.bringToFront();
  }, [cell.id, selected]);
  const neutralPlan = !deltaView && layer === 'recommended' && !planActive;
  const fill = neutralPlan ? '#183932' : cellColor(cell, layer, deltaView, deltaBenefit);
  const style = useMemo<L.PathOptions>(() => ({
    color: selected ? '#B7F7D0' : outlines ? '#E8F7ED' : fill,
    weight: selected ? 3 : outlines ? 1 : 0.4,
    opacity: selected ? 1 : outlines ? 0.60 : 0.18,
    fillColor: fill,
    fillOpacity: Math.max(0.08, Math.min(0.82, opacity)),
    lineCap: 'round',
    lineJoin: 'round',
    bubblingMouseEvents: false,
    className: 'ecogrid-cell',
  }), [fill, opacity, outlines, selected]);
  const positions = useMemo(() => cell.polygon.map(([lat, lng]) => [lat, lng] as [number, number]), [cell.polygon]);
  useEffect(() => { if (selected) pathRef.current?.bringToFront(); }, [selected]);
  return (
    <Polygon
      ref={assignPath}
      positions={positions}
      pathOptions={style}
      eventHandlers={{
        click: (event) => {
          L.DomEvent.stopPropagation(event);
          onSelect(cell.id, Boolean((event.originalEvent as MouseEvent).shiftKey));
        },
      }}
    />
  );
}

function BoxSelect({ cells, onSelectCells }: { cells: readonly Cell[]; onSelectCells: (cellIds: string[]) => void }): null {
  const map = useMap();
  const active = useRef<{ origin: L.LatLng; rectangle: L.Rectangle } | null>(null);
  const moved = useRef(false);
  useMapEvents({
    mousedown(event) {
      if (!event.originalEvent.shiftKey) return;
      map.dragging.disable();
      moved.current = false;
      const origin = event.latlng;
      const rectangle = L.rectangle(L.latLngBounds(origin, origin), { color: '#B7F7D0', weight: 1.5, fillOpacity: 0.18, dashArray: '4 4' }).addTo(map);
      active.current = { origin, rectangle };
    },
    mousemove(event) {
      const selection = active.current;
      if (!selection) return;
      moved.current = true;
      selection.rectangle.setBounds(L.latLngBounds(selection.origin, event.latlng));
    },
    mouseup(event) {
      const selection = active.current;
      if (!selection) return;
      selection.rectangle.remove();
      active.current = null;
      map.dragging.enable();
      if (!moved.current) return;
      const bounds = L.latLngBounds(selection.origin, event.latlng);
      const ids = cells.filter((cell) => bounds.contains(L.latLng(cell.center[0], cell.center[1]))).map((cell) => cell.id);
      if (ids.length) onSelectCells(ids);
    },
    click(event) {
      if (moved.current) {
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        moved.current = false;
      }
    },
  });
  useEffect(() => () => { active.current?.rectangle.remove(); if (active.current) map.dragging.enable(); }, [map]);
  return null;
}

export default function GridMap({
  cells,
  selectedCell,
  selectedCells,
  onSelectCell,
  onSelectCells,
  layer,
  onLayerChange,
  plan,
  connectivity,
  opacity,
  showOutlines,
  onOpacityChange,
  onOutlineToggle,
  originPicker,
  scenarioComparison,
  compact = false,
  syncGroup,
}: Props) {
  const store = useContext(StoreContext);
  const shellRef = useRef<HTMLElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState<FullscreenPanelKey | null>(null);

  const [baseMap, setBaseMap] = useState<BaseMap>(() => {
    try {
      const fromUrl = new URLSearchParams(location.search).get('basemap');
      const saved = localStorage.getItem('ecogrid-basemap');
      const value = fromUrl ?? saved;
      return value === 'satellite' || value === 'dark' ? value : 'light';
    } catch {
      return 'light';
    }
  });
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [deltaView, setDeltaView] = useState(false);
  const [coordinate, setCoordinate] = useState('12.94080, 77.63120');
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [markerFiltersOpen, setMarkerFiltersOpen] = useState(false);
  const [visibleMarkerTypes, setVisibleMarkerTypes] = useState<Set<InterventionId>>(
    () => new Set(INTERVENTIONS.map((item) => item.id))
  );
  const [locateError, setLocateError] = useState(false);
  const [interactionMode, setInteractionMode] = useState<MapInteractionMode>('explore');
  const [isDrawerPinned, setIsDrawerPinned] = useState(false);

  // Sync state with store if available
  const effectivePlan = plan ?? store?.plan ?? null;
  const effectiveBudget = store?.budget ?? 500000;
  const effectiveWeights = store?.weights ?? { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };
  const effectiveStudyId = store?.activeStudyId ?? DEFAULT_STUDY.id;
  const activeStudy = store?.studies.find((s) => s.id === effectiveStudyId) ?? store?.studies[0] ?? {
    ...DEFAULT_STUDY,
    cellCount: cells.length,
  };

  const selectedCellObj = useMemo(() => {
    return selectedCell ? cells.find((c) => c.id === selectedCell) ?? null : null;
  }, [cells, selectedCell]);

  const isRealData = useMemo(() => {
    return (
      cells.length > 0 &&
      cells.some((c) => {
        const meta = c as unknown as { dataStatus?: string; dataSource?: string; dataLabel?: string };
        return (
          meta.dataStatus === 'validated' ||
          meta.dataSource === 'satellite' ||
          String(meta.dataLabel ?? '').includes('MEASURED') ||
          String(meta.dataLabel ?? '').includes('REAL')
        );
      })
    );
  }, [cells]);

  const avgPriorityScore = useMemo(() => {
    if (!cells.length) return 50;
    const sum = cells.reduce((acc, c) => acc + combinedPriority(c.scores), 0);
    return Math.round((sum / cells.length) * 100);
  }, [cells]);

  const isBudgetOutdated = useMemo(() => {
    if (!effectivePlan) return false;
    const p = effectivePlan as unknown as { budget?: number };
    return p.budget !== undefined && p.budget !== effectiveBudget;
  }, [effectivePlan, effectiveBudget]);

  // Fullscreen management
  const enterFullscreen = useCallback(async () => {
    try {
      const el = shellRef.current;
      if (el && !document.fullscreenElement && el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {
      // Fallback to CSS expanded layout
    }
    setIsFullscreen(true);
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
    setIsFullscreen(false);
    setActivePanel(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) void exitFullscreen();
    else void enterFullscreen();
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Sync fullscreenchange event
  useEffect(() => {
    const onFullscreenChange = () => {
      const isDocFull = Boolean(
        document.fullscreenElement &&
          shellRef.current &&
          (document.fullscreenElement === shellRef.current || shellRef.current.contains(document.fullscreenElement))
      );
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        setActivePanel(null);
      } else if (isDocFull) {
        setIsFullscreen(true);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Keyboard Escape management: Escape closes active panel first without exiting fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activePanel !== null) {
          e.preventDefault();
          e.stopPropagation();
          setActivePanel(null);
        } else {
          void exitFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isFullscreen, activePanel, exitFullscreen]);

  const centerMap = useCallback((lat: number, lng: number) => {
    window.dispatchEvent(
      new CustomEvent('ecogrid-center-map', {
        detail: { lat, lng, zoom: 17 },
      })
    );
  }, []);

  const handleSetBudget = useCallback((b: number) => {
    if (store?.setBudget) store.setBudget(b);
  }, [store]);

  const handleSetWeights = useCallback((w: ScoreWeights) => {
    if (store?.setWeights) store.setWeights(w);
  }, [store]);

  const handleSetPlan = useCallback((p: OptimizerResult) => {
    if (store?.setPlan) store.setPlan(p);
  }, [store]);

  const mapBounds = useMemo(
    () => L.latLngBounds(cells.flatMap((cell) => cell.polygon.map(([latitude, longitude]) => L.latLng(latitude, longitude)))),
    [cells]
  );
  const boundsArray = useMemo(() => mapBounds.toBBoxString(), [mapBounds]);
  const activeLayer = BASEMAPS[baseMap];
  const cellsById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell] as const)), [cells]);

  const planByCell = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const candidate of effectivePlan?.selected ?? []) {
      if (candidate.studyAreaId && candidate.studyAreaId !== effectiveStudyId) continue;
      if (!cellsById.has(candidate.cellId)) continue;
      map.set(candidate.cellId, [...(map.get(candidate.cellId) ?? []), candidate.interventionName]);
    }
    return map;
  }, [cellsById, effectivePlan, effectiveStudyId]);

  const overallModeledBenefit = useMemo(() => {
    if (!effectivePlan?.selected) return 0;
    return effectivePlan.selected.reduce((acc, c) => acc + (c.combinedBenefit ?? 0), 0);
  }, [effectivePlan]);

  const handleCellClick = useCallback(
    (cellId: string, additive: boolean) => {
      onSelectCell(cellId, additive);
      if (isFullscreen) {
        if (interactionMode === 'inspect') {
          setActivePanel('inspector');
        } else if (interactionMode === 'plan') {
          if (planByCell.has(cellId)) {
            setActivePanel('interventions');
          } else {
            setActivePanel('inspector');
          }
        } else if (isDrawerPinned) {
          if (activePanel === null) {
            setActivePanel('inspector');
          }
        }
      }
    },
    [activePanel, interactionMode, isDrawerPinned, isFullscreen, onSelectCell, planByCell]
  );

  const planMarkers = useMemo(() => {
    if (deltaView) return [];

    const { markers, failures } = layoutInterventionsForMap({
      plan: effectivePlan,
      activeStudyId: effectiveStudyId,
      activeGridVersion: '2.0',
      cellsById,
      visibleMarkerTypes,
    });

    if (failures.length > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(
        `[EcoGrid GIS] Discarded ${failures.length} invalid or misaligned intervention marker(s):`,
        failures.map((f) => f.reason)
      );
    }

    return markers.map(({ cellId, cell, candidate, position, indexInCell, totalInCell }) => {
      const intervention = INTERVENTION_BY_ID.get(candidate.interventionId);
      const markerColor = intervention?.markerColor ?? '#4cc38a';
      const glyph = MARKER_GLYPHS[candidate.interventionId] ?? '★';

      const icon = L.divIcon({
        className: `ecogrid-intervention-marker ${selectedCell === cellId ? 'is-selected' : ''}`,
        html: `<span class="intervention-marker-glyph" data-intervention-id="${candidate.interventionId}" style="--marker-color:${markerColor};--marker-delay:${Math.min(indexInCell, 8) * 40}ms" aria-hidden="true">${glyph}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      return {
        key: `${cellId}-${candidate.interventionId}-${indexInCell}`,
        cellId,
        candidate,
        cell,
        position: [position[0], position[1]] as [number, number],
        indexInCell,
        totalInCell,
        icon,
      };
    });
  }, [cellsById, deltaView, effectivePlan, effectiveStudyId, selectedCell, visibleMarkerTypes]);

  const deltaByCell = useMemo(() => {
    const delta = new Map<string, number>();
    for (const candidate of scenarioComparison?.baseline.selected ?? []) {
      delta.set(candidate.cellId, (delta.get(candidate.cellId) ?? 0) - candidate.combinedBenefit);
    }
    for (const candidate of scenarioComparison?.proposal.selected ?? []) {
      delta.set(candidate.cellId, (delta.get(candidate.cellId) ?? 0) + candidate.combinedBenefit);
    }
    return delta;
  }, [scenarioComparison]);

  const componentColors = useMemo(
    () => new Map(connectivity?.components.flatMap((component) => component.cellIds.map((cellId) => [cellId, component.color] as const)) ?? []),
    [connectivity]
  );
  const planLinks = useMemo(() => connectivity?.links ?? [], [connectivity]);

  const resetMap = useCallback(() => {
    const mapElement = document.querySelector('.grid-map-container');
    if (mapElement) mapElement.dispatchEvent(new CustomEvent('ecogrid-reset-map'));
  }, []);

  const locate = useCallback(() => {
    setLocateError(false);
    if (!navigator.geolocation) {
      setLocateError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const target = document.querySelector('.grid-map-container');
        target?.dispatchEvent(
          new CustomEvent('ecogrid-center-map', {
            detail: { lat: position.coords.latitude, lng: position.coords.longitude },
          })
        );
      },
      () => setLocateError(true),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const toggleMarkerType = useCallback((id: InterventionId) => {
    setVisibleMarkerTypes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleMarkerFilters = useCallback(() => {
    setMarkerFiltersOpen((open) => !open);
    setMiniMapOpen(false);
  }, []);

  const selectedLayerLabel = deltaView
    ? 'Scenario delta'
    : LAYERS.find((item) => item.key === layer)?.label ?? 'Combined priority';

  useEffect(() => {
    if (!scenarioComparison) setDeltaView(false);
  }, [scenarioComparison]);

  useEffect(() => {
    try {
      localStorage.setItem('ecogrid-basemap', baseMap);
    } catch {
      /* Storage can be disabled by the browser. */
    }
    const params = new URLSearchParams(window.location.search);
    if (baseMap === 'light') params.delete('basemap');
    else params.set('basemap', baseMap);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [baseMap]);

  useEffect(() => {
    const container = document.querySelector('.grid-map-container');
    if (!container) return;
    const onCenter = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      if (detail) window.dispatchEvent(new CustomEvent('ecogrid-map-center-request', { detail }));
    };
    container.addEventListener('ecogrid-center-map', onCenter);
    return () => container.removeEventListener('ecogrid-center-map', onCenter);
  }, []);

  return (
    <section
      ref={shellRef}
      className={`map-shell ${isFullscreen ? 'is-fullscreen fullscreen-workspace' : ''}`}
      aria-label="Interactive climate analysis grid"
    >
      {/* Fullscreen Workspace Topbar */}
      {isFullscreen && !compact && (
        <FullscreenWorkspaceTopBar
          studyName={activeStudy?.name ?? 'Study Area'}
          gridRows={activeStudy?.rows ?? 10}
          gridCols={activeStudy?.columns ?? 10}
          cellCount={cells.length}
          origin={activeStudy?.origin ?? [12.9352, 77.6245]}
          coordinate={coordinate}
          layer={layer}
          baseMap={baseMap}
          onBaseMapToggle={() => setBaseMap((value) => (value === 'light' ? 'satellite' : value === 'satellite' ? 'dark' : 'light'))}
          showOutlines={showOutlines}
          onOutlineToggle={onOutlineToggle}
          onResetView={resetMap}
          onLocate={locate}
          onExitFullscreen={() => void exitFullscreen()}
          isRealData={isRealData}
          interactionMode={interactionMode}
          onInteractionModeChange={setInteractionMode}
        />
      )}

      {/* Non-fullscreen standard controls */}
      {!compact && !isFullscreen && (
        <div className="map-top-controls">
          <div className="map-layer-control">
            <button
              className={`map-tool-button ${showLayerMenu ? 'is-active' : ''}`}
              type="button"
              aria-label="Choose map layer"
              aria-expanded={showLayerMenu}
              onClick={() => setShowLayerMenu((value) => !value)}
            >
              <Layers3 size={16} />
              <span>{deltaView ? 'Delta' : LAYERS.find((item) => item.key === layer)?.short ?? 'Layer'}</span>
            </button>
            {showLayerMenu && (
              <div className="layer-popover" role="menu" aria-label="Map layers">
                {LAYERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!deltaView && layer === item.key}
                    onClick={() => {
                      setDeltaView(false);
                      onLayerChange(item.key);
                      setShowLayerMenu(false);
                    }}
                  >
                    <span className={`layer-swatch swatch-${item.key}`} />
                    {item.label}
                    {!deltaView && layer === item.key && <span className="layer-check">✓</span>}
                  </button>
                ))}
                {scenarioComparison && (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={deltaView}
                    onClick={() => {
                      setDeltaView(true);
                      setShowLayerMenu(false);
                    }}
                  >
                    <span className="layer-swatch swatch-scenario-delta" />
                    Scenario delta
                    {deltaView && <span className="layer-check">✓</span>}
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            className="map-tool-button basemap-select"
            type="button"
            aria-label={`Basemap: ${BASEMAPS[baseMap].label}`}
            onClick={() => setBaseMap((value) => (value === 'light' ? 'satellite' : value === 'satellite' ? 'dark' : 'light'))}
          >
            {baseMap === 'satellite' ? <Satellite size={16} /> : <MapIcon size={16} />}
            <span>{BASEMAPS[baseMap].label}</span>
          </button>
          <button
            className={`map-tool-button outline-toggle ${showOutlines ? 'is-active' : ''}`}
            type="button"
            aria-pressed={showOutlines}
            onClick={onOutlineToggle}
          >
            <span className="outline-icon" />
            Outlines
          </button>
          {layer === 'connectivity' && (
            <span className="map-status-tag">
              <Activity size={13} />
              Network view
            </span>
          )}
        </div>
      )}

      {!isFullscreen && (
        <MarkerFilterControl
          compact={compact}
          activeTypes={visibleMarkerTypes}
          count={planMarkers.length}
          total={deltaView ? 0 : effectivePlan?.selected.length ?? 0}
          open={markerFiltersOpen}
          onToggleOpen={toggleMarkerFilters}
          onToggleType={toggleMarkerType}
        />
      )}

      <div className="map-canvas">
        <MapContainer
          key={boundsArray}
          bounds={mapBounds}
          boundsOptions={{ padding: [18, 18], maxZoom: 17 }}
          scrollWheelZoom
          zoomControl={false}
          preferCanvas={cells.length > 500}
          className={`grid-map-container basemap-${baseMap}`}
          aria-label="Urban climate intervention grid map"
        >
          <TileLayer key={baseMap} url={activeLayer.url} attribution={activeLayer.attribution} maxZoom={19} />
          {!compact && <DynamicScaleControl />}
          {!compact && miniMapOpen && <GeographicMiniMap baseMap={baseMap} />}
          <Pane name="gridCells" style={{ zIndex: 410 }}>
            {cells.map((cell) => (
              <CellPolygon
                key={cell.id}
                cell={cell}
                selected={selectedCells.includes(cell.id) || selectedCell === cell.id}
                layer={layer}
                opacity={
                  !deltaView && layer === 'recommended' && planByCell.has(cell.id)
                    ? Math.max(opacity, 0.68)
                    : opacity
                }
                outlines={showOutlines}
                planActive={planByCell.has(cell.id)}
                deltaView={deltaView}
                deltaBenefit={deltaByCell.get(cell.id) ?? 0}
                onSelect={handleCellClick}
              />
            ))}
          </Pane>
          <Pane name="connectivityLines" style={{ zIndex: 430 }}>
            {layer === 'connectivity' &&
              planLinks.map((link) => {
                const from = cells.find((cell) => cell.id === link.from);
                const to = cells.find((cell) => cell.id === link.to);
                if (!from || !to) return null;
                return (
                  <Polyline
                    key={`${link.from}-${link.to}-${link.kind}`}
                    positions={[
                      [from.center[0], from.center[1]],
                      [to.center[0], to.center[1]],
                    ]}
                    pathOptions={{
                      color: link.kind === 'new' ? '#B7F7D0' : componentColors.get(link.from) ?? '#4CC38A',
                      weight: link.kind === 'new' ? 3 : 2,
                      dashArray: link.kind === 'new' ? '6 6' : undefined,
                      opacity: 0.92,
                      interactive: false,
                    }}
                  />
                );
              })}
          </Pane>
          <Pane name="interventionMarkers" style={{ zIndex: 440 }}>
            {planMarkers.map(({ key, cell, candidate, position, icon }) => (
              <Marker
                key={key}
                position={position}
                icon={icon}
                title={`${candidate.interventionName} at ${cell.id}`}
                riseOnHover
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleCellClick(cell.id, false);
                    if (isFullscreen) {
                      setActivePanel(interactionMode === 'plan' ? 'interventions' : 'inspector');
                    }
                  },
                }}
              >
                <Tooltip className="eco-map-tooltip" direction="top" offset={[0, -10]}>
                  <span className="tooltip-cell-id">{cell.id}</span>
                  <span>{candidate.interventionName}</span>
                  <strong>
                    {candidate.quantity} {candidate.unit}
                    <small> · ₹{candidate.cost.toLocaleString('en-IN')}</small>
                  </strong>
                </Tooltip>
              </Marker>
            ))}
          </Pane>
          {originPicker && (
            <Pane name="studyOriginMarker" style={{ zIndex: 650, pointerEvents: 'auto' }}>
              <Marker
                position={[originPicker.position[0], originPicker.position[1]]}
                draggable
                title="Drag to adjust the study-area origin"
                icon={originMarkerIcon}
                eventHandlers={{
                  dragend: (event) => {
                    const point = (event.target as L.Marker).getLatLng();
                    originPicker.onChange(point.lat, point.lng);
                  },
                }}
              />
            </Pane>
          )}
          <ResizeAndFit bounds={mapBounds} />
          <MapLayoutInvalidator isFullscreen={isFullscreen} activePanel={activePanel} />
          {syncGroup && <MapSyncBridge group={syncGroup} />}
          <BoxSelect cells={cells} onSelectCells={onSelectCells} />
          <MapMapEvents bounds={mapBounds} onCoordinate={setCoordinate} />
          {!compact && (
            <div className="map-utility-controls-float">
              <MapActionButtons
                onCoordinate={setCoordinate}
                onLocate={locate}
                onReset={resetMap}
                onToggleFullscreen={toggleFullscreen}
                isFullscreen={isFullscreen}
              />
            </div>
          )}
        </MapContainer>

        {!isFullscreen && (
          <div className="map-float-title">
            <span className="live-dot" />
            LIVE ANALYSIS <span className="map-title-separator">/</span> {selectedLayerLabel.toUpperCase()}
          </div>
        )}

        <div className={`map-legend ${isFullscreen ? 'fullscreen-map-legend' : ''}`} aria-label={`${selectedLayerLabel} legend`}>
          <div className="legend-heading">
            {deltaView
              ? 'PROPOSAL − BASELINE'
              : layer === 'recommended'
              ? 'PLAN / CELL'
              : `${selectedLayerLabel} / 0–100`}
          </div>
          {deltaView ? (
            <div className="delta-legend">
              <span>
                <i className="delta-positive" />
                Proposal improves
              </span>
              <span>
                <i className="delta-neutral" />
                No difference
              </span>
              <span>
                <i className="delta-negative" />
                Baseline improves
              </span>
            </div>
          ) : layer === 'recommended' ? (
            <>
              <span>
                <i className="legend-plan" />
                Recommended intervention
              </span>
              <span>
                <i className="legend-neutral" />
                No action allocated
              </span>
            </>
          ) : (
            <div className="legend-ramp">
              <div>
                <i style={{ backgroundColor: RISK_COLORS.CRITICAL }} />
                <label>Critical</label>
              </div>
              <div>
                <i style={{ backgroundColor: RISK_COLORS.HIGH }} />
                <label>High</label>
              </div>
              <div>
                <i style={{ backgroundColor: RISK_COLORS.MODERATE }} />
                <label>Moderate</label>
              </div>
              <div>
                <i style={{ backgroundColor: RISK_COLORS.LOW }} />
                <label>Low</label>
              </div>
            </div>
          )}
        </div>

        {!compact && !isFullscreen && (
          <div className="map-coordinates">
            <span className="coordinate-cross">⌖</span> {coordinate} <span className="coordinate-separator">·</span> {cells.length} CELLS
          </div>
        )}

        {!compact && !isFullscreen && (
          <button
            className={`map-minimap-trigger ${miniMapOpen ? 'is-active' : ''}`}
            type="button"
            aria-label="Toggle mini-map"
            aria-pressed={miniMapOpen}
            onClick={() => {
              setMiniMapOpen((value) => !value);
              setMarkerFiltersOpen(false);
            }}
          >
            <Layers3 size={15} />
          </button>
        )}

        {locateError && <div className="map-message" role="status">Location unavailable. Check browser permission.</div>}

        {!compact && !isFullscreen && (
          <div className="map-opacity-control">
            <label htmlFor="grid-opacity">
              GRID OPACITY <b>{Math.round(opacity * 100)}%</b>
            </label>
            <input
              id="grid-opacity"
              aria-label="Grid opacity"
              type="range"
              min="0.2"
              max="0.82"
              step="0.02"
              value={opacity}
              onChange={(event) => onOpacityChange(Number(event.currentTarget.value))}
            />
          </div>
        )}

        <div className="map-attribution-note" dangerouslySetInnerHTML={{ __html: activeLayer.attribution }} />

        {/* COMPACT ENVIRONMENTAL KPI STRIP (PHASE 5) */}
        {isFullscreen && !compact && (
          <FullscreenKPIStrip
            totalBudget={effectiveBudget}
            allocated={effectivePlan?.totalCost ?? 0}
            cellsInPlan={effectivePlan?.cellsImproved ?? 0}
            totalInterventions={effectivePlan?.selected?.length ?? 0}
            totalCells={cells.length}
            overallBenefit={overallModeledBenefit}
            budgetOutdated={isBudgetOutdated}
            activePlanMode={effectivePlan?.planMode ?? (effectivePlan ? 'standard' : null)}
            strategyName={effectivePlan?.strategyName}
            onOpenBudget={() => setActivePanel('budget')}
            onOpenOptimize={() => setActivePanel('optimize')}
            onOpenKPIs={() => setActivePanel('kpi')}
          />
        )}

        {/* FULLSCREEN CONTEXTUAL DRAWER (PHASE 4) */}
        {isFullscreen && !compact && activePanel !== null && (
          <FullscreenErrorBoundary
            panelName="Contextual Planning Workspace"
            fallbackTitle="Planning Workspace Notice"
            fallbackMessage="The current workspace drawer encountered an issue, but your map, active study area, and 100-cell grid remain fully functional."
            onReset={() => setActivePanel(null)}
          >
            <FullscreenPlanningPanelContainer
              activePanel={activePanel}
              onClose={() => setActivePanel(null)}
              isPinned={isDrawerPinned}
              onTogglePin={() => setIsDrawerPinned((prev) => !prev)}
            >
              {activePanel === 'kpi' && (
                <FullscreenKPIView
                  cells={cells}
                  selectedCell={selectedCellObj}
                  plan={effectivePlan}
                  budget={effectiveBudget}
                  connectivity={connectivity}
                  onSelectCell={(id) => onSelectCell(id, false)}
                  onOpenOptimize={() => setActivePanel('optimize')}
                />
              )}
              {activePanel === 'interventions' && (
                <FullscreenInterventionsView
                  cells={cells}
                  plan={effectivePlan}
                  selectedCellId={selectedCell}
                  onSelectCell={(id) => onSelectCell(id, false)}
                  onCenterMap={(lat, lng) => centerMap(lat, lng)}
                  onOpenOptimize={() => setActivePanel('optimize')}
                />
              )}
              {activePanel === 'budget' && (
                <FullscreenBudgetView
                  budget={effectiveBudget}
                  setBudget={handleSetBudget}
                  plan={effectivePlan}
                  onOpenOptimize={() => setActivePanel('optimize')}
                />
              )}
              {activePanel === 'optimize' && (
                <FullscreenOptimizeView
                  studyId={effectiveStudyId}
                  studyName={activeStudy?.name ?? 'Campus Study'}
                  cells={cells}
                  budget={effectiveBudget}
                  weights={effectiveWeights}
                  setWeights={handleSetWeights}
                  plan={effectivePlan}
                  setPlan={handleSetPlan}
                  setLayer={onLayerChange}
                  pushToast={store?.pushToast}
                />
              )}
              {activePanel === 'inspector' && (
                <FullscreenCellInspectorView
                  selectedCellId={selectedCell}
                  cells={cells}
                  studyId={effectiveStudyId}
                  plan={effectivePlan}
                  budget={effectiveBudget}
                  onSelectCell={(id) => onSelectCell(id, false)}
                />
              )}
              {activePanel === 'layers' && (
                <FullscreenLayersView
                  layer={layer}
                  onLayerChange={onLayerChange}
                  baseMap={baseMap}
                  setBaseMap={setBaseMap}
                  showOutlines={showOutlines}
                  onOutlineToggle={onOutlineToggle}
                  opacity={opacity}
                  onOpacityChange={onOpacityChange}
                  visibleMarkerTypes={visibleMarkerTypes}
                  onToggleMarkerType={toggleMarkerType}
                />
              )}
            </FullscreenPlanningPanelContainer>
          </FullscreenErrorBoundary>
        )}

        {/* FULLSCREEN PLANNING TOOLBAR */}
        {isFullscreen && !compact && (
          <FullscreenPlanningToolbar
            activePanel={activePanel}
            onTogglePanel={(key) => setActivePanel((prev) => (prev === key ? null : key))}
            planCount={effectivePlan?.selected.length ?? 0}
            budget={effectiveBudget}
            avgPriority={avgPriorityScore}
            selectedCellId={selectedCell}
            activeLayer={layer}
            budgetOutdated={isBudgetOutdated}
            onClosePanel={() => setActivePanel(null)}
          />
        )}
      </div>

      {!compact && !isFullscreen && effectivePlan && (
        <div className="map-plan-summary">
          <span>
            <i className="plan-marker-dot" />
            {effectivePlan.cellsImproved ?? effectivePlan.selected?.length ?? 0} cells actioned
          </span>
          <span>₹{(effectivePlan.totalCost ?? 0).toLocaleString('en-IN')} deployed</span>
          <span>{effectivePlan.selected?.length ?? 0} interventions</span>
        </div>
      )}
    </section>
  );
}

function MapMapEvents({ bounds, onCoordinate }: { bounds: L.LatLngBoundsExpression; onCoordinate: (coordinate: string) => void }): null {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const reset = () => map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: true, duration: 0.28 });
    const center = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      if (detail) map.setView([detail.lat, detail.lng], Math.max(map.getZoom(), 16), { animate: true });
    };
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      params.set('zoom', String(map.getZoom()));
      params.set('lat', map.getCenter().lat.toFixed(5));
      params.set('lng', map.getCenter().lng.toFixed(5));
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}?${query}${window.location.hash}`);
      onCoordinate(`${map.getCenter().lat.toFixed(5)}, ${map.getCenter().lng.toFixed(5)}`);
    };
    container.addEventListener('ecogrid-reset-map', reset);
    window.addEventListener('ecogrid-map-center-request', center);
    map.on('moveend', sync);
    map.whenReady(sync);
    return () => {
      container.removeEventListener('ecogrid-reset-map', reset);
      window.removeEventListener('ecogrid-map-center-request', center);
      map.off('moveend', sync);
    };
  }, [bounds, map, onCoordinate]);
  return null;
}

function MapActionButtons({
  onLocate,
  onReset,
  onCoordinate,
  onToggleFullscreen,
  isFullscreen,
}: {
  onLocate: () => void;
  onReset: () => void;
  onCoordinate: (coordinate: string) => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}) {
  const map = useMap();
  const [docFullscreen, setDocFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setDocFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const isFull = isFullscreen ?? docFullscreen;

  const handleToggle = async () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
      return;
    }
    const wrapper = map.getContainer().closest('.map-shell') ?? map.getContainer().parentElement;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper?.requestFullscreen?.();
  };

  return (
    <div className="map-utility-controls" aria-label="Map controls">
      <MapSignals onCoordinate={onCoordinate} />
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => map.zoomIn()}>
        <Plus size={16} />
      </button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => map.zoomOut()}>
        <Minus size={16} />
      </button>
      <span className="control-divider" />
      <button type="button" title="Reset map view" aria-label="Reset map view" onClick={onReset}>
        <Target size={16} />
      </button>
      <button type="button" title="Locate my position" aria-label="Locate my position" onClick={onLocate}>
        <Crosshair size={16} />
      </button>
      <button
        type="button"
        title={isFull ? 'Exit fullscreen planning workspace' : 'Expand to Fullscreen Planning Workspace'}
        aria-label={isFull ? 'Exit fullscreen planning workspace' : 'Expand to Fullscreen Planning Workspace'}
        onClick={() => void handleToggle()}
      >
        {isFull ? <Shrink size={16} /> : <Expand size={16} />}
      </button>
    </div>
  );
}
