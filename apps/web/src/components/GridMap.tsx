import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  INTERVENTIONS,
  combinedPriority,
  layerScore,
  riskBand,
  type Cell,
  type ConnectivityResult,
  type InterventionId,
  type LayerKey,
  type OptimizerResult,
} from '@ecogrid/domain';
import { Activity, Crosshair, Expand, Layers3, Map as MapIcon, Minus, Plus, Satellite, Shrink, Target } from 'lucide-react';

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
function displayScore(cell: Cell, layer: LayerKey): number { return Math.round(layerScore(cell, layer) * 100); }

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
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, [bounds, boundsKey, map]);
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
  const risk = riskBand(combinedPriority(cell.scores));
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
        click: (event) => onSelect(cell.id, event.originalEvent.shiftKey),
        mouseover: (event) => { (event.target as L.Polygon).setStyle({ weight: selected ? 3 : 1.6, fillOpacity: Math.min(0.9, opacity + 0.12) }); },
        mouseout: (event) => { (event.target as L.Polygon).setStyle(style); },
      }}
    >
      <Tooltip sticky direction="top" opacity={0.96} className="eco-map-tooltip">
        <span className="tooltip-cell-id">{cell.id}</span><span>{cell.areaName}</span>
        <strong>{deltaView ? `${deltaBenefit >= 0 ? '+' : ''}${deltaBenefit.toFixed(3)}` : displayScore(cell, layer)} <small>{deltaView ? 'weighted benefit · B−A' : `/ 100 · ${risk}`}</small></strong>
      </Tooltip>
    </Polygon>
  );
}

function BoxSelect({ cells, onSelectCells }: { cells: readonly Cell[]; onSelectCells: (ids: string[]) => void }): null {
  const map = useMap();
  const active = useRef<{ origin: L.LatLng; originPoint: L.Point; rectangle: L.Rectangle } | null>(null);
  const moved = useRef(false);
  useMapEvents({
    mousedown(event) {
      if (!event.originalEvent.shiftKey || event.originalEvent.button !== 0) return;
      event.originalEvent.preventDefault();
      const originPoint = map.latLngToContainerPoint(event.latlng);
      active.current = { origin: event.latlng, originPoint, rectangle: L.rectangle(L.latLngBounds(event.latlng, event.latlng), { color: '#8be2a8', weight: 1.5, dashArray: '5 4', fillColor: '#4CC38A', fillOpacity: 0.09, interactive: false }).addTo(map) };
      moved.current = false;
      map.dragging.disable();
    },
    mousemove(event) {
      if (!active.current) return;
      const currentPoint = map.latLngToContainerPoint(event.latlng);
      if (currentPoint.distanceTo(active.current.originPoint) > 6) moved.current = true;
      active.current.rectangle.setBounds(L.latLngBounds(active.current.origin, event.latlng));
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

export default function GridMap({ cells, selectedCell, selectedCells, onSelectCell, onSelectCells, layer, onLayerChange, plan, connectivity, opacity, showOutlines, onOpacityChange, onOutlineToggle, originPicker, scenarioComparison, compact = false, syncGroup }: Props) {
  const [baseMap, setBaseMap] = useState<BaseMap>(() => {
    try { const fromUrl = new URLSearchParams(location.search).get('basemap'); const saved = localStorage.getItem('ecogrid-basemap'); const value = fromUrl ?? saved; return value === 'satellite' || value === 'dark' ? value : 'light'; } catch { return 'light'; }
  });
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [deltaView, setDeltaView] = useState(false);
  const [coordinate, setCoordinate] = useState('12.94080, 77.63120');
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [markerFiltersOpen, setMarkerFiltersOpen] = useState(false);
  const [visibleMarkerTypes, setVisibleMarkerTypes] = useState<Set<InterventionId>>(() => new Set(INTERVENTIONS.map((item) => item.id)));
  const [locateError, setLocateError] = useState(false);
  const mapBounds = useMemo(() => L.latLngBounds(cells.flatMap((cell) => cell.polygon.map(([latitude, longitude]) => L.latLng(latitude, longitude)))), [cells]);
  const boundsArray = useMemo(() => mapBounds.toBBoxString(), [mapBounds]);
  const activeLayer = BASEMAPS[baseMap];
  const cellsById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell] as const)), [cells]);
  const planByCell = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const candidate of plan?.selected ?? []) map.set(candidate.cellId, [...(map.get(candidate.cellId) ?? []), candidate.interventionName]);
    return map;
  }, [plan]);
  const planMarkers = useMemo(() => {
    const grouped = new Map<string, OptimizerResult['selected'][number][]>();
    if (deltaView) return [];
    for (const candidate of plan?.selected ?? []) {
      if (!visibleMarkerTypes.has(candidate.interventionId)) continue;
      grouped.set(candidate.cellId, [...(grouped.get(candidate.cellId) ?? []), candidate]);
    }
    const markers: { candidate: OptimizerResult['selected'][number]; cell: Cell; position: [number, number]; icon: L.DivIcon }[] = [];
    for (const [cellId, candidates] of grouped) {
      const cell = cellsById.get(cellId);
      if (!cell) continue;
      for (const [index, candidate] of candidates.entries()) {
        const intervention = INTERVENTION_BY_ID.get(candidate.interventionId);
        if (!intervention) continue;
        const angle = (index / candidates.length) * Math.PI * 2 - Math.PI / 2;
        const offsetMeters = candidates.length > 1 ? 12 : 0;
        const latitude = cell.center[0] + Math.cos(angle) * offsetMeters / 111_320;
        const longitude = cell.center[1] + Math.sin(angle) * offsetMeters / (111_320 * Math.max(0.15, Math.cos(cell.center[0] * Math.PI / 180)));
        const icon = L.divIcon({
          className: 'ecogrid-intervention-marker',
          html: `<span class="intervention-marker-glyph" data-intervention-id="${candidate.interventionId}" style="--marker-color:${intervention.markerColor};--marker-delay:${Math.min(index, 8) * 40}ms" aria-hidden="true">${MARKER_GLYPHS[candidate.interventionId]}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        markers.push({ candidate, cell, position: [latitude, longitude], icon });
      }
    }
    return markers;
  }, [cellsById, deltaView, plan, visibleMarkerTypes]);
  const deltaByCell = useMemo(() => {
    const delta = new Map<string, number>();
    for (const candidate of scenarioComparison?.baseline.selected ?? []) delta.set(candidate.cellId, (delta.get(candidate.cellId) ?? 0) - candidate.combinedBenefit);
    for (const candidate of scenarioComparison?.proposal.selected ?? []) delta.set(candidate.cellId, (delta.get(candidate.cellId) ?? 0) + candidate.combinedBenefit);
    return delta;
  }, [scenarioComparison]);
  const componentColors = useMemo(() => new Map(connectivity?.components.flatMap((component) => component.cellIds.map((cellId) => [cellId, component.color] as const)) ?? []), [connectivity]);
  const planLinks = useMemo(() => connectivity?.links ?? [], [connectivity]);
  const resetMap = useCallback(() => {
    const mapElement = document.querySelector('.grid-map-container');
    if (mapElement) mapElement.dispatchEvent(new CustomEvent('ecogrid-reset-map'));
  }, []);
  const locate = useCallback(() => {
    setLocateError(false);
    if (!navigator.geolocation) { setLocateError(true); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const target = document.querySelector('.grid-map-container');
      target?.dispatchEvent(new CustomEvent('ecogrid-center-map', { detail: { lat: position.coords.latitude, lng: position.coords.longitude } }));
    }, () => setLocateError(true), { enableHighAccuracy: true, timeout: 8000 });
  }, []);
  const toggleMarkerType = useCallback((id: InterventionId) => {
    setVisibleMarkerTypes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const toggleMarkerFilters = useCallback(() => {
    setMarkerFiltersOpen((open) => !open);
    setMiniMapOpen(false);
  }, []);
  const selectedLayerLabel = deltaView ? 'Scenario delta' : LAYERS.find((item) => item.key === layer)?.label ?? 'Combined priority';

  useEffect(() => { if (!scenarioComparison) setDeltaView(false); }, [scenarioComparison]);

  useEffect(() => {
    try { localStorage.setItem('ecogrid-basemap', baseMap); } catch { /* Storage can be disabled by the browser. */ }
    const params = new URLSearchParams(window.location.search);
    if (baseMap === 'light') params.delete('basemap'); else params.set('basemap', baseMap);
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

  return <section className="map-shell" aria-label="Interactive climate analysis grid">
    {!compact && <div className="map-top-controls">
      <div className="map-layer-control">
        <button className={`map-tool-button ${showLayerMenu ? 'is-active' : ''}`} type="button" aria-label="Choose map layer" aria-expanded={showLayerMenu} onClick={() => setShowLayerMenu((value) => !value)}><Layers3 size={16} /><span>{deltaView ? 'Delta' : LAYERS.find((item) => item.key === layer)?.short ?? 'Layer'}</span></button>
        {showLayerMenu && <div className="layer-popover" role="menu" aria-label="Map layers">{LAYERS.map((item) => <button key={item.key} type="button" role="menuitemradio" aria-checked={!deltaView && layer === item.key} onClick={() => { setDeltaView(false); onLayerChange(item.key); setShowLayerMenu(false); }}><span className={`layer-swatch swatch-${item.key}`} />{item.label}{!deltaView && layer === item.key && <span className="layer-check">✓</span>}</button>)}{scenarioComparison && <button type="button" role="menuitemradio" aria-checked={deltaView} onClick={() => { setDeltaView(true); setShowLayerMenu(false); }}><span className="layer-swatch swatch-scenario-delta" />Scenario delta{deltaView && <span className="layer-check">✓</span>}</button>}</div>}
      </div>
      <button className="map-tool-button basemap-select" type="button" aria-label={`Basemap: ${BASEMAPS[baseMap].label}`} onClick={() => setBaseMap((value) => value === 'light' ? 'satellite' : value === 'satellite' ? 'dark' : 'light')}>
        {baseMap === 'satellite' ? <Satellite size={16} /> : <MapIcon size={16} />}<span>{BASEMAPS[baseMap].label}</span>
      </button>
      <button className={`map-tool-button outline-toggle ${showOutlines ? 'is-active' : ''}`} type="button" aria-pressed={showOutlines} onClick={onOutlineToggle}><span className="outline-icon" />Outlines</button>
      {layer === 'connectivity' && <span className="map-status-tag"><Activity size={13} />Network view</span>}
    </div>}
    <MarkerFilterControl compact={compact} activeTypes={visibleMarkerTypes} count={planMarkers.length} total={deltaView ? 0 : plan?.selected.length ?? 0} open={markerFiltersOpen} onToggleOpen={toggleMarkerFilters} onToggleType={toggleMarkerType} />
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
          {cells.map((cell) => <CellPolygon key={cell.id} cell={cell} selected={selectedCells.includes(cell.id) || selectedCell === cell.id} layer={layer} opacity={!deltaView && layer === 'recommended' && planByCell.has(cell.id) ? Math.max(opacity, 0.68) : opacity} outlines={showOutlines} planActive={planByCell.has(cell.id)} deltaView={deltaView} deltaBenefit={deltaByCell.get(cell.id) ?? 0} onSelect={onSelectCell} />)}
        </Pane>
        <Pane name="connectivityLines" style={{ zIndex: 430 }}>
          {layer === 'connectivity' && planLinks.map((link) => {
            const from = cells.find((cell) => cell.id === link.from);
            const to = cells.find((cell) => cell.id === link.to);
            if (!from || !to) return null;
            return <Polyline key={`${link.from}-${link.to}-${link.kind}`} positions={[[from.center[0], from.center[1]], [to.center[0], to.center[1]]]} pathOptions={{ color: link.kind === 'new' ? '#B7F7D0' : componentColors.get(link.from) ?? '#4CC38A', weight: link.kind === 'new' ? 3 : 2, dashArray: link.kind === 'new' ? '6 6' : undefined, opacity: 0.92, interactive: false }} />;
          })}
        </Pane>
        <Pane name="interventionMarkers" style={{ zIndex: 440 }}>
          {planMarkers.map(({ candidate, cell, position, icon }) => <Marker key={`${candidate.cellId}-${candidate.interventionId}`} position={position} icon={icon} title={`${candidate.interventionName} at ${cell.id}`} riseOnHover eventHandlers={{ click: () => onSelectCell(cell.id, false) }}>
            <Tooltip>{candidate.interventionName} · {cell.id} · {candidate.quantity} {candidate.unit}</Tooltip>
          </Marker>)}
        </Pane>
        {originPicker && <Pane name="studyOriginMarker" style={{ zIndex: 650, pointerEvents: 'auto' }}><Marker position={[originPicker.position[0], originPicker.position[1]]} draggable title="Drag to adjust the study-area origin" icon={originMarkerIcon} eventHandlers={{ dragend: (event) => { const point = (event.target as L.Marker).getLatLng(); originPicker.onChange(point.lat, point.lng); } }} /></Pane>}
        <ResizeAndFit bounds={mapBounds} />
        {syncGroup && <MapSyncBridge group={syncGroup} />}
        <BoxSelect cells={cells} onSelectCells={onSelectCells} />
        <MapMapEvents bounds={mapBounds} onCoordinate={setCoordinate} />
        {!compact && <div className="map-utility-controls-float"><MapActionButtons onCoordinate={setCoordinate} onLocate={locate} onReset={resetMap} /></div>}
      </MapContainer>
      <div className="map-float-title"><span className="live-dot" />LIVE ANALYSIS <span className="map-title-separator">/</span> {selectedLayerLabel.toUpperCase()}</div>
      <div className="map-legend" aria-label={`${selectedLayerLabel} legend`}>
        <div className="legend-heading">{deltaView ? 'PROPOSAL − BASELINE' : layer === 'recommended' ? 'PLAN / CELL' : `${selectedLayerLabel} / 0–100`}</div>
        {deltaView ? <div className="delta-legend"><span><i className="delta-positive" />Proposal improves</span><span><i className="delta-neutral" />No difference</span><span><i className="delta-negative" />Baseline improves</span></div> : layer === 'recommended' ? <><span><i className="legend-plan" />Recommended intervention</span><span><i className="legend-neutral" />No action allocated</span></> : <div className="legend-ramp"><div><i style={{ backgroundColor: RISK_COLORS.CRITICAL }} /><label>Critical</label></div><div><i style={{ backgroundColor: RISK_COLORS.HIGH }} /><label>High</label></div><div><i style={{ backgroundColor: RISK_COLORS.MODERATE }} /><label>Moderate</label></div><div><i style={{ backgroundColor: RISK_COLORS.LOW }} /><label>Low</label></div></div>}
      </div>
      {!compact && <div className="map-coordinates"><span className="coordinate-cross">⌖</span> {coordinate} <span className="coordinate-separator">·</span> {cells.length} CELLS</div>}
      {!compact && <button className={`map-minimap-trigger ${miniMapOpen ? 'is-active' : ''}`} type="button" aria-label="Toggle mini-map" aria-pressed={miniMapOpen} onClick={() => { setMiniMapOpen((value) => !value); setMarkerFiltersOpen(false); }}><Layers3 size={15} /></button>}
      {locateError && <div className="map-message" role="status">Location unavailable. Check browser permission.</div>}
      {!compact && <div className="map-opacity-control"><label htmlFor="grid-opacity">GRID OPACITY <b>{Math.round(opacity * 100)}%</b></label><input id="grid-opacity" aria-label="Grid opacity" type="range" min="0.2" max="0.82" step="0.02" value={opacity} onChange={(event) => onOpacityChange(Number(event.currentTarget.value))} /></div>}
      <div className="map-attribution-note" dangerouslySetInnerHTML={{ __html: activeLayer.attribution }} />
    </div>
    {!compact && plan && <div className="map-plan-summary"><span><i className="plan-marker-dot" />{plan.cellsImproved} cells actioned</span><span>${plan.totalCost.toLocaleString()} deployed</span><span>{plan.selected.length} interventions</span></div>}
  </section>;
}

function MapMapEvents({ bounds, onCoordinate }: { bounds: L.LatLngBoundsExpression; onCoordinate: (coordinate: string) => void }): null {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const reset = () => map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: true, duration: 0.28 });
    const center = (event: Event) => { const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail; if (detail) map.setView([detail.lat, detail.lng], Math.max(map.getZoom(), 16), { animate: true }); };
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
    return () => { container.removeEventListener('ecogrid-reset-map', reset); window.removeEventListener('ecogrid-map-center-request', center); map.off('moveend', sync); };
  }, [bounds, map, onCoordinate]);
  return null;
}

function MapActionButtons({ onLocate, onReset, onCoordinate }: { onLocate: () => void; onReset: () => void; onCoordinate: (coordinate: string) => void }) {
  const map = useMap();
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const fullToggle = async () => {
    const wrapper = map.getContainer().parentElement;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper?.requestFullscreen?.();
  };
  return <div className="map-utility-controls" aria-label="Map controls">
    <MapSignals onCoordinate={onCoordinate} />
    <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => map.zoomIn()}><Plus size={16} /></button>
    <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => map.zoomOut()}><Minus size={16} /></button>
    <span className="control-divider" />
    <button type="button" title="Reset map view" aria-label="Reset map view" onClick={onReset}><Target size={16} /></button>
    <button type="button" title="Locate my position" aria-label="Locate my position" onClick={onLocate}><Crosshair size={16} /></button>
    <button type="button" title={full ? 'Exit fullscreen' : 'Fullscreen'} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void fullToggle()}>{full ? <Shrink size={16} /> : <Expand size={16} />}</button>
  </div>;
}
