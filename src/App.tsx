/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const lazyWithRetry = (componentImport: () => Promise<any>) =>
  lazy(async () => {
    const pageRefreshed = JSON.parse(
      window.sessionStorage.getItem('page-refreshed') || 'false'
    );
    try {
      const component = await componentImport();
      window.sessionStorage.setItem('page-refreshed', 'false');
      return component;
    } catch (error) {
      if (!pageRefreshed) {
        window.sessionStorage.setItem('page-refreshed', 'true');
        window.location.reload();
      }
      throw error;
    }
  });

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const DashboardTeacher = lazyWithRetry(() => import('./pages/DashboardTeacher'));
const DashboardStudent = lazyWithRetry(() => import('./pages/DashboardStudent'));

// Komponen loading fallback untuk UX pada jaringan lambat
const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-slate-500 font-medium animate-pulse">Memuat aplikasi...</p>
    </div>
  </div>
);

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/dashboard/teacher" element={<DashboardTeacher />} />
              <Route path="/dashboard/student" element={<DashboardStudent />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
