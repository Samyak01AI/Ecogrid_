import { createContext } from 'react';
import type { Cell, LayerKey, OptimizerResult, ScoreWeights, StudyArea } from '@ecogrid/domain';
import type { UserSession } from './api.js';

export type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' };
export type StudySummary = StudyArea & {
  cellCount: number;
  dataLabel?: string | undefined;
  data_label?: string | undefined;
  isPublic?: boolean | undefined;
};
export type Store = {
  cells: Cell[];
  studies: StudySummary[];
  activeStudyId: string;
  selectedCell: string | null;
  selectedCells: string[];
  comparedCells: string[];
  layer: LayerKey;
  plan: OptimizerResult | null;
  weights: ScoreWeights;
  budget: number;
  user: UserSession | null;
  toasts: Toast[];
  selectCell: (id: string, additive: boolean) => void;
  selectCells: (ids: string[]) => void;
  setCells: (cells: Cell[]) => void;
  setStudies: (studies: StudySummary[]) => void;
  setActiveStudyId: (id: string) => void;
  setLayer: (layer: LayerKey) => void;
  setPlan: (plan: OptimizerResult | null) => void;
  setWeights: (weights: ScoreWeights) => void;
  setBudget: (budget: number) => void;
  setUser: (user: UserSession | null) => void;
  pushToast: (message: string, kind?: Toast['kind']) => void;
};

export const StoreContext = createContext<Store | null>(null);
