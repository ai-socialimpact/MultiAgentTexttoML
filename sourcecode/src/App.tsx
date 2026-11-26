/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './components/Login';
import { ProjectSelection } from './components/ProjectSelection';
import { Dashboard } from './components/Dashboard';

const AppContent: React.FC = () => {
  const { user, isAuthReady } = useAuth();
  const { currentProject } = useProject();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Login />;
  }

  if (!currentProject) {
    return <ProjectSelection />;
  }

  return <Dashboard />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ProjectProvider>
          <SettingsProvider>
            <AppContent />
          </SettingsProvider>
        </ProjectProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
