import React, { useState, useEffect } from 'react';
import { Settings, Users, ArrowRight, Database, Code, Brain, MessageSquare, Search, Save, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { useSettings, defaultModels } from '../contexts/SettingsContext';

export const AgentSettings: React.FC = () => {
  const { models, setAllModels, resetToDefaults } = useSettings();
  const [localModels, setLocalModels] = useState(models);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setLocalModels(models);
  }, [models]);

  const handleApplyChanges = () => {
    setAllModels(localModels);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleResetDefaults = () => {
    setLocalModels(defaultModels);
    resetToDefaults();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleSetAllToSonnet = () => {
    const sonnetConfig = {
      queryInterpreter: 'claude-sonnet-5-5',
      planner: 'claude-sonnet-5-5',
      codeGenerator: 'claude-sonnet-5-5',
      dataAgentEngine: 'claude-sonnet-5-5',
      explainer: 'claude-sonnet-5-5',
      evaluator: 'claude-sonnet-5-5',
      errorAnalyzer: 'claude-sonnet-5-5',
      strategyCreator: 'claude-sonnet-5-5',
    };
    setLocalModels(sonnetConfig);
    setAllModels(sonnetConfig);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const modelOptions = [
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { value: 'gpt4o', label: 'GPT-4o' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  ];

  const agentFlow = [
    { from: 'User', to: 'Query Interpreter', data: 'USER_QUERY' },
    { from: 'Query Interpreter', to: 'Planner Agent', data: 'REFINED_QUERY, SCHEMA' },
    { from: 'Planner Agent', to: 'Code Generator', data: 'ANALYSIS_PLAN, SCHEMA' },
    { from: 'Code Generator', to: 'Data Agent Engine', data: 'GENERATED_CODE, DATASETS' },
    { from: 'Data Agent Engine', to: 'Result Evaluator', data: 'EXECUTION_RESULT' },
    { from: 'Data Agent Engine', to: 'Error Analyzer', data: 'ERROR_TELEMETRY (if fails)' },
    { from: 'Result Evaluator', to: 'Explainer Agent', data: 'FINAL_RESULT' },
    { from: 'Explainer Agent', to: 'User', data: 'AI_NARRATIVE, VISUALS' },
  ];

  const agentIcons: Record<string, any> = {
    'User': Users,
    'Query Interpreter': Search,
    'Planner Agent': Brain,
    'Code Generator': Code,
    'Data Agent Engine': Database,
    'Result Evaluator': MessageSquare,
    'Error Analyzer': Search,
    'Explainer Agent': MessageSquare,
  };

  return (
    <div className="space-y-8">
      {/* Model Configuration Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              Default Model Configuration
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Configure preferred LLM models for each specialized AI agent. Defaults to Claude Haiku 5.5 for Explainer, Data Agent Engine, and Error Analyzer, and Claude Sonnet 5.5 for all other agents.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleSetAllToSonnet}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors shadow-xs"
              title="Set all agents to Claude Sonnet 5.5"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              Set All to Claude Sonnet 5.5
            </button>
            <button
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
              title="Reset all agents to default configuration (Claude Haiku 5.5 for Explainer, Data Agent Engine, Error Analyzer; Claude Sonnet 5.5 for others)"
            >
              <RotateCcw className="w-4 h-4 text-gray-500" />
              Reset to Defaults
            </button>
            <button
              onClick={handleApplyChanges}
              disabled={JSON.stringify(localModels) === JSON.stringify(models)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isSaved 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : JSON.stringify(localModels) === JSON.stringify(models)
                    ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
              }`}
            >
              {isSaved ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Changes Applied
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Apply Changes
                </>
              )}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(localModels).map(([agent, model]) => (
            <div key={agent} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 capitalize">
                {agent.replace(/([A-Z])/g, ' $1').trim()}
              </label>
              <select
                value={model}
                onChange={(e) => setLocalModels(prev => ({ ...prev, [agent]: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {modelOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Design Workflow Template Visualization */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Code className="w-5 h-5 text-purple-600" />
          Iterative CodeGenerator Workflow
        </h2>
        
        <div className="flex flex-col items-center gap-4 p-8 bg-gray-50 rounded-lg border border-gray-100 mb-8">
          <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm font-bold text-gray-900">
            Iterative_CodeGenerator_CodeExecutor
          </div>
          <ArrowRight className="w-6 h-6 text-gray-400 rotate-90" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              'Data Agent Engine', 'Query Interpreter', 'Planner Agent', 
              'Result Evaluator', 'Error Analyzer', 'Explainer Agent'
            ].map((subAgent) => (
              <div key={subAgent} className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs font-medium text-purple-800 text-center">
                {subAgent}
              </div>
            ))}
          </div>
        </div>

        <h3 className="text-md font-semibold text-gray-800 mb-6">Visual Sequence Diagram: Agent Interaction</h3>
        <div className="bg-white border border-gray-200 rounded-xl p-8 overflow-x-auto">
          <div className="min-w-[800px] relative">
            {/* Lifelines */}
            <div className="flex justify-between mb-12 relative">
              {['User', 'Supervisor Agent', 'Team (Sub-Agents)', 'Memory / Data'].map((actor, i) => (
                <div key={actor} className="flex flex-col items-center w-1/4 relative">
                  <div className={`px-4 py-2 rounded-lg border-2 font-bold text-sm shadow-sm z-10 ${
                    i === 0 ? 'bg-blue-50 border-blue-200 text-blue-700' :
                    i === 1 ? 'bg-purple-50 border-purple-200 text-purple-700' :
                    i === 2 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
                    'bg-amber-50 border-amber-200 text-amber-700'
                  }`}>
                    {actor}
                  </div>
                  <div className="absolute top-full h-[400px] w-px border-l-2 border-dashed border-gray-200 -z-0" />
                </div>
              ))}
            </div>

            {/* Messages */}
            <div className="space-y-8 relative pb-12">
              {/* Step 1 */}
              <div className="relative h-6">
                <div className="absolute left-[12.5%] right-[62.5%] border-t-2 border-blue-400 flex items-center justify-center">
                  <span className="bg-white px-2 text-[10px] font-bold text-blue-600 -mt-3">USER_QUERY</span>
                  <ArrowRight className="w-3 h-3 text-blue-400 absolute right-0 -mr-1.5" />
                </div>
              </div>

              {/* Step 2 */}
              <div className="relative h-6">
                <div className="absolute left-[37.5%] right-[37.5%] border-t-2 border-purple-400 flex items-center justify-center">
                  <span className="bg-white px-2 text-[10px] font-bold text-purple-600 -mt-3">Delegate Task</span>
                  <ArrowRight className="w-3 h-3 text-purple-400 absolute right-0 -mr-1.5" />
                </div>
              </div>

              {/* Step 3 */}
              <div className="relative h-6">
                <div className="absolute left-[62.5%] right-[12.5%] border-t-2 border-indigo-400 flex items-center justify-center">
                  <span className="bg-white px-2 text-[10px] font-bold text-indigo-600 -mt-3">Fetch Data / Schema</span>
                  <ArrowRight className="w-3 h-3 text-indigo-400 absolute right-0 -mr-1.5" />
                </div>
              </div>

              {/* Step 4 (Return) */}
              <div className="relative h-6">
                <div className="absolute left-[12.5%] right-[62.5%] border-t-2 border-dashed border-indigo-300 flex items-center justify-center">
                  <ArrowRight className="w-3 h-3 text-indigo-300 absolute left-0 -ml-1.5 rotate-180" />
                  <span className="bg-white px-2 text-[10px] font-bold text-indigo-400 -mt-3">Data Context</span>
                </div>
              </div>

              {/* Step 5 (Loop) */}
              <div className="relative h-12 flex items-center justify-center">
                <div className="px-4 py-1 bg-purple-100 border border-purple-200 rounded text-[10px] font-bold text-purple-800 uppercase tracking-wider">
                  Iterative Refinement Loop (Code {'->'} Execute {'->'} Evaluate)
                </div>
              </div>

              {/* Step 6 */}
              <div className="relative h-6">
                <div className="absolute left-[37.5%] right-[62.5%] border-t-2 border-dashed border-purple-300 flex items-center justify-center">
                  <ArrowRight className="w-3 h-3 text-purple-300 absolute left-0 -ml-1.5 rotate-180" />
                  <span className="bg-white px-2 text-[10px] font-bold text-purple-400 -mt-3">Final Result</span>
                </div>
              </div>

              {/* Step 7 */}
              <div className="relative h-6">
                <div className="absolute left-[12.5%] right-[87.5%] border-t-2 border-dashed border-blue-300 flex items-center justify-center">
                  <ArrowRight className="w-3 h-3 text-blue-300 absolute left-0 -ml-1.5 rotate-180" />
                  <span className="bg-white px-2 text-[10px] font-bold text-blue-400 -mt-3">AI Narrative & Visuals</span>
                </div>
              </div>
            </div>

            {/* Memory Boxes at bottom */}
            <div className="flex justify-around mt-8">
              <div className="w-1/3 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl shadow-sm text-center">
                <Database className="w-5 h-5 text-amber-600 mx-auto mb-2" />
                <p className="text-xs font-bold text-amber-900">User-Lead Agent Memory</p>
                <p className="text-[10px] text-amber-700 mt-1">Context, History, Preferences</p>
              </div>
              <div className="w-1/3 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl shadow-sm text-center">
                <Database className="w-5 h-5 text-amber-600 mx-auto mb-2" />
                <p className="text-xs font-bold text-amber-900">Lead Agent-Team Memory</p>
                <p className="text-[10px] text-amber-700 mt-1">Task State, Intermediate Results</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Collaboration Visualization */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          Agent Team Collaboration Flow
        </h2>
        
        <div className="relative">
          <div className="space-y-12">
            {agentFlow.map((step, idx) => {
              const FromIcon = agentIcons[step.from] || Users;
              const ToIcon = agentIcons[step.to] || Users;
              
              return (
                <div key={idx} className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
                  <div className="flex-1 flex items-center justify-end gap-3 w-full md:w-auto">
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{step.from}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-full border border-gray-200">
                      <FromIcon className="w-5 h-5 text-gray-600" />
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1 min-w-[150px]">
                    <div className="h-8 w-px bg-gray-300 md:hidden" />
                    <div className="hidden md:block w-full h-px bg-gray-300 relative">
                      <ArrowRight className="w-4 h-4 text-gray-400 absolute -right-2 -top-2" />
                    </div>
                    <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {step.data}
                    </span>
                    <div className="h-8 w-px bg-gray-300 md:hidden" />
                  </div>

                  <div className="flex-1 flex items-center justify-start gap-3 w-full md:w-auto">
                    <div className="p-3 bg-blue-50 rounded-full border border-blue-100">
                      <ToIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{step.to}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
