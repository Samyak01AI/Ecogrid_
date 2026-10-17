import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from '../App.js';

export default function ApplicationRoutes() {
  const { pathname } = useLocation();
  if (pathname === '/' || pathname === '/login') return <AppShell />;
  return <Routes>
    <Route path="*" element={<AppShell />} />
    <Route path="/overview" element={<AppShell />} />
    <Route path="/environment" element={<AppShell />} />
    <Route path="/planner" element={<AppShell />} />
    <Route path="/scenarios" element={<AppShell />} />
    <Route path="/what-if" element={<AppShell />} />
    <Route path="/connectivity" element={<AppShell />} />
    <Route path="/analytics" element={<AppShell />} />
    <Route path="/reports" element={<AppShell />} />
    <Route path="/data-sources" element={<AppShell />} />
    <Route path="/methodology" element={<AppShell />} />
    <Route path="/settings" element={<AppShell />} />
    <Route path="/not-found" element={<Navigate to="/overview" replace />} />
  </Routes>;
}
