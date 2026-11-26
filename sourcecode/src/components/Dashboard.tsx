import React, { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, ArrowLeft, Wand2, Star, History as HistoryIcon, Database, Settings, Brain, Zap, Scale, Target, BookmarkCheck } from 'lucide-react';
import { Wizard } from './Wizard';
import { Favourites } from './Favourites';
import { History } from './History';
import { Files } from './Files';
import { AgentSettings } from './AgentSettings';
import { StrategistWizard } from './StrategistWizard';
import { FastTrack } from './FastTrack';
import { AnswerConsistency } from './AnswerConsistency';
import { AnswerStrategically } from './AnswerStrategically';
import { SavedQueriesRunner } from './SavedQueriesRunner';
import type { StrategicFavouriteBundle } from '../lib/strategicFavourites';

type Tab = 'wizard' | 'answer_consistency' | 'answer_strategically' | 'saved_queries_runner' | 'strategist' | 'fasttrack' | 'favourites' | 'history' | 'files' | 'settings';

export const Dashboard: React.FC = () => {
  const { currentProject, setCurrentProject } = useProject();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('wizard');
  const [consistencyFeedData, setConsistencyFeedData] = useState<{
    question: string;
    guidance: string;
    source?: 'strategic_dossier';
  } | null>(null);
  const [strategicLaunchData, setStrategicLaunchData] = useState<{
    fav: StrategicFavouriteBundle;
    autoRunWithoutAgent?: boolean;
  } | null>(null);

  const handleFeedToAnswerConsistency = (data: {
    question: string;
    guidance: string;
    source?: 'strategic_dossier';
  }) => {
    setConsistencyFeedData(data);
    setActiveTab('answer_consistency');
  };

  const handleLaunchFavouriteInStudio = (
    fav: StrategicFavouriteBundle,
    autoRunWithoutAgent?: boolean
  ) => {
    setStrategicLaunchData({ fav, autoRunWithoutAgent });
    setActiveTab('answer_strategically');
  };

  if (!currentProject) return null;

  const tabs = [
    { id: 'wizard', label: 'Wizard', icon: Wand2 },
    { id: 'answer_consistency', label: 'Answer Consistency', icon: Scale },
    { id: 'answer_strategically', label: 'Answer Strategically', icon: Target },
    { id: 'saved_queries_runner', label: 'Saved Queries', icon: BookmarkCheck },
    { id: 'strategist', label: 'Strategist Wizard', icon: Brain },
    { id: 'fasttrack', label: 'Fast track', icon: Zap },
    { id: 'favourites', label: 'Favourites', icon: Star },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'files', label: 'Files in DB', icon: Database },
    { id: 'settings', label: 'Agent Settings', icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentProject(null)}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
              title="Back to Projects"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-semibold text-gray-900 truncate max-w-[200px] sm:max-w-md">
              {currentProject.name}
            </h1>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
        
        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8 overflow-x-auto" aria-label="Tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`
                    flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                    ${activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'wizard' && <Wizard />}
        {activeTab === 'answer_consistency' && (
          <AnswerConsistency
            initialFeedData={consistencyFeedData}
            onClearInitialFeedData={() => setConsistencyFeedData(null)}
          />
        )}
        {activeTab === 'answer_strategically' && (
          <AnswerStrategically
            onFeedToAnswerConsistency={handleFeedToAnswerConsistency}
            initialLaunchFavourite={strategicLaunchData}
            onClearInitialLaunchFavourite={() => setStrategicLaunchData(null)}
          />
        )}
        {activeTab === 'saved_queries_runner' && (
          <SavedQueriesRunner onOpenInAnswerStrategically={handleLaunchFavouriteInStudio} />
        )}
        {activeTab === 'strategist' && <StrategistWizard />}
        {activeTab === 'fasttrack' && <FastTrack />}
        {activeTab === 'favourites' && <Favourites />}
        {activeTab === 'history' && <History />}
        {activeTab === 'files' && <Files />}
        {activeTab === 'settings' && <AgentSettings />}
      </main>
    </div>
  );
};
