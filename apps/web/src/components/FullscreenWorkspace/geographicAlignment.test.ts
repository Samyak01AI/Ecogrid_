import { describe, it, expect } from 'vitest';
import {
  createGrid,
  DEFAULT_STUDY,
  toLeafletLatLng,
  fromGeoJSONPoint,
  toGeoJSONPoint,
  isPointInPolygon,
  computePolygonCentroid,
  validateCellGeometry,
  validateInterventionCandidate,
  groupInterventionsForMap,
  layoutInterventionsForMap,
  type Cell,
  type Candidate,
  type OptimizerResult,
  type LatLng,
} from '@ecogrid/domain';

describe('EcoGrid AI 2.0 Geographic & Marker Alignment Tests (A through J)', () => {
  const delhiStudy = {
    id: 'study-delhi',
    name: 'New Delhi Central Corridor',
    origin: [28.6139, 77.209] as LatLng,
    rows: 10,
    columns: 10,
    cellSizeLat: 0.0012,
    cellSizeLng: 0.0012,
    rotation: 0,
    gridVersion: '2.0',
    crs: 'EPSG:4326',
  };

  const bengaluruStudy = {
    ...DEFAULT_STUDY,
    gridVersion: '2.0',
    crs: 'EPSG:4326',
  };

  const delhiCells = createGrid(delhiStudy);
  const bengaluruCells = createGrid(bengaluruStudy);

  // -------------------------------------------------------------------------
  // Test A: Cell centroid alignment
  // -------------------------------------------------------------------------
  it('Test A: confirms every cell centroid lies strictly inside its bounding polygon across all study areas', () => {
    expect(delhiCells.length).toBe(100);
    expect(bengaluruCells.length).toBe(100);

    for (const cell of delhiCells) {
      const { valid, errors } = validateCellGeometry(cell);
      expect(valid, `Delhi cell ${cell.id} failed validation: ${errors.join(', ')}`).toBe(true);
      expect(isPointInPolygon(cell.center, cell.polygon)).toBe(true);
    }

    for (const cell of bengaluruCells) {
      const { valid, errors } = validateCellGeometry(cell);
      expect(valid, `Bengaluru cell ${cell.id} failed validation: ${errors.join(', ')}`).toBe(true);
      expect(isPointInPolygon(cell.center, cell.polygon)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test B: Intervention association
  // -------------------------------------------------------------------------
  it('Test B: resolves every intervention candidate to an existing cell in the correct study area and grid version', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));

    const validCandidate: Candidate = {
      cellId: 'A01',
      studyAreaId: 'study-delhi',
      gridVersion: '2.0',
      areaName: 'Zone A',
      interventionId: 'native_trees',
      interventionName: 'Native Shade Trees',
      quantity: 4,
      unit: 'trees',
      cost: 16000,
      categoryBenefit: { heat: 0.35, vegetation: 0.45, pedestrian: 0.3, connectivity: 0.25 },
      combinedBenefit: 0.38,
      benefitPerCost: 0.000023,
    };

    const result = validateInterventionCandidate({
      candidate: validCandidate,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.marker.cellId).toBe('A01');
      expect(result.marker.position).toEqual(cellsById.get('A01')!.center);
    }
  });

  // -------------------------------------------------------------------------
  // Test C: Coordinate ordering
  // -------------------------------------------------------------------------
  it('Test C: correctly converts and verifies Leaflet [lat, lng] and GeoJSON [lng, lat] coordinate ordering', () => {
    // Delhi reference point: Lat 28.6139 N, Lng 77.2090 E
    const leafletPoint: LatLng = [28.6139, 77.209];
    const geoJsonPoint = toGeoJSONPoint(leafletPoint);

    // GeoJSON must have longitude first, then latitude
    expect(geoJsonPoint[0]).toBe(77.209);
    expect(geoJsonPoint[1]).toBe(28.6139);

    // Conversion back to Leaflet via fromGeoJSONPoint
    const restored = fromGeoJSONPoint(geoJsonPoint);
    expect(restored[0]).toBe(28.6139);
    expect(restored[1]).toBe(77.209);

    // Conversion back to Leaflet via toLeafletLatLng with GeoJSON flag
    const restoredViaFlag = toLeafletLatLng(geoJsonPoint, true);
    expect(restoredViaFlag[0]).toBe(28.6139);
    expect(restoredViaFlag[1]).toBe(77.209);

    // Planar centroid of symmetric square matches center
    const polygon: LatLng[] = [
      [10.0, 20.0],
      [10.0, 20.01],
      [10.01, 20.01],
      [10.01, 20.0],
      [10.0, 20.0],
    ];
    const centroid = computePolygonCentroid(polygon);
    expect(centroid[0]).toBeCloseTo(10.005, 5);
    expect(centroid[1]).toBeCloseTo(20.005, 5);
  });

  // -------------------------------------------------------------------------
  // Test D: Location switching
  // -------------------------------------------------------------------------
  it('Test D: confirms that switching study areas rejects stale intervention markers from previous location', () => {
    const delhiCellsById = new Map(delhiCells.map((c) => [c.id, c]));

    // Stale plan from Bengaluru East
    const staleBengaluruPlan: OptimizerResult = {
      studyAreaId: 'study-bengaluru-east',
      gridVersion: '2.0',
      selected: [
        {
          cellId: 'A01',
          studyAreaId: 'study-bengaluru-east',
          gridVersion: '2.0',
          areaName: 'Bengaluru Zone',
          interventionId: 'native_trees',
          interventionName: 'Native Trees',
          quantity: 2,
          unit: 'trees',
          cost: 8000,
          categoryBenefit: { heat: 0.2, vegetation: 0.3, pedestrian: 0.2, connectivity: 0.2 },
          combinedBenefit: 0.25,
          benefitPerCost: 0.00003,
        },
      ],
      rejected: [],
      totalCost: 8000,
      remainingBudget: 92000,
      utilization: 0.08,
      combinedBenefit: 0.25,
      categoryBenefits: { heat: 0.2, vegetation: 0.3, pedestrian: 0.2, connectivity: 0.2 },
      cellsImproved: 1,
      validation: { valid: true, violations: [] },
    };

    // When active study is 'study-delhi', the Bengaluru plan MUST produce 0 markers
    const { groups, failures } = groupInterventionsForMap({
      plan: staleBengaluruPlan,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById: delhiCellsById,
    });

    expect(groups.length).toBe(0);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.reason).toContain('does not match active study');
  });

  // -------------------------------------------------------------------------
  // Test E: Grid resizing and version consistency
  // -------------------------------------------------------------------------
  it('Test E: rejects plans referencing mismatched grid versions or nonexistent cells', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));

    const outdatedVersionPlan: OptimizerResult = {
      studyAreaId: 'study-delhi',
      gridVersion: '1.0-legacy',
      selected: [
        {
          cellId: 'A01',
          studyAreaId: 'study-delhi',
          gridVersion: '1.0-legacy',
          areaName: 'Zone A',
          interventionId: 'cool_surface',
          interventionName: 'Cool Pavement Coating',
          quantity: 1,
          unit: 'sqm',
          cost: 5000,
          categoryBenefit: { heat: 0.4, vegetation: 0, pedestrian: 0.3, connectivity: 0 },
          combinedBenefit: 0.2,
          benefitPerCost: 0.00004,
        },
      ],
      rejected: [],
      totalCost: 5000,
      remainingBudget: 95000,
      utilization: 0.05,
      combinedBenefit: 0.2,
      categoryBenefits: { heat: 0.4, vegetation: 0, pedestrian: 0.3, connectivity: 0 },
      cellsImproved: 1,
      validation: { valid: true, violations: [] },
    };

    const { groups, failures } = groupInterventionsForMap({
      plan: outdatedVersionPlan,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById,
    });

    expect(groups.length).toBe(0);
    expect(failures.length).toBe(1);
    expect(failures[0]!.reason).toContain('grid version');
  });

  // -------------------------------------------------------------------------
  // Test F: Individual markers & layout without numerical count badges
  // -------------------------------------------------------------------------
  it('Test F: displays distinct intervention markers without numerical grouping badges and preserves geographic containment', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));
    const targetCell = delhiCells.find((c) => c.id === 'B04')!;

    const multiInterventionPlan: OptimizerResult = {
      studyAreaId: 'study-delhi',
      gridVersion: '2.0',
      selected: [
        {
          cellId: 'B04',
          studyAreaId: 'study-delhi',
          gridVersion: '2.0',
          areaName: targetCell.areaName,
          interventionId: 'native_trees',
          interventionName: 'Native Trees',
          quantity: 4,
          unit: 'trees',
          cost: 16000,
          categoryBenefit: { heat: 0.5, vegetation: 0.6, pedestrian: 0.4, connectivity: 0.3 },
          combinedBenefit: 0.52,
          benefitPerCost: 0.00003,
        },
        {
          cellId: 'B04',
          studyAreaId: 'study-delhi',
          gridVersion: '2.0',
          areaName: targetCell.areaName,
          interventionId: 'shade_structure',
          interventionName: 'Civic Shading Canopy',
          quantity: 1,
          unit: 'canopy',
          cost: 25000,
          categoryBenefit: { heat: 0.4, vegetation: 0.1, pedestrian: 0.7, connectivity: 0.2 },
          combinedBenefit: 0.41,
          benefitPerCost: 0.000016,
        },
        {
          cellId: 'B04',
          studyAreaId: 'study-delhi',
          gridVersion: '2.0',
          areaName: targetCell.areaName,
          interventionId: 'pollinator_corridor',
          interventionName: 'Pollinator Link',
          quantity: 2,
          unit: 'strips',
          cost: 4000,
          categoryBenefit: { heat: 0.1, vegetation: 0.4, pedestrian: 0.2, connectivity: 0.6 },
          combinedBenefit: 0.32,
          benefitPerCost: 0.00008,
        },
      ],
      rejected: [],
      totalCost: 45000,
      remainingBudget: 55000,
      utilization: 0.45,
      combinedBenefit: 1.25,
      categoryBenefits: { heat: 1.0, vegetation: 1.1, pedestrian: 1.3, connectivity: 1.1 },
      cellsImproved: 1,
      validation: { valid: true, violations: [] },
    };

    const { markers, failures } = layoutInterventionsForMap({
      plan: multiInterventionPlan,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById,
    });

    expect(failures.length).toBe(0);
    // Preserves all 3 interventions as distinct visual markers (NO count badge collapse)
    expect(markers.length).toBe(3);

    const interventionIds = markers.map((m) => m.candidate.interventionId);
    expect(interventionIds).toContain('native_trees');
    expect(interventionIds).toContain('shade_structure');
    expect(interventionIds).toContain('pollinator_corridor');

    // All markers are strictly contained within cell B04's polygon
    for (const marker of markers) {
      expect(marker.cellId).toBe('B04');
      expect(isPointInPolygon(marker.position, targetCell.polygon)).toBe(true);
      expect(marker.totalInCell).toBe(3);
    }

    // Verify single-intervention cell places marker at exact centroid
    const singlePlan: OptimizerResult = {
      ...multiInterventionPlan,
      selected: [multiInterventionPlan.selected[0]!],
    };
    const { markers: singleMarkers } = layoutInterventionsForMap({
      plan: singlePlan,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById,
    });
    expect(singleMarkers.length).toBe(1);
    expect(singleMarkers[0]!.position[0]).toBe(targetCell.center[0]);
    expect(singleMarkers[0]!.position[1]).toBe(targetCell.center[1]);
  });

  // -------------------------------------------------------------------------
  // Test G: Fullscreen mode position stability
  // -------------------------------------------------------------------------
  it('Test G: verifies marker geographic coordinates remain identical regardless of layout or fullscreen toggles', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));

    const plan: OptimizerResult = {
      studyAreaId: 'study-delhi',
      gridVersion: '2.0',
      selected: [
        {
          cellId: 'C05',
          studyAreaId: 'study-delhi',
          gridVersion: '2.0',
          areaName: 'Central Vista',
          interventionId: 'green_buffer',
          interventionName: 'Dense Green Buffer',
          quantity: 1,
          unit: 'buffer',
          cost: 12000,
          categoryBenefit: { heat: 0.4, vegetation: 0.5, pedestrian: 0.3, connectivity: 0.3 },
          combinedBenefit: 0.42,
          benefitPerCost: 0.000035,
        },
      ],
      rejected: [],
      totalCost: 12000,
      remainingBudget: 88000,
      utilization: 0.12,
      combinedBenefit: 0.42,
      categoryBenefits: { heat: 0.4, vegetation: 0.5, pedestrian: 0.3, connectivity: 0.3 },
      cellsImproved: 1,
      validation: { valid: true, violations: [] },
    };

    // First resolution (e.g. standard view)
    const view1 = groupInterventionsForMap({
      plan,
      activeStudyId: 'study-delhi',
      cellsById,
    });

    // Second resolution (e.g. fullscreen view)
    const view2 = groupInterventionsForMap({
      plan,
      activeStudyId: 'study-delhi',
      cellsById,
    });

    expect(view1.groups[0]!.position).toEqual(view2.groups[0]!.position);
    expect(view1.groups[0]!.position).toEqual(cellsById.get('C05')!.center);
  });

  // -------------------------------------------------------------------------
  // Test H: Map pan and zoom coordinate invariance
  // -------------------------------------------------------------------------
  it('Test H: verifies marker geographic positions are strictly anchored to WGS84 coordinates without screen pixel drift', () => {
    for (const cell of delhiCells) {
      // Cell center must match the mathematical centroid of the polygon
      const expectedLat = delhiStudy.origin[0] + (cell.row + 0.5) * delhiStudy.cellSizeLat;
      const expectedLng = delhiStudy.origin[1] + (cell.col + 0.5) * delhiStudy.cellSizeLng;
      expect(cell.center[0]).toBeCloseTo(expectedLat, 6);
      expect(cell.center[1]).toBeCloseTo(expectedLng, 6);
    }
  });

  // -------------------------------------------------------------------------
  // Test I: Plan integrity
  // -------------------------------------------------------------------------
  it('Test I: confirms all valid optimizer-selected interventions are preserved in the underlying grouped marker data', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));

    const candidates: Candidate[] = [
      {
        cellId: 'D01',
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        areaName: 'D01',
        interventionId: 'native_trees',
        interventionName: 'Native Trees',
        quantity: 2,
        cost: 8000,
        unit: 'trees',
        categoryBenefit: { heat: 0.2, vegetation: 0.3, pedestrian: 0.2, connectivity: 0.2 },
        combinedBenefit: 0.25,
        benefitPerCost: 0.00003,
      },
      {
        cellId: 'D02',
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        areaName: 'D02',
        interventionId: 'cool_surface',
        interventionName: 'Cool Surface',
        quantity: 1,
        cost: 4000,
        unit: 'pave',
        categoryBenefit: { heat: 0.3, vegetation: 0.0, pedestrian: 0.2, connectivity: 0.0 },
        combinedBenefit: 0.18,
        benefitPerCost: 0.000045,
      },
    ];

    const plan: OptimizerResult = {
      studyAreaId: 'study-delhi',
      gridVersion: '2.0',
      selected: candidates,
      rejected: [],
      totalCost: 12000,
      remainingBudget: 88000,
      utilization: 0.12,
      combinedBenefit: 0.43,
      categoryBenefits: { heat: 0.5, vegetation: 0.3, pedestrian: 0.4, connectivity: 0.2 },
      cellsImproved: 2,
      validation: { valid: true, violations: [] },
    };

    const { groups } = groupInterventionsForMap({
      plan,
      activeStudyId: 'study-delhi',
      cellsById,
    });

    expect(groups.length).toBe(2);
    const totalInterventions = groups.reduce((sum, g) => sum + g.candidates.length, 0);
    expect(totalInterventions).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test J: Invalid geographic records handling
  // -------------------------------------------------------------------------
  it('Test J: safely rejects invalid coordinates, NaN values, and nonexistent cell references without crashing', () => {
    const cellsById = new Map(delhiCells.map((c) => [c.id, c]));

    const invalidCandidates: Candidate[] = [
      {
        cellId: 'Z99', // Unknown cell
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        areaName: 'Ghost',
        interventionId: 'native_trees',
        interventionName: 'Trees',
        quantity: 1,
        cost: 4000,
        unit: 'trees',
        categoryBenefit: { heat: 0.1, vegetation: 0.1, pedestrian: 0.1, connectivity: 0.1 },
        combinedBenefit: 0.1,
        benefitPerCost: 0.000025,
      },
      {
        cellId: 'A01',
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        coordinates: [999.0, 999.0] as LatLng, // Out-of-bounds invalid numbers
        areaName: 'A01',
        interventionId: 'shade_structure',
        interventionName: 'Canopy',
        quantity: 1,
        cost: 15000,
        unit: 'canopy',
        categoryBenefit: { heat: 0.3, vegetation: 0.0, pedestrian: 0.4, connectivity: 0.1 },
        combinedBenefit: 0.25,
        benefitPerCost: 0.000016,
      },
      {
        cellId: 'A01',
        studyAreaId: 'study-delhi',
        gridVersion: '2.0',
        coordinates: [28.70, 77.30] as LatLng, // Valid numbers, but outside cell A01's polygon
        areaName: 'A01',
        interventionId: 'cool_surface',
        interventionName: 'Cool Surface',
        quantity: 1,
        cost: 5000,
        unit: 'pavement',
        categoryBenefit: { heat: 0.3, vegetation: 0.0, pedestrian: 0.2, connectivity: 0.0 },
        combinedBenefit: 0.2,
        benefitPerCost: 0.00004,
      },
    ];

    const badPlan: OptimizerResult = {
      studyAreaId: 'study-delhi',
      gridVersion: '2.0',
      selected: invalidCandidates,
      rejected: [],
      totalCost: 24000,
      remainingBudget: 76000,
      utilization: 0.24,
      combinedBenefit: 0.55,
      categoryBenefits: { heat: 0.7, vegetation: 0.1, pedestrian: 0.7, connectivity: 0.2 },
      cellsImproved: 3,
      validation: { valid: true, violations: [] },
    };

    const { groups, failures } = groupInterventionsForMap({
      plan: badPlan,
      activeStudyId: 'study-delhi',
      activeGridVersion: '2.0',
      cellsById,
    });

    // All 3 bad records must be safely discarded without unhandled exceptions
    expect(groups.length).toBe(0);
    expect(failures.length).toBe(3);
    expect(failures.some((f) => f.reason.includes('Unknown cell ID'))).toBe(true);
    expect(failures.some((f) => f.reason.includes('Invalid coordinates'))).toBe(true);
    expect(failures.some((f) => f.reason.includes('lies outside cell polygon'))).toBe(true);
  });
});
