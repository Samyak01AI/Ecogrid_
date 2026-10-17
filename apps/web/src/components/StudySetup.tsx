import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowRight, FileJson2, LocateFixed, MapPin, Search, ShieldCheck } from 'lucide-react';
import { createGrid, DEFAULT_STUDY, type StudyArea } from '@ecogrid/domain';
import { useNavigate } from 'react-router-dom';
import { api, type PlaceResult } from '../api.js';
import { useEcoStore } from '../useEcoStore.js';
import GridMap from './GridMap.js';
import './StudySetup.css';

type GeoPosition = [longitude: number, latitude: number];

function collectPositions(value: unknown, output: GeoPosition[]): void {
  if (Array.isArray(value)) {
    if (typeof value[0] === 'number' && typeof value[1] === 'number' && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      output.push([value[0], value[1]]);
      return;
    }
    for (const child of value) collectPositions(child, output);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) collectPositions(child, output);
  }
}

export default function StudySetup() {
  const navigate = useNavigate();
  const { studies, activeStudyId, user, setCells, setStudies, setActiveStudyId, setPlan, pushToast } = useEcoStore();
  const [studyName, setStudyName] = useState('New study area');
  const [origin, setOrigin] = useState<[number, number]>([DEFAULT_STUDY.origin[0], DEFAULT_STUDY.origin[1]]);
  const [rows, setRows] = useState(DEFAULT_STUDY.rows);
  const [columns, setColumns] = useState(DEFAULT_STUDY.columns);
  const [cellSizeLat, setCellSizeLat] = useState(DEFAULT_STUDY.cellSizeLat);
  const [cellSizeLng, setCellSizeLng] = useState(DEFAULT_STUDY.cellSizeLng);
  const [rotation, setRotation] = useState(DEFAULT_STUDY.rotation);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [boundaryName, setBoundaryName] = useState('');
  const [boundaryNote, setBoundaryNote] = useState('');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const canCreate = user?.role === 'planner' || user?.role === 'admin';

  useEffect(() => {
    const current = studies.find((study) => study.id === activeStudyId);
    if (!current) return;
    setStudyName(`${current.name} copy`);
    setOrigin([current.origin[0], current.origin[1]]);
    setRows(current.rows);
    setColumns(current.columns);
    setCellSizeLat(current.cellSizeLat);
    setCellSizeLng(current.cellSizeLng);
    setRotation(current.rotation);
  }, [activeStudyId, studies]);

  const previewStudy = useMemo<StudyArea>(() => ({
    id: 'study-preview', name: studyName.trim() || 'Study preview', origin, rows, columns, cellSizeLat, cellSizeLng, rotation,
  }), [cellSizeLat, cellSizeLng, columns, origin, rows, rotation, studyName]);
  const previewCells = useMemo(() => createGrid(previewStudy), [previewStudy]);

  const searchPlace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = placeQuery.trim();
    if (query.length < 3) { pushToast('Enter at least three characters, then submit the search.', 'info'); return; }
    setSearching(true);
    try {
      const response = await api.searchPlaces(query);
      setPlaceResults(response.results);
      if (response.results.length === 0) pushToast('No matching places found. Try a broader search.', 'info');
    } catch (error) { pushToast(error instanceof Error ? error.message : 'Place search is temporarily unavailable.', 'error'); }
    setSearching(false);
  };

  const choosePlace = (place: PlaceResult) => {
    setOrigin([place.lat - rows * cellSizeLat / 2, place.lng - columns * cellSizeLng / 2]);
    setPlaceQuery(place.displayName);
    setPlaceResults([]);
    setBoundaryName('');
    setBoundaryNote('Place selected. The grid is centered on the returned coordinate; drag the mint pin to refine its origin.');
  };

  const importBoundary = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { pushToast('Choose a GeoJSON file no larger than 2 MB.', 'error'); return; }
    try {
      const documentValue: unknown = JSON.parse(await file.text());
      if (typeof documentValue !== 'object' || documentValue === null || !('type' in documentValue)) throw new Error('Choose a valid GeoJSON Feature, FeatureCollection, Polygon, or MultiPolygon.');
      const geometryType = String(documentValue.type);
      if (!['Feature', 'FeatureCollection', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(geometryType)) throw new Error('Choose a valid GeoJSON boundary geometry.');
      const positions: GeoPosition[] = [];
      collectPositions(documentValue, positions);
      const valid = positions.filter(([lng, lat]) => Math.abs(lng) <= 180 && Math.abs(lat) <= 90);
      if (valid.length < 3) throw new Error('The boundary needs at least three longitude/latitude points in WGS84 coordinates.');
      const longitudes = valid.map(([lng]) => lng);
      const latitudes = valid.map(([, lat]) => lat);
      const minLng = Math.min(...longitudes); const maxLng = Math.max(...longitudes);
      const minLat = Math.min(...latitudes); const maxLat = Math.max(...latitudes);
      setOrigin([minLat, minLng]);
      setCellSizeLat(Math.max(0.00001, (maxLat - minLat) / rows));
      setCellSizeLng(Math.max(0.00001, (maxLng - minLng) / columns));
      setBoundaryName(file.name);
      setPlaceQuery(''); setPlaceResults([]);
      setBoundaryNote('Grid fit to GeoJSON bounds. Irregular outlines are not clipped; review the cell grid against the source boundary before planning.');
      pushToast(`Boundary bounds loaded from ${file.name}.`, 'success');
    } catch (error) { pushToast(error instanceof Error ? error.message : 'The boundary file could not be parsed.', 'error'); }
  };

  const updateOrigin = (axis: 0 | 1, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const limit = axis === 0 ? 90 : 180;
    const bounded = Math.max(-limit, Math.min(limit, parsed));
    setOrigin((current) => axis === 0 ? [bounded, current[1]] : [current[0], bounded]);
  };

  const createStudy = async () => {
    if (!canCreate) { pushToast('Sign in as a planner or admin to create a study area.', 'info'); return; }
    setCreating(true);
    try {
      const response = await api.createStudy({ name: studyName.trim(), origin, rows, columns, cellSizeLat, cellSizeLng, rotation });
      const summary = { ...response.study, cellCount: response.cells.length };
      setStudies([...studies.filter((study) => study.id !== summary.id), summary]);
      setCells(response.cells); setActiveStudyId(summary.id); setPlan(null);
      pushToast(`Created ${summary.name} · ${response.cells.length} grid cells.`, 'success');
      navigate(`/overview?study=${encodeURIComponent(summary.id)}`);
    } catch (error) { pushToast(error instanceof Error ? error.message : 'Could not create this study area.', 'error'); }
    setCreating(false);
  };

  return <section className="study-setup" aria-label="Study area setup">
    <div className="study-setup-head"><span className="panel-kicker">STUDY AREA BUILDER</span><h2>Start from a place, shape the grid.</h2><p>Search once or import a boundary, configure the grid, then drag the origin pin to refine alignment.</p></div>
    <div className="study-setup-layout">
      <div className="study-setup-controls">
        <div className="study-setup-card">
          <label className="setup-field setup-name-field"><span>STUDY NAME</span><input value={studyName} maxLength={120} onChange={(event) => setStudyName(event.currentTarget.value)} aria-label="New study area name" /></label>
          <form className="place-search-form" onSubmit={(event) => void searchPlace(event)}><label className="setup-field"><span>PLACE SEARCH · SUBMIT TO SEARCH</span><div className="setup-search-input"><Search size={14} /><input value={placeQuery} onChange={(event) => setPlaceQuery(event.currentTarget.value)} placeholder="Park, campus, address, city…" aria-label="Search for a study-area place" minLength={3} maxLength={160} /><button type="submit" disabled={searching} aria-label="Submit place search">{searching ? 'Searching…' : 'Search'}</button></div></label></form>
          {placeResults.length > 0 && <div className="place-result-list" role="listbox" aria-label="Place search results">{placeResults.map((place) => <button key={place.id} type="button" role="option" aria-selected="false" onClick={() => choosePlace(place)}><MapPin size={13} /><span>{place.displayName}</span><small>{place.type}</small></button>)}</div>}
          <p className="setup-attribution">Search uses <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a>; geocoding data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. Searches are explicit, cached, and throttled.</p>
        </div>
        <div className="study-setup-card">
          <div className="setup-card-heading"><FileJson2 size={15} /><div><b>GeoJSON boundary</b><small>Set grid bounds from Polygon, MultiPolygon, Feature, or FeatureCollection.</small></div></div>
          <label className="boundary-file-input"><input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => void importBoundary(event)} aria-label="Import a GeoJSON boundary" /><span>{boundaryName || 'Choose a boundary file'}</span><small>WGS84 · max 2 MB</small></label>
          {boundaryNote && <p className="boundary-note">{boundaryNote}</p>}
        </div>
        <div className="study-setup-card">
          <div className="setup-card-heading"><LocateFixed size={15} /><div><b>Grid configuration</b><small>{(rows * columns).toLocaleString()} analysis cells · one polygon per cell</small></div></div>
          <div className="setup-grid-fields">
            <label className="setup-field"><span>ROWS</span><input type="number" min="1" max="50" step="1" value={rows} onChange={(event) => setRows(Math.max(1, Math.min(50, Number(event.currentTarget.value) || 1)))} /></label>
            <label className="setup-field"><span>COLUMNS</span><input type="number" min="1" max="50" step="1" value={columns} onChange={(event) => setColumns(Math.max(1, Math.min(50, Number(event.currentTarget.value) || 1)))} /></label>
            <label className="setup-field"><span>CELL HEIGHT (°)</span><input type="number" min="0.00001" max="0.1" step="0.0001" value={cellSizeLat} onChange={(event) => setCellSizeLat(Math.max(0.00001, Math.min(0.1, Number(event.currentTarget.value) || 0.00001)))} /></label>
            <label className="setup-field"><span>CELL WIDTH (°)</span><input type="number" min="0.00001" max="0.1" step="0.0001" value={cellSizeLng} onChange={(event) => setCellSizeLng(Math.max(0.00001, Math.min(0.1, Number(event.currentTarget.value) || 0.00001)))} /></label>
            <label className="setup-field"><span>ROTATION (°)</span><input type="number" min="-180" max="180" step="1" value={rotation} onChange={(event) => setRotation(Math.max(-180, Math.min(180, Number(event.currentTarget.value) || 0)))} /></label>
          </div>
          <div className="setup-origin-fields"><label className="setup-field"><span>ORIGIN LATITUDE</span><input type="number" min="-90" max="90" step="0.00001" value={origin[0]} onChange={(event) => updateOrigin(0, event.currentTarget.value)} /></label><label className="setup-field"><span>ORIGIN LONGITUDE</span><input type="number" min="-180" max="180" step="0.00001" value={origin[1]} onChange={(event) => updateOrigin(1, event.currentTarget.value)} /></label></div>
          <button className="button button-primary setup-create-button" type="button" disabled={!canCreate || creating || studyName.trim().length < 2} onClick={() => void createStudy()}><LocateFixed size={14} />{creating ? 'Creating grid…' : `Create study · ${rows} × ${columns}`}<ArrowRight size={14} /></button>
          {!canCreate && <p className="setup-permission-note"><ShieldCheck size={13} /> Sign in with planner or admin access to save a study area. <a href="/login">Sign in</a></p>}
        </div>
      </div>
      <div className="study-setup-preview"><div className="setup-preview-heading"><span><span className="panel-kicker">GRID PREVIEW</span><b>{studyName || 'New study area'}</b></span><small>{origin[0].toFixed(5)}, {origin[1].toFixed(5)} · {previewCells.length} CELLS</small></div><div className="setup-map-preview"><GridMap cells={previewCells} selectedCell={selectedCell} selectedCells={selectedCell ? [selectedCell] : []} onSelectCell={(id) => setSelectedCell(id)} onSelectCells={(ids) => setSelectedCell(ids[0] ?? null)} layer="priority" onLayerChange={() => {}} plan={null} opacity={0.49} showOutlines onOpacityChange={() => {}} onOutlineToggle={() => {}} originPicker={{ position: origin, onChange: (latitude, longitude) => setOrigin([latitude, longitude]) }} /></div><p className="setup-preview-caption">Drag the mint pin to adjust the southwest origin. Click any polygon to preview the cell selection. Grid geometry updates as you edit dimensions.</p></div>
    </div>
  </section>;
}
