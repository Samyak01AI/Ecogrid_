import React from 'react';
import {
  Crosshair,
  Globe2,
  Map as MapIcon,
  Satellite,
  ShieldCheck,
  Shrink,
  Target,
} from 'lucide-react';
import type { LayerKey } from '@ecogrid/domain';

type Props = {
  studyName: string;
  gridRows: number;
  gridCols: number;
  cellCount: number;
  origin: readonly [number, number];
  coordinate: string;
  layer: LayerKey;
  baseMap: 'light' | 'satellite' | 'dark';
  onBaseMapToggle: () => void;
  showOutlines: boolean;
  onOutlineToggle: () => void;
  onResetView: () => void;
  onLocate: () => void;
  onExitFullscreen: () => void;
  isRealData?: boolean;
};

const LAYER_LABELS: Record<LayerKey, string> = {
  priority: 'Combined Priority',
  heat: 'Heat Risk',
  vegetation: 'Vegetation Deficit',
  pedestrian: 'Pedestrian Exposure',
  connectivity: 'Connectivity Need',
  feasibility: 'Intervention Feasibility',
  recommended: 'Recommended Plan',
};

export function FullscreenWorkspaceTopBar({
  studyName,
  gridRows,
  gridCols,
  cellCount,
  origin,
  coordinate,
  layer,
  baseMap,
  onBaseMapToggle,
  showOutlines,
  onOutlineToggle,
  onResetView,
  onLocate,
  onExitFullscreen,
  isRealData,
}: Props) {
  const latStr = `${Math.abs(origin[0]).toFixed(4)}° ${origin[0] >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(origin[1]).toFixed(4)}° ${origin[1] >= 0 ? 'E' : 'W'}`;

  return (
    <header className="fullscreen-topbar" aria-label="Fullscreen planning workspace controls">
      <div className="fullscreen-topbar-left">
        <div className="fullscreen-brand">
          <span className="brand-mark brand-mark-small" aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </span>
          <span className="fullscreen-brand-name">EcoGrid AI</span>
          <span className="fullscreen-badge-workspace">PLANNING WORKSPACE</span>
        </div>

        <span className="fullscreen-topbar-divider" />

        <div className="fullscreen-study-info">
          <Globe2 size={14} className="fullscreen-globe-icon" />
          <span className="fullscreen-study-name">{studyName.toUpperCase()}</span>
          <span className="fullscreen-study-matrix">
            {gridCols} × {gridRows} GRID ({cellCount} CELLS)
          </span>
          <span className="fullscreen-study-origin">{latStr}, {lngStr}</span>
        </div>

        {isRealData ? (
          <span className="fullscreen-provenance-pill real">
            <ShieldCheck size={11} /> REAL SATELLITE & GIS
          </span>
        ) : (
          <span className="fullscreen-provenance-pill demo">SYNTHETIC MODEL</span>
        )}
      </div>

      <div className="fullscreen-topbar-center">
        <div className="fullscreen-layer-indicator">
          <span className={`fullscreen-layer-dot layer-${layer}`} />
          <span className="fullscreen-layer-label">{LAYER_LABELS[layer] ?? layer}</span>
        </div>
        <div className="fullscreen-coord-display">
          <span className="fullscreen-coord-icon">⌖</span>
          <span>{coordinate || `${origin[0].toFixed(5)}, ${origin[1].toFixed(5)}`}</span>
        </div>
      </div>

      <div className="fullscreen-topbar-right">
        <div className="fullscreen-map-quick-tools">
          <button
            type="button"
            className="fullscreen-tool-btn"
            title="Reset view to study bounds"
            aria-label="Reset map view"
            onClick={onResetView}
          >
            <Target size={14} />
            <span>Reset</span>
          </button>
          <button
            type="button"
            className="fullscreen-tool-btn"
            title="Locate my position"
            aria-label="Locate my position"
            onClick={onLocate}
          >
            <Crosshair size={14} />
            <span>Locate</span>
          </button>
          <button
            type="button"
            className={`fullscreen-tool-btn ${showOutlines ? 'is-active' : ''}`}
            title="Toggle grid outlines"
            aria-pressed={showOutlines}
            onClick={onOutlineToggle}
          >
            <span className="outline-icon-small" />
            <span>Outlines</span>
          </button>
          <button
            type="button"
            className="fullscreen-tool-btn"
            title={`Basemap: ${baseMap}`}
            aria-label={`Switch basemap: currently ${baseMap}`}
            onClick={onBaseMapToggle}
          >
            {baseMap === 'satellite' ? <Satellite size={14} /> : <MapIcon size={14} />}
            <span>{baseMap === 'satellite' ? 'Satellite' : baseMap === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
        </div>

        <button
          type="button"
          className="fullscreen-exit-btn"
          title="Exit Fullscreen Workspace (Esc)"
          aria-label="Exit fullscreen planning workspace"
          onClick={onExitFullscreen}
        >
          <Shrink size={15} />
          <span>Exit Fullscreen</span>
        </button>
      </div>
    </header>
  );
}
