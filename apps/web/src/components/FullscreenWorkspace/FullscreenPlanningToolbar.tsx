import React from 'react';
import {
  Activity,
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
      label: 'Interventions',
      icon: Sprout,
      badge: `${planCount}`,
      badgeTone: planCount > 0 ? 'mint' : 'default',
      tooltip: 'Recommended Interventions & Allocation List',
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
      badge: 'OR-Tools',
      badgeTone: 'blue',
      tooltip: 'Run OR-Tools CP-SAT Optimization Solver',
      hasNotification: budgetOutdated,
    },
    {
      key: 'inspector',
      label: 'Cell Inspector',
      icon: Scan,
      badge: selectedCellId ? selectedCellId : 'Select cell',
      badgeTone: selectedCellId ? 'mint' : 'default',
      tooltip: 'Selected Cell Microclimate & What-If Modeling',
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
    <nav className="fullscreen-planning-toolbar-dock" aria-label="Fullscreen planning tools">
      <div className="fullscreen-toolbar-container">
        {tools.map((item) => {
          const Icon = item.icon;
          const isActive = activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`fullscreen-toolbar-item ${isActive ? 'is-active' : ''}`}
              title={item.tooltip}
              aria-label={item.tooltip}
              aria-pressed={isActive}
              onClick={() => onTogglePanel(item.key)}
            >
              <span className="toolbar-item-icon-wrap">
                <Icon size={16} strokeWidth={1.8} />
                {item.hasNotification && <span className="toolbar-notification-dot" />}
              </span>
              <span className="toolbar-item-content">
                <span className="toolbar-item-label">{item.label}</span>
                <span className={`toolbar-item-badge tone-${item.badgeTone ?? 'default'}`}>
                  {item.badge}
                </span>
              </span>
              {isActive && <span className="toolbar-active-indicator" />}
            </button>
          );
        })}

        {activePanel && onClosePanel && (
          <button
            type="button"
            className="fullscreen-toolbar-close-btn"
            title="Collapse active panel (Esc)"
            aria-label="Collapse active panel"
            onClick={onClosePanel}
          >
            <X size={15} />
            <span>Collapse</span>
          </button>
        )}
      </div>
    </nav>
  );
}
