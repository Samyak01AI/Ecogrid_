import { useContext } from 'react';
import { StoreContext, type Store } from './store-context.js';

export function useEcoStore(): Store {
  const value = useContext(StoreContext);
  if (!value) throw new Error('EcoGrid store is not available.');
  return value;
}
