import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/grid.js';
import { computeCellConfidence, confidenceSummary, illustrativeInput, planConfidence, sourceConfidence } from '../src/confidence.js';

const base = { coverage: 1, ageDays: 0, resolutionM: 30, targetResolutionM: 30, quality: 1 };

describe('data confidence', () => {
  it('stays within [0, 1] for every generated cell', () => {
    for (const cell of createGrid()) {
      expect(cell.dataConfidence).toBeGreaterThanOrEqual(0);
      expect(cell.dataConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('decreases as data gets older', () => {
    expect(sourceConfidence({ ...base, ageDays: 200 }, 90)).toBeLessThan(sourceConfidence({ ...base, ageDays: 10 }, 90));
  });

  it('decreases with coarser resolution, lower coverage, lower quality', () => {
    const best = sourceConfidence(base, 90);
    expect(sourceConfidence({ ...base, resolutionM: 250 }, 90)).toBeLessThan(best);
    expect(sourceConfidence({ ...base, coverage: 0.5 }, 90)).toBeLessThan(best);
    expect(sourceConfidence({ ...base, quality: 0.5 }, 90)).toBeLessThan(best);
  });

  it('is deterministic', () => {
    expect(createGrid().map((cell) => cell.dataConfidence)).toEqual(createGrid().map((cell) => cell.dataConfidence));
    const input = illustrativeInput({ landUse: 'plaza', surfaceType: 'paved' });
    expect(computeCellConfidence(input)).toBe(computeCellConfidence(input));
  });

  it('applies the disagreement penalty', () => {
    const input = illustrativeInput({ landUse: 'plaza', surfaceType: 'paved' });
    const conflicted = { ...input, heat: { ...input.heat, disagreement: 0.5 } };
    expect(computeCellConfidence(conflicted)).toBeLessThan(computeCellConfidence(input));
  });

  it('weights plan confidence by benefit', () => {
    const cells = [{ id: 'A01', dataConfidence: 1 }, { id: 'A02', dataConfidence: 0.5 }];
    const selected = [{ cellId: 'A01', combinedBenefit: 3 }, { cellId: 'A02', combinedBenefit: 1 }];
    expect(planConfidence(cells, selected)).toBeCloseTo(0.875);
    expect(planConfidence(cells, [])).toBe(0);
  });

  it('summarises confidence', () => {
    const summary = confidenceSummary([{ dataConfidence: 0.5 }, { dataConfidence: 0.7 }, { dataConfidence: 0.9 }]);
    expect(summary.mean).toBeCloseTo(0.7);
    expect(summary.lowCount).toBe(1);
  });
});
