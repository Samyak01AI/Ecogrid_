import { useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_STUDY, type Cell, type LayerKey, type OptimizerResult, type ScoreWeights } from '@ecogrid/domain';
import { StoreContext, type Store, type StudySummary } from './store-context.js';

export function StoreProvider({ cells: fallbackCells, children }: { cells: Cell[]; children: ReactNode }) {
  const [cells, setCells] = useState<Cell[]>(fallbackCells);
  const [studies, setStudies] = useState<StudySummary[]>([{ ...DEFAULT_STUDY, cellCount: DEFAULT_STUDY.rows * DEFAULT_STUDY.columns }]);
  const [activeStudyId, setActiveStudyId] = useState(() => new URLSearchParams(window.location.search).get('study') ?? DEFAULT_STUDY.id);
  const [selectedCell, setSelectedCell] = useState<string | null>(() => new URLSearchParams(location.search).get('cell'));
  const [selectedCells, setSelectedCells] = useState<string[]>(() => { const id = new URLSearchParams(location.search).get('cell'); return id ? [id] : []; });
  const [comparedCells, setComparedCells] = useState<string[]>([]);
  const [layer, setLayer] = useState<LayerKey>(() => {
    const search = new URLSearchParams(location.search).get('layer');
    return ['heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility', 'priority', 'recommended'].includes(search ?? '') ? search as LayerKey : 'priority';
  });
  const [plan, setPlan] = useState<OptimizerResult | null>(null);
  const [weights, setWeights] = useState<ScoreWeights>({ heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 });
  const [budget, setBudget] = useState(25000);
  const [user, setUser] = useState<Store['user']>(null);
  const [toasts, setToasts] = useState<Store['toasts']>([]);
  const selectCell: Store['selectCell'] = (id, additive) => {
    if (additive) {
      setSelectedCells((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
      setComparedCells((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(-2));
      setSelectedCell(id || null);
    } else {
      setSelectedCell(id || null);
      setSelectedCells(id ? [id] : []);
      setComparedCells([]);
    }
  };
  const selectCells: Store['selectCells'] = (ids) => {
    setSelectedCells(ids);
    setComparedCells(ids.slice(0, 2));
    setSelectedCell(ids[0] ?? null);
  };
  const pushToast: NonNullable<Store['pushToast']> = (message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };
  const value = useMemo<Store>(() => ({ cells, studies, activeStudyId, selectedCell, selectedCells, comparedCells, layer, plan, weights, budget, user, toasts, selectCell, selectCells, setCells, setStudies, setActiveStudyId, setLayer, setPlan, setWeights, setBudget, setUser, pushToast }), [cells, studies, activeStudyId, selectedCell, selectedCells, comparedCells, layer, plan, weights, budget, user, toasts]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
