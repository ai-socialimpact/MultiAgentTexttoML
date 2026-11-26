import React, { createContext, useContext, useState, useEffect } from 'react';

interface ModelConfigs {
  queryInterpreter: string;
  planner: string;
  codeGenerator: string;
  dataAgentEngine: string;
  explainer: string;
  evaluator: string;
  errorAnalyzer: string;
  strategyCreator: string;
}

export const defaultModels: ModelConfigs = {
  queryInterpreter: 'claude-sonnet-5-5',
  planner: 'claude-sonnet-5-5',
  codeGenerator: 'claude-sonnet-5-5',
  dataAgentEngine: 'claude-haiku-5-5',
  explainer: 'claude-haiku-5-5',
  evaluator: 'claude-sonnet-5-5',
  errorAnalyzer: 'claude-haiku-5-5',
  strategyCreator: 'claude-sonnet-5-5',
};

interface SettingsContextType {
  models: ModelConfigs;
  updateModel: (agent: keyof ModelConfigs, model: string) => void;
  setAllModels: (models: ModelConfigs) => void;
  resetToDefaults: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [models, setModels] = useState<ModelConfigs>(() => {
    const version = localStorage.getItem('agent_model_configs_version');
    if (version !== 'v6_claude_haiku_5_5_default') {
      localStorage.setItem('agent_model_configs_version', 'v6_claude_haiku_5_5_default');
      localStorage.setItem('agent_model_configs', JSON.stringify(defaultModels));
      return defaultModels;
    }
    const saved = localStorage.getItem('agent_model_configs');
    return saved ? { ...defaultModels, ...JSON.parse(saved) } : defaultModels;
  });

  useEffect(() => {
    localStorage.setItem('agent_model_configs', JSON.stringify(models));
  }, [models]);

  const updateModel = (agent: keyof ModelConfigs, model: string) => {
    setModels(prev => ({ ...prev, [agent]: model }));
  };

  const setAllModels = (newModels: ModelConfigs) => {
    setModels(newModels);
  };

  const resetToDefaults = () => {
    setModels(defaultModels);
  };

  return (
    <SettingsContext.Provider value={{ models, updateModel, setAllModels, resetToDefaults }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
