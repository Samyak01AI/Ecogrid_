import React, { useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Layers3,
  Scan,
  Sprout,
  WandSparkles,
  X,
} from 'lucide-react';
import type { LayerKey } from '@ecogrid/domain';

export type FullscreenPanelKey =
  | 'kpi'
  | 'interventions'
  | 'budget'
  | 'optimize'
  | 'inspector'
  | 'layers';

type Props = {
  activePanel: FullscreenPanelKey | null;
  onTogglePanel: (key: FullscreenPanelKey) => void;
  planCount: number;
  budget: number;
  avgPriority: number;
  selectedCellId: string | null;
  activeLayer: LayerKey;
  budgetOutdated?: boolean;
  onClosePanel?: () => void;
};

export function FullscreenPlanningToolbar({
  activePanel,
  onTogglePanel,
  planCount,
  budget,
  avgPriority,
  selectedCellId,
  activeLayer,
  budgetOutdated = false,
  onClosePanel,
}: Props) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const tools: Array<{
    key: FullscreenPanelKey;
    label: string;
    icon: typeof Activity;
    badge: string | number;
    badgeTone?: 'mint' | 'amber' | 'blue' | 'default';
    tooltip: string;
    hasNotification?: boolean;
  }> = [
    {
      key: 'kpi',
      label: 'KPIs',
      icon: Activity,
      badge: `${avgPriority}`,
      badgeTone: 'mint',
      tooltip: 'Environmental Priority & Climate KPIs',
    },
    {
      key: 'interventions',
      label: 'Plan',
      icon: Sprout,
      badge: `${planCount}`,
      badgeTone: planCount > 0 ? 'mint' : 'default',
      tooltip: 'Recommended Actions & Allocation List',
    },
    {
      key: 'budget',
      label: 'Budget',
      icon: HandCoins,
      badge: `₹${(budget / 100000).toFixed(1)}L`,
      badgeTone: budgetOutdated ? 'amber' : 'default',
      tooltip: 'Manage Capital Envelope & Spending',
      hasNotification: budgetOutdated,
    },
    {
      key: 'optimize',
      label: 'Optimize',
      icon: WandSparkles,
      badge: 'CP-SAT',
      badgeTone: 'blue',
      tooltip: 'Run OR-Tools CP-SAT & Grok Adaptive Solver',
      hasNotification: budgetOutdated,
    },
    {
      key: 'inspector',
      label: 'Cell Inspector',
      icon: Scan,
      badge: selectedCellId ? selectedCellId : 'None',
      badgeTone: selectedCellId ? 'mint' : 'default',
      tooltip: 'Selected Cell Microclimate & Diagnostics',
    },
    {
      key: 'layers',
      label: 'Layers',
      icon: Layers3,
      badge: activeLayer.slice(0, 5),
      badgeTone: 'default',
      tooltip: 'Environmental Heatmaps & Basemap Controls',
    },
  ];

  return (
    <nav
      className={`fullscreen-vertical-tool-rail ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Planning tools rail"
      role="toolbar"
      aria-orientation="vertical"
    >
      <div className="tool-rail-header">
        <span className="tool-rail-title" id="tool-rail-label">
          {isExpanded ? 'PLANNING TOOLS' : 'TOOLS'}
        </span>
        <button
          type="button"
          className="tool-rail-collapse-btn"
          title={isExpanded ? 'Collapse tool rail' : 'Expand tool rail'}
          aria-label={isExpanded ? 'Collapse tool rail' : 'Expand tool rail'}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <div className="tool-rail-items" role="group" aria-labelledby="tool-rail-label">
        {tools.map((item) => {
          const Icon = item.icon;
          const isActive = activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`tool-rail-item ${isActive ? 'is-active' : ''}`}
              title={item.tooltip}
              aria-label={item.tooltip}
              aria-pressed={isActive}
              onClick={() => onTogglePanel(item.key)}
            >
              <span className="tool-rail-icon-wrap">
                <Icon size={17} strokeWidth={1.8} />
                {item.hasNotification && <span className="tool-rail-notification-dot" />}
              </span>

              {isExpanded && (
                <div className="tool-rail-content">
                  <span className="tool-rail-label">{item.label}</span>
                  <span className={`tool-rail-badge tone-${item.badgeTone ?? 'default'}`}>
                    {item.badge}
                  </span>
                </div>
              )}

              {isActive && <span className="tool-rail-active-indicator" />}
            </button>
          );
        })}
      </div>

      {activePanel && onClosePanel && (
        <div className="tool-rail-footer">
          <button
            type="button"
            className="tool-rail-close-btn"
            title="Collapse active panel (Esc)"
            aria-label="Collapse active panel"
            onClick={onClosePanel}
          >
            <X size={14} />
            {isExpanded && <span>Close Panel</span>}
          </button>
        </div>
      )}
    </nav>
  );
}
