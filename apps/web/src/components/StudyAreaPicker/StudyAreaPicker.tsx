import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Compass,
  FilePlus2,
  Globe2,
  Layers,
  MapPin,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { StudySummary } from '../../store-context.js';
import './StudyAreaPicker.css';

export interface StudyAreaPickerProps {
  studies: StudySummary[];
  activeStudyId: string;
  onSelectStudy: (studyId: string) => Promise<void> | void;
  isLoading?: boolean;
  onNavigateNewLocation?: () => void;
  className?: string;
}

const RECENT_STORAGE_KEY = 'ecogrid_recent_studies';

// City/Region metadata lookup for enhanced search matching & tagging
const CITY_METADATA_MAP: Record<string, { city: string; region: string; aliases: string[] }> = {
  'study-bengaluru-east': { city: 'Bengaluru', region: 'Karnataka', aliases: ['bangalore', 'whitefield', 'bellandur', 'campus'] },
  'study-nashik': { city: 'Nashik', region: 'Maharashtra', aliases: ['godavari', 'core', 'old city'] },
  'study-pune': { city: 'Pune', region: 'Maharashtra', aliases: ['pune transit', 'shivajinagar', 'pimpri', 'corridor'] },
  'study-mumbai': { city: 'Mumbai', region: 'Maharashtra', aliases: ['bkc', 'bandra', 'kurla', 'commercial'] },
  'study-delhi': { city: 'New Delhi', region: 'Delhi NCR', aliases: ['delhi', 'connaught', 'central corridor', 'ncr'] },
  'study-pimpri': { city: 'Pimpri-Chinchwad', region: 'Maharashtra', aliases: ['pimpri', 'industrial', 'bhosari', 'pcmc'] },
};

function getStudyMetadata(study: StudySummary) {
  const existing = CITY_METADATA_MAP[study.id];
  if (existing) return existing;

  const lowerName = study.name.toLowerCase();
  let city = 'Urban Area';
  let region = 'India';
  const aliases: string[] = [];

  if (lowerName.includes('bengaluru') || lowerName.includes('bangalore')) {
    city = 'Bengaluru';
    region = 'Karnataka';
    aliases.push('bangalore', 'campus');
  } else if (lowerName.includes('nashik')) {
    city = 'Nashik';
    region = 'Maharashtra';
  } else if (lowerName.includes('pune')) {
    city = 'Pune';
    region = 'Maharashtra';
  } else if (lowerName.includes('mumbai') || lowerName.includes('bkc')) {
    city = 'Mumbai';
    region = 'Maharashtra';
  } else if (lowerName.includes('delhi')) {
    city = 'New Delhi';
    region = 'Delhi NCR';
  } else if (lowerName.includes('pimpri')) {
    city = 'Pimpri-Chinchwad';
    region = 'Maharashtra';
  } else if (lowerName.includes('rajasthan') || lowerName.includes('jaipur')) {
    city = 'Rajasthan';
    region = 'Western Zone';
    aliases.push('jaipur', 'desert');
  } else if (lowerName.includes('kashmir') || lowerName.includes('srinagar')) {
    city = 'Kashmir';
    region = 'Jammu & Kashmir';
    aliases.push('himalayas', 'valley');
  } else if (lowerName.includes('kochi') || lowerName.includes('kerala')) {
    city = 'Kochi';
    region = 'Kerala';
    aliases.push('cochin', 'malabar');
  }

  return { city, region, aliases };
}

function getStoredRecentStudyIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persistRecentStudyId(studyId: string): void {
  try {
    const current = getStoredRecentStudyIds().filter((id) => id !== studyId);
    const updated = [studyId, ...current].slice(0, 5);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors if localStorage is restricted
  }
}

export function StudyAreaPicker({
  studies,
  activeStudyId,
  onSelectStudy,
  isLoading = false,
  onNavigateNewLocation,
  className = '',
}: StudyAreaPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number; isMobile: boolean }>({
    top: 0,
    left: 0,
    isMobile: false,
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  // Deduplicate studies by stable ID
  const uniqueStudies = useMemo(() => {
    const seen = new Set<string>();
    const deduplicated: StudySummary[] = [];
    for (const study of studies) {
      if (!study || !study.id) continue;
      if (!seen.has(study.id)) {
        seen.add(study.id);
        deduplicated.push(study);
      }
    }
    return deduplicated;
  }, [studies]);

  // Find active study object
  const activeStudy = useMemo(() => {
    return uniqueStudies.find((s) => s.id === activeStudyId) ?? uniqueStudies[0] ?? null;
  }, [uniqueStudies, activeStudyId]);

  // Track name counts for duplicate/similar display names to provide disambiguating metadata
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const study of uniqueStudies) {
      const norm = (study.name ?? '').trim().toLowerCase();
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
    return counts;
  }, [uniqueStudies]);

  // Compute recent study objects
  const recentStudies = useMemo(() => {
    const recentIds = getStoredRecentStudyIds();
    return recentIds
      .filter((id) => id !== activeStudyId)
      .map((id) => uniqueStudies.find((s) => s.id === id))
      .filter((s): s is StudySummary => s !== undefined)
      .slice(0, 3);
  }, [uniqueStudies, activeStudyId]);

  // Instant client-side search filtering
  const filteredStudies = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return uniqueStudies;

    return uniqueStudies.filter((study) => {
      const name = (study.name ?? '').toLowerCase();
      const id = study.id.toLowerCase();
      const meta = getStudyMetadata(study);
      const city = meta.city.toLowerCase();
      const region = meta.region.toLowerCase();
      const coordStr = `${study.origin[0].toFixed(2)} ${study.origin[1].toFixed(2)}`;

      return (
        name.includes(trimmed) ||
        id.includes(trimmed) ||
        city.includes(trimmed) ||
        region.includes(trimmed) ||
        coordStr.includes(trimmed) ||
        meta.aliases.some((alias) => alias.includes(trimmed))
      );
    });
  }, [uniqueStudies, searchQuery]);

  // Categorize for grouped view when not searching
  const groupedSections = useMemo(() => {
    if (searchQuery.trim().length > 0) {
      return [
        {
          id: 'search-results',
          title: `SEARCH RESULTS (${filteredStudies.length})`,
          items: filteredStudies,
        },
      ];
    }

    const sections: Array<{ id: string; title: string; items: StudySummary[] }> = [];

    // 1. RECENT / ACTIVE
    const activeAndRecent: StudySummary[] = [];
    if (activeStudy) activeAndRecent.push(activeStudy);
    for (const recent of recentStudies) {
      if (!activeAndRecent.some((s) => s.id === recent.id)) {
        activeAndRecent.push(recent);
      }
    }
    if (activeAndRecent.length > 0) {
      sections.push({
        id: 'recent-active',
        title: 'RECENT & ACTIVE STUDY AREA',
        items: activeAndRecent,
      });
    }

    // 2. CALIBRATED & PUBLIC GIS AREAS
    const calibrated = uniqueStudies.filter(
      (s) =>
        s.id in CITY_METADATA_MAP ||
        s.dataLabel === 'REAL SATELLITE & CADASTRAL GIS' ||
        s.dataLabel === 'CALIBRATED_PUBLIC_DATA' ||
        (s.id.startsWith('study-') &&
          !s.name.toLowerCase().includes('copy'))
    );

    const otherCalibrated = calibrated.filter((s) => !activeAndRecent.some((ar) => ar.id === s.id));
    if (otherCalibrated.length > 0) {
      sections.push({
        id: 'calibrated-public',
        title: 'CALIBRATED GIS CORRIDORS',
        items: otherCalibrated,
      });
    }

    // 3. CUSTOM SCENARIOS & OTHER AREAS
    const custom = uniqueStudies.filter(
      (s) => !activeAndRecent.some((ar) => ar.id === s.id) && !otherCalibrated.some((c) => c.id === s.id)
    );
    if (custom.length > 0) {
      sections.push({
        id: 'custom-scenarios',
        title: 'CUSTOM SCENARIOS & COPIES',
        items: custom,
      });
    }

    return sections;
  }, [searchQuery, filteredStudies, activeStudy, recentStudies, uniqueStudies]);

  // Flat list of selectable items for keyboard navigation index
  const flatSelectableItems = useMemo(() => {
    const list: StudySummary[] = [];
    for (const section of groupedSections) {
      for (const item of section.items) {
        if (!list.some((s) => s.id === item.id)) {
          list.push(item);
        }
      }
    }
    return list;
  }, [groupedSections]);

  // Recalculate floating popover coordinates
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      setPopoverCoords({ top: 0, left: 0, isMobile: true });
      return;
    }

    // Desktop: Anchor to the right of the sidebar with small offset
    const popoverWidth = 360;
    const popoverHeight = 440;
    let left = rect.right + 10;
    let top = rect.top;

    // Adjust if overflowing bottom
    if (top + popoverHeight > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - popoverHeight - 16);
    }

    // Adjust if overflowing right
    if (left + popoverWidth > window.innerWidth - 16) {
      left = Math.max(16, rect.left);
      top = rect.bottom + 8;
    }

    setPopoverCoords({ top, left, isMobile: false });
  }, []);

  // Open & close handlers
  const handleOpen = () => {
    updatePosition();
    setIsOpen(true);
    setSearchQuery('');
    setHighlightedIndex(0);
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    async (studyId: string) => {
      persistRecentStudyId(studyId);
      handleClose();
      await onSelectStudy(studyId);
    },
    [handleClose, onSelectStudy]
  );

  // Position updates on resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen, updatePosition]);

  // Focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      handleClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen, handleClose]);

  // Keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleOpen();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < flatSelectableItems.length ? prev + 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : flatSelectableItems.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = flatSelectableItems[highlightedIndex];
      if (selected) {
        void handleSelect(selected.id);
      }
    }
  };

  const activeMeta = activeStudy ? getStudyMetadata(activeStudy) : null;

  return (
    <div className={`study-area-picker-root ${className}`}>
      {/* Default Closed State Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        className={`study-area-trigger ${isOpen ? 'is-open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={`Current study area: ${activeStudy?.name ?? 'Bengaluru East Campus'}, 10 by 10 grid, 100 cells`}
        disabled={isLoading}
        onClick={() => (isOpen ? handleClose() : handleOpen())}
        onKeyDown={handleKeyDown}
      >
        <span className="study-trigger-avatar" aria-hidden="true">
          <MapPin size={15} className="study-pin-icon" />
        </span>

        <span className="study-trigger-text">
          <span className="study-trigger-title">
            {activeStudy?.name ?? 'Bengaluru East Campus'}
          </span>
          <span className="study-trigger-subtitle">
            <span className="study-trigger-grid">
              {activeStudy ? `${activeStudy.rows} × ${activeStudy.columns}` : '10 × 10'} · 100 cells
            </span>
            <i className="study-trigger-dot" aria-hidden="true" />
            <span className="study-trigger-status">
              {isLoading ? 'Loading…' : activeMeta?.city ?? 'Active'}
            </span>
          </span>
        </span>

        <span className="study-trigger-chevron" aria-hidden="true">
          <ChevronDown size={15} className={isOpen ? 'rotate-180' : ''} />
        </span>
      </button>

      {/* Floating Popover / Mobile Sheet */}
      {isOpen &&
        createPortal(
          <div
            className={`study-picker-portal ${popoverCoords.isMobile ? 'is-mobile-sheet' : 'is-floating'}`}
            role="presentation"
          >
            {/* Mobile Backdrop */}
            {popoverCoords.isMobile && (
              <div
                className="study-picker-backdrop"
                aria-hidden="true"
                onClick={handleClose}
              />
            )}

            <div
              ref={popoverRef}
              id={listboxId}
              role="dialog"
              aria-label="Select study area"
              className="study-picker-popover"
              style={
                !popoverCoords.isMobile
                  ? {
                      position: 'fixed',
                      top: `${popoverCoords.top}px`,
                      left: `${popoverCoords.left}px`,
                      width: '360px',
                    }
                  : undefined
              }
              onKeyDown={handleKeyDown}
            >
              {/* Header */}
              <div className="study-popover-header">
                <div className="study-popover-title-row">
                  <div className="study-popover-title">
                    <Compass size={14} className="popover-icon" />
                    <span>Select Study Area</span>
                  </div>
                  <button
                    type="button"
                    className="study-popover-close"
                    aria-label="Close study area selector"
                    onClick={handleClose}
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Instant Search Bar */}
                <div className="study-search-wrap">
                  <Search size={14} className="study-search-icon" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    className="study-search-input"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    placeholder="Search locations by city, name, state…"
                    aria-label="Search study areas"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {searchQuery.trim().length > 0 && (
                    <button
                      type="button"
                      className="study-search-clear"
                      aria-label="Clear search"
                      onClick={() => {
                        setSearchQuery('');
                        setHighlightedIndex(0);
                        searchInputRef.current?.focus();
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Location List */}
              <div
                className="study-popover-list"
                role="listbox"
                aria-label="Available study areas"
              >
                {flatSelectableItems.length === 0 ? (
                  <div className="study-empty-state">
                    <Globe2 size={24} className="study-empty-icon" />
                    <b>No study areas found</b>
                    <p>No locations match &ldquo;{searchQuery}&rdquo;. Try another search term or import a custom bounding grid.</p>
                  </div>
                ) : (
                  groupedSections.map((section) => (
                    <div key={section.id} className="study-group-section">
                      <div className="study-group-label" role="presentation">
                        {section.title}
                      </div>

                      <div className="study-group-items">
                        {section.items.map((study) => {
                          const isActive = study.id === activeStudyId;
                          const flatIndex = flatSelectableItems.findIndex((s) => s.id === study.id);
                          const isHighlighted = flatIndex === highlightedIndex;
                          const meta = getStudyMetadata(study);

                          // Check if name is shared with other distinct areas
                          const normName = (study.name ?? '').trim().toLowerCase();
                          const isNameDuplicate = (nameCounts.get(normName) ?? 0) > 1;

                          // Short identifier tag
                          const shortId = study.id.replace('study-', '').slice(0, 6);
                          const originStr = `${study.origin[0].toFixed(2)}°N, ${study.origin[1].toFixed(2)}°E`;

                          return (
                            <button
                              key={`${section.id}-${study.id}`}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              className={`study-item-button ${isActive ? 'is-active' : ''} ${
                                isHighlighted ? 'is-highlighted' : ''
                              }`}
                              onClick={() => void handleSelect(study.id)}
                              onMouseEnter={() => setHighlightedIndex(flatIndex)}
                            >
                              <div className="study-item-main">
                                <div className="study-item-header">
                                  <span className="study-item-name">{study.name}</span>
                                  {isNameDuplicate && (
                                    <span className="study-disambiguation-badge" title={`Distinct area ID: ${study.id}`}>
                                      ID: {shortId}
                                    </span>
                                  )}
                                  {isActive && (
                                    <span className="study-active-badge">
                                      <Check size={11} strokeWidth={2.5} /> ACTIVE
                                    </span>
                                  )}
                                </div>

                                <div className="study-item-details">
                                  <span className="study-item-city">
                                    <MapPin size={10} className="detail-icon" />
                                    {meta.city}, {meta.region}
                                  </span>
                                  <span className="study-item-dot">·</span>
                                  <span className="study-item-grid">
                                    {study.rows} × {study.columns} · {study.cellCount ?? 100} cells
                                  </span>
                                  <span className="study-item-dot">·</span>
                                  <span className="study-item-coords">{originStr}</span>
                                </div>
                              </div>

                              <div className="study-item-meta">
                                {study.dataLabel?.includes('REAL') ? (
                                  <span className="study-provenance-pill real" title="Verified satellite and cadastral GIS layers">
                                    <ShieldCheck size={10} /> REAL GIS
                                  </span>
                                ) : (
                                  <span className="study-provenance-pill demo" title="Standard calibrated demonstration grid">
                                    100 CELLS
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="study-popover-footer">
                <div className="study-count-summary">
                  <Layers size={12} />
                  <span>
                    {uniqueStudies.length} study area{uniqueStudies.length === 1 ? '' : 's'} available
                  </span>
                </div>

                {onNavigateNewLocation && (
                  <button
                    type="button"
                    className="study-new-location-btn"
                    onClick={() => {
                      handleClose();
                      onNavigateNewLocation();
                    }}
                  >
                    <FilePlus2 size={13} />
                    <span>Change / search location…</span>
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
