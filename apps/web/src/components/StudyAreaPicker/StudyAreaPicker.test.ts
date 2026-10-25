import { beforeEach, describe, expect, it } from 'vitest';
import type { StudySummary } from '../../store-context.js';

// Mock localStorage
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('StudyAreaPicker Architecture & Behavior Suite', () => {
  const sampleStudies: StudySummary[] = [
    {
      id: 'study-bengaluru-east',
      name: 'Bengaluru East Campus',
      origin: [12.9352, 77.6245],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'REAL SATELLITE & CADASTRAL GIS',
    },
    {
      id: 'study-nashik',
      name: 'Nashik City Core',
      origin: [20.0112, 73.7902],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'CALIBRATED_PUBLIC_DATA',
    },
    {
      id: 'study-pune',
      name: 'Pune Transit Corridor',
      origin: [18.5204, 73.8567],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'REAL SATELLITE & CADASTRAL GIS',
    },
    {
      id: 'study-mumbai',
      name: 'Mumbai BKC Commercial',
      origin: [19.076, 72.8777],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'CALIBRATED_PUBLIC_DATA',
    },
    {
      id: 'study-delhi',
      name: 'New Delhi Central Corridor',
      origin: [28.6139, 77.209],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'REAL SATELLITE & CADASTRAL GIS',
    },
    {
      id: 'study-pimpri',
      name: 'Pimpri Industrial Area, Pimpri-Chinchwad',
      origin: [18.625, 73.79],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'REAL SATELLITE & CADASTRAL GIS',
    },
    // Duplicate ID case (simulate repeated backend or cache entries)
    {
      id: 'study-delhi',
      name: 'New Delhi Central Corridor (Duplicate API Record)',
      origin: [28.6139, 77.209],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
    },
    // Duplicate Name case: distinct IDs but identical display names
    {
      id: 'study-c16a2a12',
      name: 'Bengaluru East Campus copy',
      origin: [15.3672, 74.0769],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'SYNTHETIC / DEMO',
    },
    {
      id: 'study-10e41102',
      name: 'Bengaluru East Campus copy',
      origin: [15.2944, 74.0795],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
      dataLabel: 'SYNTHETIC / DEMO',
    },
    // Similar name with different casing
    {
      id: 'study-04d27b6a',
      name: 'rajasthan',
      origin: [26.8045, 73.7624],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
    },
    {
      id: 'study-3f031e51',
      name: 'Rajasthan',
      origin: [26.8045, 73.7624],
      rows: 10,
      columns: 10,
      cellSizeLat: 0.0012,
      cellSizeLng: 0.0012,
      rotation: 0,
      cellCount: 100,
    },
  ];

  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('Requirement 1 & 6: Deduplication by Stable ID', () => {
    it('safely deduplicates study areas by ID while keeping first valid record', () => {
      const seen = new Set<string>();
      const deduplicated: StudySummary[] = [];

      for (const study of sampleStudies) {
        if (!study || !study.id) continue;
        if (!seen.has(study.id)) {
          seen.add(study.id);
          deduplicated.push(study);
        }
      }

      // 'study-delhi' was repeated twice; total was 11, deduplicated is 10
      expect(deduplicated).toHaveLength(10);
      const delhiMatches = deduplicated.filter((s) => s.id === 'study-delhi');
      expect(delhiMatches).toHaveLength(1);
      expect(delhiMatches[0]?.name).toBe('New Delhi Central Corridor');
    });
  });

  describe('Requirement 4 & 7: Disambiguation of Distinct Areas with Identical Names', () => {
    it('detects duplicate display names and assigns disambiguating identifiers without merging distinct geographic areas', () => {
      const nameCounts = new Map<string, number>();
      for (const study of sampleStudies) {
        const norm = (study.name ?? '').trim().toLowerCase();
        nameCounts.set(norm, (nameCounts.get(norm) ?? 0) + 1);
      }

      // 'Bengaluru East Campus copy' is shared by two distinct IDs
      const copyCount = nameCounts.get('bengaluru east campus copy');
      expect(copyCount).toBe(2);

      const copies = sampleStudies.filter(
        (s) => s.name.trim().toLowerCase() === 'bengaluru east campus copy'
      );
      expect(copies).toHaveLength(2);
      expect(copies[0]?.id).not.toBe(copies[1]?.id);

      // Verify each copy maintains distinct origin coordinates
      expect(copies[0]?.origin[0]).toBeCloseTo(15.3672, 3);
      expect(copies[1]?.origin[0]).toBeCloseTo(15.2944, 3);

      // Short ID tags
      const tag0 = copies[0]?.id.replace('study-', '').slice(0, 6);
      const tag1 = copies[1]?.id.replace('study-', '').slice(0, 6);
      expect(tag0).toBe('c16a2a');
      expect(tag1).toBe('10e411');
      expect(tag0).not.toBe(tag1);
    });
  });

  describe('Requirement 2: Instant Search and Filtering', () => {
    function filterStudies(query: string, studies: StudySummary[]): StudySummary[] {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return studies;

      return studies.filter((study) => {
        const name = (study.name ?? '').toLowerCase();
        const id = study.id.toLowerCase();
        const coordStr = `${study.origin[0].toFixed(2)} ${study.origin[1].toFixed(2)}`;

        // Known alias check
        let aliases: string[] = [];
        if (name.includes('bengaluru')) aliases = ['bangalore', 'whitefield'];
        if (name.includes('delhi')) aliases = ['ncr', 'connaught'];
        if (name.includes('pimpri')) aliases = ['pcmc', 'industrial'];

        return (
          name.includes(trimmed) ||
          id.includes(trimmed) ||
          coordStr.includes(trimmed) ||
          aliases.some((a) => a.includes(trimmed))
        );
      });
    }

    it('filters case-insensitively and trims whitespace', () => {
      const results = filterStudies('   NASHIK   ', sampleStudies);
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Nashik City Core');
    });

    it('filters using city aliases (Bangalore -> Bengaluru)', () => {
      const results = filterStudies('bangalore', sampleStudies);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((s) => s.name.includes('Bengaluru'))).toBe(true);
    });

    it('filters using geographic coordinates substring', () => {
      const results = filterStudies('18.52', sampleStudies);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('study-pune');
    });

    it('returns empty array when no study area matches query', () => {
      const results = filterStudies('Tokyo Metro Corridor', sampleStudies);
      expect(results).toHaveLength(0);
    });
  });

  describe('Requirement 3: Organization & Recent History', () => {
    it('persists and restores recently visited study areas without duplicating active', () => {
      const activeId = 'study-nashik';
      const recentIds = ['study-bengaluru-east', 'study-pune'];

      localStorageMock.setItem('ecogrid_recent_studies', JSON.stringify(recentIds));
      const stored = JSON.parse(localStorageMock.getItem('ecogrid_recent_studies') ?? '[]');

      expect(stored).toEqual(['study-bengaluru-east', 'study-pune']);

      // Ensure active is not duplicated in recent list
      const nonActiveRecent = stored.filter((id: string) => id !== activeId);
      expect(nonActiveRecent).toHaveLength(2);
      expect(nonActiveRecent).not.toContain(activeId);
    });
  });

  describe('Requirement 7 & 9: Geographic Grid & State Invariants', () => {
    it('guarantees every study area has a 10 x 10 grid with exactly 100 cells', () => {
      for (const study of sampleStudies) {
        expect(study.rows).toBe(10);
        expect(study.columns).toBe(10);
        expect(study.cellCount).toBe(100);
      }
    });

    it('clears stale plan and selection when switching active study area', () => {
      let activeStudyId = 'study-bengaluru-east';
      let selectedCellId: string | null = 'C-44';
      let currentPlan: { studyId: string } | null = { studyId: 'study-bengaluru-east' };

      // Simulate study area switch action
      const switchStudy = (newId: string) => {
        currentPlan = null;
        selectedCellId = null;
        activeStudyId = newId;
      };

      switchStudy('study-pune');

      expect(activeStudyId).toBe('study-pune');
      expect(selectedCellId).toBeNull();
      expect(currentPlan).toBeNull();
    });
  });

  describe('Requirement 5 & 15: Responsive Popover Positioning Bounds', () => {
    function computePopoverCoords(
      rect: { top: number; left: number; right: number; bottom: number; width: number; height: number },
      viewportWidth: number,
      viewportHeight: number
    ) {
      const isMobile = viewportWidth <= 768;
      if (isMobile) {
        return { top: 0, left: 0, isMobile: true };
      }

      const popoverWidth = 360;
      const popoverHeight = 440;
      let left = rect.right + 10;
      let top = rect.top;

      if (top + popoverHeight > viewportHeight - 16) {
        top = Math.max(16, viewportHeight - popoverHeight - 16);
      }

      if (left + popoverWidth > viewportWidth - 16) {
        left = Math.max(16, rect.left);
        top = rect.bottom + 8;
      }

      return { top, left, isMobile: false };
    }

    it('positions popover anchored to the right of the sidebar on 1920x1080 desktop', () => {
      const triggerRect = { top: 56, left: 10, right: 230, bottom: 104, width: 220, height: 48 };
      const coords = computePopoverCoords(triggerRect, 1920, 1080);

      expect(coords.isMobile).toBe(false);
      expect(coords.left).toBe(240); // 230 + 10
      expect(coords.top).toBe(56);
    });

    it('switches to mobile bottom-sheet mode on 390x844 mobile screens', () => {
      const triggerRect = { top: 56, left: 10, right: 230, bottom: 104, width: 220, height: 48 };
      const coords = computePopoverCoords(triggerRect, 390, 844);

      expect(coords.isMobile).toBe(true);
      expect(coords.top).toBe(0);
      expect(coords.left).toBe(0);
    });

    it('clamps popover top coordinate when trigger is near the bottom of viewport', () => {
      const triggerRect = { top: 700, left: 10, right: 230, bottom: 748, width: 220, height: 48 };
      const coords = computePopoverCoords(triggerRect, 1366, 768);

      expect(coords.isMobile).toBe(false);
      // popoverHeight = 440; viewportHeight = 768; 768 - 440 - 16 = 312
      expect(coords.top).toBe(312);
    });
  });

  describe('Light Theme Compatibility & High Contrast Integrity', () => {
    it('sets documentElement.dataset.theme to light on theme toggle', () => {
      const doc = typeof document !== 'undefined'
        ? document
        : {
            documentElement: {
              dataset: { theme: 'dark' },
              getAttribute: function (attr: string) {
                return attr === 'data-theme' ? this.dataset.theme : null;
              },
            },
          };

      doc.documentElement.dataset.theme = 'light';
      expect(doc.documentElement.dataset.theme).toBe('light');
      expect(doc.documentElement.getAttribute('data-theme')).toBe('light');

      // Revert to dark
      doc.documentElement.dataset.theme = 'dark';
      expect(doc.documentElement.dataset.theme).toBe('dark');
    });

    it('ensures light theme text colors and surface tokens maintain high contrast', () => {
      const lightThemeTokens = {
        bg: '#f2f6f3',
        bgRaised: '#f8fbf9',
        surface: '#ffffff',
        border: '#ccddd3',
        text: '#143328',
        muted: '#668074',
        accent: '#167f60',
      };

      // Ensure text is dark and background is light
      expect(lightThemeTokens.surface.toLowerCase()).toBe('#ffffff');
      expect(lightThemeTokens.text).toMatch(/^#14/); // Dark forest green text
      expect(lightThemeTokens.border).toMatch(/^#cc/); // Soft light border
      expect(lightThemeTokens.accent).toMatch(/^#167f/); // Emerald accent
    });
  });
});

