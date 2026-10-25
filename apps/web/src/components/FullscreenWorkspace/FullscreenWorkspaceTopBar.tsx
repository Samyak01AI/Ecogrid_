import React from 'react';
import {
  Compass,
  Crosshair,
  Globe2,
  Layers,
  Satellite,
  Scan,
  ShieldCheck,
  Shrink,
  Sprout,
  Target,
} from 'lucide-react';
import type { LayerKey } from '@ecogrid/domain';

export type MapInteractionMode = 'explore' | 'inspect' | 'plan';

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
  interactionMode?: MapInteractionMode;
  onInteractionModeChange?: (mode: MapInteractionMode) => void;
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
  interactionMode = 'explore',
  onInteractionModeChange,
}: Props) {
  const latStr = `${Math.abs(origin[0]).toFixed(3)}° ${origin[0] >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(origin[1]).toFixed(3)}° ${origin[1] >= 0 ? 'E' : 'W'}`;

  return (
    <header className="fullscreen-topbar" aria-label="Fullscreen planning workspace controls">
      {/* Left: Branding & Study Area */}
      <div className="fullscreen-topbar-left">
        <div className="fullscreen-brand">
          <span className="brand-mark brand-mark-small" aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </span>
          <span className="fullscreen-brand-name">EcoGrid AI</span>
          <span className="fullscreen-badge-workspace">GIS WORKSPACE</span>
        </div>

        <span className="fullscreen-topbar-divider" aria-hidden="true" />

        <div className="fullscreen-study-info">
          <Globe2 size={13} className="fullscreen-globe-icon" />
          <span className="fullscreen-study-name">{studyName.toUpperCase()}</span>
          <span
            className="fullscreen-study-matrix"
            title={`Origin: ${coordinate || `${latStr}, ${lngStr}`}`}
          >
            {gridCols} × {gridRows} ({cellCount} CELLS)
          </span>
        </div>

        {isRealData ? (
          <span className="fullscreen-provenance-pill real" title="Backed by Sentinel-2, Landsat-8 and Copernicus GIS layers">
            <ShieldCheck size={11} /> REAL GIS
          </span>
        ) : (
          <span className="fullscreen-provenance-pill demo" title="Synthetic environmental distribution model">
            SYNTHETIC
          </span>
        )}
      </div>

      {/* Center: Interaction Mode Segmented Switcher */}
      <div className="fullscreen-topbar-center">
        <div className="fullscreen-mode-switcher" role="radiogroup" aria-label="Map interaction mode">
          <button
            type="button"
            role="radio"
            aria-checked={interactionMode === 'explore'}
            className={`mode-btn ${interactionMode === 'explore' ? 'is-active' : ''}`}
            title="Explore Mode: Navigate basemap, inspect layers, and view geographic context"
            onClick={() => onInteractionModeChange?.('explore')}
          >
            <Compass size={13} />
            <span>Explore</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={interactionMode === 'inspect'}
            className={`mode-btn ${interactionMode === 'inspect' ? 'is-active' : ''}`}
            title="Inspect Mode: Click any grid cell to immediately inspect environmental indicators & provenance"
            onClick={() => onInteractionModeChange?.('inspect')}
          >
            <Scan size={13} />
            <span>Inspect</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={interactionMode === 'plan'}
            className={`mode-btn ${interactionMode === 'plan' ? 'is-active' : ''}`}
            title="Plan Mode: Review allocated interventions, compare candidate costs, and run optimization"
            onClick={() => onInteractionModeChange?.('plan')}
          >
            <Sprout size={13} />
            <span>Plan</span>
          </button>
        </div>

        {/* Current Active Layer indicator */}
        <div className="fullscreen-layer-indicator" title={`Active Environmental Layer: ${LAYER_LABELS[layer] ?? layer}`}>
          <span className={`fullscreen-layer-dot layer-${layer}`} />
          <span className="fullscreen-layer-label">{LAYER_LABELS[layer] ?? layer}</span>
        </div>
      </div>

      {/* Right: Map Utility Tools & Exit */}
      <div className="fullscreen-topbar-right">
        <div className="fullscreen-map-quick-tools" role="toolbar" aria-label="Map quick navigation">
          <button
            type="button"
            className="fullscreen-tool-btn"
            title="Reset map view to study bounds"
            aria-label="Reset map view"
            onClick={onResetView}
          >
            <Target size={14} />
            <span className="tool-btn-label">Reset</span>
          </button>

          <button
            type="button"
            className="fullscreen-tool-btn"
            title="Locate my position via browser geolocation"
            aria-label="Locate my position"
            onClick={onLocate}
          >
            <Crosshair size={14} />
            <span className="tool-btn-label">Locate</span>
          </button>

          <button
            type="button"
            className={`fullscreen-tool-btn ${showOutlines ? 'is-active' : ''}`}
            title="Toggle 10x10 cell outline borders"
            aria-pressed={showOutlines}
            onClick={onOutlineToggle}
          >
            <Layers size={14} />
            <span className="tool-btn-label">Outlines</span>
          </button>

          <button
            type="button"
            className={`fullscreen-tool-btn ${baseMap === 'satellite' ? 'is-active' : ''}`}
            title={`Basemap: ${baseMap.toUpperCase()}. Click to switch between Satellite, Dark, and Light.`}
            aria-label={`Toggle basemap (current: ${baseMap})`}
            onClick={onBaseMapToggle}
          >
            <Satellite size={14} />
            <span className="tool-btn-label">{baseMap === 'satellite' ? 'Sat' : baseMap.toUpperCase()}</span>
          </button>
        </div>

        <span className="fullscreen-topbar-divider" aria-hidden="true" />

        {/* Exit Fullscreen Button */}
        <button
          type="button"
          className="fullscreen-exit-btn"
          title="Exit Fullscreen Workspace (Esc)"
          aria-label="Exit Fullscreen Workspace"
          onClick={onExitFullscreen}
        >
          <Shrink size={15} />
          <span>Exit</span>
        </button>
      </div>
    </header>
  );
}
