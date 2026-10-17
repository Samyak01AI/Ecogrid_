import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createGrid } from '@ecogrid/domain';
import App from './App.js';
import { StoreProvider } from './store.js';
import './styles.css';
import 'leaflet/dist/leaflet.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });
const cells = createGrid();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <StoreProvider cells={cells}>
        <BrowserRouter><App /></BrowserRouter>
      </StoreProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
