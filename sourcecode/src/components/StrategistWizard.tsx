import React, { useState, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { agents } from '../lib/agents';
import { DataAgentEngine } from '../lib/DataAgentEngine';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Brain, Play, Loader2, Sparkles, Wand2, CheckCircle2, AlertCircle, ChevronRight, Database } from 'lucide-react';
import Papa from 'papaparse';
import { localDb } from '../lib/localDb';
import { useSettings } from '../contexts/SettingsContext';

interface SubQuery {
  query: string;
  result?: any;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

export const StrategistWizard: React.FC = () => {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const { models } = useSettings();
  const [strategyQuestion, setStrategyQuestion] = useState('');
  const [subQueries, setSubQueries] = useState<SubQuery[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [finalAnalysis, setFinalAnalysis] = useState('');
  const [datasets, setDatasets] = useState<Record<string, any[]>>({});
  const [insights, setInsights] = useState<{
    insight: string;
    reasoningSteps: string[];
    sourceFavourites: any[];
  } | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) return;
      const csvFiles = currentProject.dataFiles.filter(f => f.name.endsWith('.csv'));
      if (csvFiles.length === 0) return;

      try {
        const loadedDatasets: Record<string, any[]> = {};
        for (const file of csvFiles) {
          let text = '';
          if (file.url.startsWith('local://')) {
            const fileName = file.url.replace('local://', '');
            const localFile = await localDb.files
              .where({ projectId: currentProject.projectId, name: fileName })
              .first();
            if (localFile) {
              text = localFile.content instanceof Blob ? await localFile.content.text() : localFile.content;
            }
          } else {
            const response = await fetch(file.url);
            text = await response.text();
          }
          if (text) {
            const results = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
            loadedDatasets[file.name] = results.data.filter((row: any) => Object.values(row).some(v => v !== null && v !== ''));
          }
        }
        setDatasets(loadedDatasets);
      } catch (error) {
        console.error("Error loading CSVs:", error);
      }
    };
    loadData();
  }, [currentProject]);

  const handleAutoSuggest = async () => {
    if (!currentProject) return;
    setIsSuggesting(true);
    try {
      const schema = currentProject.schemaDescription || 'No schema provided';
      // Take a small subset of data for context
      const dataSubset = Object.fromEntries(
        Object.entries(datasets).map(([name, data]) => [name, data.slice(0, 5)])
      );
      const result = await agents.suggestStrategyQuestions(schema, dataSubset, models.strategyCreator);
      setSuggestions(result.strategies || []);
    } catch (error) {
      console.error("Error suggesting strategies:", error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleGenieSuggest = async () => {
    if (!currentProject || !user) return;
    setIsSuggesting(true);
    try {
      const q = query(
        collection(db, 'favourites'),
        where('projectId', '==', currentProject.projectId),
        where('userId', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      const favs = snapshot.docs.map(doc => doc.data());
      
      // Ensure we have some favourites to analyze
      if (favs.length === 0) {
        alert("No favourite queries found to generate recommendations.");
        return;
      }
      
      const schema = currentProject.schemaDescription || 'No schema provided';
      
      const result = await agents.recommendStrategiesFromFavourites(favs, schema, models.strategyCreator);
      setSuggestions(result.strategies || []);
    } catch (error) {
      console.error("Error recommending strategies:", error);
      alert("Failed to generate recommendations. Please try again.");
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleInsightsFromFavourites = async () => {
    if (!currentProject || !user) return;
    setIsGeneratingInsights(true);
    try {
      const q = query(
        collection(db, 'favourites'),
        where('projectId', '==', currentProject.projectId),
        where('userId', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      const favs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (favs.length === 0) {
        alert("No favourite queries found to generate insights.");
        return;
      }
      
      const schema = currentProject.schemaDescription || 'No schema provided';
      const result = await agents.generateInsightsFromFavourites(favs, schema, models.strategyCreator);
      setInsights(result);
    } catch (error) {
      console.error("Error generating insights:", error);
      alert("Failed to generate insights. Please try again.");
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  const handleSelectStrategy = (strategy: any) => {
    setStrategyQuestion(strategy.question);
    setSubQueries(strategy.subQueries.map((q: string) => ({ query: q, status: 'pending' })));
    setFinalAnalysis('');
  };

  const processSubQuery = async (idx: number) => {
    const sub = subQueries[idx];
    setSubQueries(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], status: 'processing' };
      return next;
    });

    try {
      const schema = currentProject?.schemaDescription || '';
      const engine = new DataAgentEngine();

      // 1. Interpret
      const interp = await agents.interpretQuery(sub.query, schema, models.queryInterpreter);
      // 2. Plan
      const plan = await agents.planAnalysis(interp.refinedQuery, schema, 'Text to Data insights', models.planner);
      // 3. Generate Code
      const { code } = await agents.generateCode(interp.refinedQuery, schema, plan.steps, undefined, undefined, models.codeGenerator);
      // 4. Execute
      const result = await engine.runAnalysis(code, datasets);

      setSubQueries(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: 'success', result };
        return next;
      });
    } catch (error: any) {
      setSubQueries(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: 'error', error: error.message };
        return next;
      });
    }
  };

  const handleRunStrategy = async () => {
    if (subQueries.length === 0) return;
    setIsProcessing(true);
    
    // Process all sub-queries sequentially for simplicity
    for (let i = 0; i < subQueries.length; i++) {
      await processSubQuery(i);
    }

    // Once all done, analyze
    const results = subQueries.map(s => s.result).filter(Boolean);
    if (results.length === subQueries.length) {
      try {
        const analysis = await agents.analyzeStrategy(strategyQuestion, results, models.strategyCreator);
        setFinalAnalysis(analysis.analysis);
      } catch (error) {
        console.error("Error analyzing strategy:", error);
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            Strategist Wizard
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handleAutoSuggest}
              disabled={isSuggesting}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm font-medium"
            >
              <Wand2 className="w-4 h-4" />
              Auto-Suggest
            </button>
            <button
              onClick={handleGenieSuggest}
              disabled={isSuggesting}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-medium"
            >
              <Sparkles className="w-4 h-4" />
              Genie Recommendations
            </button>
            <button
              onClick={handleInsightsFromFavourites}
              disabled={isGeneratingInsights}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 text-sm font-medium"
            >
              <Brain className="w-4 h-4" />
              Insights from Favourites
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Strategy Question</label>
            <textarea
              value={strategyQuestion}
              onChange={(e) => setStrategyQuestion(e.target.value)}
              placeholder="Enter a high-level strategy question..."
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              rows={3}
            />
          </div>

          {suggestions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectStrategy(s)}
                  className="text-left p-3 border border-purple-100 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors text-xs"
                >
                  <p className="font-bold text-purple-900 mb-1">{s.question}</p>
                  <p className="text-purple-700 italic">{s.subQueries.length} sub-queries</p>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleRunStrategy}
            disabled={isProcessing || !strategyQuestion.trim()}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white py-3 rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            RUN STRATEGY ANALYSIS
          </button>
        </div>
      </div>

      {subQueries.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Sub-Query Progress</h3>
          <div className="space-y-4">
            {subQueries.map((sub, idx) => (
              <div key={idx} className="flex items-start gap-4 p-4 rounded-lg border border-gray-100 bg-gray-50">
                <div className="mt-1">
                  {sub.status === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> :
                   sub.status === 'error' ? <AlertCircle className="w-5 h-5 text-red-500" /> :
                   sub.status === 'processing' ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin" /> :
                   <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{sub.query}</p>
                  {sub.error && <p className="text-xs text-red-600 mt-1">{sub.error}</p>}
                  {sub.result && (
                    <div className="mt-2 p-2 bg-white rounded border border-gray-200 text-xs text-gray-600">
                      Result obtained successfully.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {finalAnalysis && (
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl shadow-sm border border-purple-100 p-6">
          <h3 className="text-lg font-bold text-purple-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Strategic Analysis Result
          </h3>
          <div className="prose prose-purple max-w-none">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{finalAnalysis}</p>
          </div>
        </div>
      )}

      {insights && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex items-center gap-2 text-amber-600 mb-4">
            <Brain className="w-6 h-6" />
            <h3 className="text-xl font-bold">Insights from Favourites</h3>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-6">
            <h4 className="text-sm font-bold text-amber-900 uppercase tracking-wider mb-2">Derived Strategy / Insight</h4>
            <p className="text-gray-800 text-lg font-medium leading-relaxed">{insights.insight}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-amber-500" />
                Reasoning Steps
              </h4>
              <ul className="space-y-3">
                {insights.reasoningSteps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700">
                    <span className="flex-shrink-0 w-5 h-5 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-[10px] font-bold">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-500" />
                Source Favourites
              </h4>
              <div className="space-y-3">
                {insights.sourceFavourites.map((fav, i) => (
                  <div key={i} className="p-3 border border-gray-100 rounded-lg bg-gray-50 text-xs">
                    <p className="font-bold text-gray-900 mb-1">{fav.refinedQuery}</p>
                    <p className="text-gray-500 line-clamp-2 italic">"{fav.narrative}"</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
