import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { Star, Play, ChevronDown, ChevronUp, Loader2, Edit3, Lightbulb } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { DataAgentEngine } from '../lib/DataAgentEngine';
import { agents } from '../lib/agents';
import Papa from 'papaparse';
import { localDb } from '../lib/localDb';
import { useSettings } from '../contexts/SettingsContext';
import { SmartResultViewer } from './SmartResultViewer';

function safeParseStoredResult(raw?: string): any {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

export interface FavouriteItem {
  id?: string;
  projectId: string;
  userId: string;
  userQuery: string;
  refinedUserQuery?: string;
  generatedCode?: string[];
  narrative?: string;
  analysisPlan?: string[];
  analysisResult?: string;
  timestamp: string;
  feedback?: string;
}

export const Favourites: React.FC = () => {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const { models } = useSettings();
  const [favourites, setFavourites] = useState<FavouriteItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [newResults, setNewResults] = useState<Record<string, any>>({});
  const [datasets, setDatasets] = useState<Record<string, any[]>>({});

  // New states for popups
  const [activePopup, setActivePopup] = useState<'anotherData' | 'similarVariations' | null>(null);
  const [popupFavId, setPopupFavId] = useState<string | null>(null);
  
  // For 'Run the code for another data'
  const [editableFields, setEditableFields] = useState<any[]>([]);
  const [isGeneratingFields, setIsGeneratingFields] = useState(false);
  const [editedQuery, setEditedQuery] = useState('');
  const [isExecutingNewInputs, setIsExecutingNewInputs] = useState(false);
  
  // For 'suggest similar variations'
  const [similarVariations, setSimilarVariations] = useState<string[]>([]);
  const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
  
  // For 'Quick Wizard'
  const [showQuickWizard, setShowQuickWizard] = useState(false);
  const [quickWizardQuery, setQuickWizardQuery] = useState('');
  const [quickWizardResult, setQuickWizardResult] = useState<any>(null);
  const [isQuickWizardProcessing, setIsQuickWizardProcessing] = useState(false);
  const [quickWizardIterations, setQuickWizardIterations] = useState<any[]>([]);
  const abortRequested = React.useRef(false);

  useEffect(() => {
    if (!user || !currentProject) return;
    
    const q = query(
      collection(db, 'favourites'),
      where('projectId', '==', currentProject.projectId),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favs: FavouriteItem[] = [];
      snapshot.forEach((doc) => {
        favs.push({ id: doc.id, ...doc.data() } as FavouriteItem);
      });
      favs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setFavourites(favs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'favourites');
    });

    return () => unsubscribe();
  }, [user, currentProject]);

  useEffect(() => {
    // Load data when project changes (needed for running code)
    const loadData = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) {
        return;
      }
      
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
              if (localFile.content instanceof Blob) {
                text = await localFile.content.text();
              } else {
                text = localFile.content;
              }
            }
          } else {
            const response = await fetch(file.url);
            text = await response.text();
          }

          if (text) {
            const results = Papa.parse(text, {
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true
            });
            const cleanData = results.data.filter((row: any) => Object.values(row).some(v => v !== null && v !== ''));
            loadedDatasets[file.name] = cleanData;
          }
        }

        if (Object.keys(loadedDatasets).length > 0) {
          setDatasets(loadedDatasets);
        }
      } catch (error: any) {
        console.error("Error loading CSVs:", error);
      }
    };
    loadData();
  }, [currentProject]);

  const handleRunCode = async (fav: FavouriteItem) => {
    if (!fav.id || !fav.generatedCode || fav.generatedCode.length === 0) return;
    
    setIsRunning(fav.id);
    try {
      const engine = new DataAgentEngine();
      const codeToRun = fav.generatedCode[0]; // Assuming the first one is the successful one
      
      const result = await engine.runAnalysis(codeToRun, datasets, (log) => console.log(log));
      
      setNewResults(prev => ({ ...prev, [fav.id!]: result }));
    } catch (error: any) {
      console.error("Error running saved code:", error);
      alert(`Failed to run code: ${error.message}`);
    } finally {
      setIsRunning(null);
    }
  };

  const handleRunAnotherData = async (fav: FavouriteItem) => {
    if (!fav.id || !fav.generatedCode || fav.generatedCode.length === 0) return;
    setPopupFavId(fav.id);
    setActivePopup('anotherData');
    setIsGeneratingFields(true);
    setEditedQuery(fav.refinedUserQuery || fav.userQuery);
    
    try {
      const result = await agents.generateEditableFields(fav.generatedCode[0], fav.refinedUserQuery || fav.userQuery, models.strategyCreator);
      setEditableFields(result.fields || []);
    } catch (error) {
      console.error("Error generating fields:", error);
    } finally {
      setIsGeneratingFields(false);
    }
  };

  const handleRunNewInputs = async (fav: FavouriteItem) => {
    if (!fav.generatedCode || fav.generatedCode.length === 0) return;
    setIsExecutingNewInputs(true);
    try {
      const engine = new DataAgentEngine();
      const schema = currentProject?.schemaDescription || '';
      const plan = fav.analysisPlan || [];
      
      // Use the edited query and previous code to generate new code
      const { code: newCode } = await agents.generateCode(editedQuery, schema, plan, '', fav.generatedCode[0], models.codeGenerator);
      
      const result = await engine.runAnalysis(newCode, datasets, (log) => console.log(log));
      setNewResults(prev => ({ ...prev, [fav.id!]: result }));
      // setActivePopup(null); // REMOVED: Keep popup open
    } catch (error: any) {
      console.error("Error running new inputs:", error);
      alert(`Failed to run code: ${error.message}`);
    } finally {
      setIsExecutingNewInputs(false);
    }
  };

  const handleSuggestVariations = async (fav: FavouriteItem) => {
    if (!fav.id || !fav.generatedCode || fav.generatedCode.length === 0) return;
    setPopupFavId(fav.id);
    setActivePopup('similarVariations');
    setIsGeneratingVariations(true);
    
    try {
      const result = await agents.generateSimilarQuestions(fav.userQuery, fav.refinedUserQuery || '', fav.generatedCode[0], models.strategyCreator);
      setSimilarVariations(result.variations || []);
    } catch (error) {
      console.error("Error generating variations:", error);
    } finally {
      setIsGeneratingVariations(false);
    }
  };

  const handleSelectVariation = (variation: string, fav: FavouriteItem) => {
    setQuickWizardQuery(variation);
    setShowQuickWizard(true);
    setActivePopup(null);
    setQuickWizardResult(null);
    setQuickWizardIterations([]);
  };

  const handleRunQuickWizard = async (fav: FavouriteItem) => {
    setIsQuickWizardProcessing(true);
    setQuickWizardIterations([]);
    abortRequested.current = false;
    
    try {
      const schema = currentProject?.schemaDescription || '';
      const engine = new DataAgentEngine();
      
      // One-shot example context
      const oneShotContext = `
        Example User Query: "${fav.userQuery}"
        Example Refined Query: "${fav.refinedUserQuery}"
        Example Successful Code:
        \`\`\`javascript
        ${fav.generatedCode?.[0] || ''}
        \`\`\`
      `;

      let currentCode = '';
      let result = null;
      let errorTelemetry = undefined;
      let previousCode = fav.generatedCode?.[0];

      for (let attempt = 1; attempt <= 5; attempt++) {
        if (abortRequested.current) break;

        const currentIteration = {
          attempt,
          reasoning: 'Generating code using one-shot example...',
          code: '',
          status: 'running' as const,
          logs: [] as string[]
        };
        
        setQuickWizardIterations(prev => [...prev, currentIteration]);

        const onLog = (msg: string) => {
          setQuickWizardIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].logs.push(msg);
            return newIters;
          });
        };

        const { code, reasoning, modelUsed } = await agents.generateCode(
          quickWizardQuery + "\\n\\n" + oneShotContext, 
          schema, 
          fav.analysisPlan || [], 
          errorTelemetry, 
          previousCode,
          models.codeGenerator
        );
        
        currentCode = code;
        previousCode = code;

        setQuickWizardIterations(prev => {
          const newIters = [...prev];
          newIters[newIters.length - 1].code = code;
          newIters[newIters.length - 1].reasoning = reasoning;
          newIters[newIters.length - 1].modelUsed = modelUsed;
          return newIters;
        });

        try {
          result = await engine.runAnalysis(currentCode, datasets, onLog);
          
          const evalResult = await agents.evaluateResult(quickWizardQuery, result, currentCode, models.evaluator);
          
          setQuickWizardIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].evaluatorReasoning = evalResult.reasoning;
            return newIters;
          });

          if (evalResult.isComplete) {
            setQuickWizardIterations(prev => {
              const newIters = [...prev];
              newIters[newIters.length - 1].status = 'success';
              return newIters;
            });
            break;
          } else {
            throw new Error(evalResult.suggestedNextSteps || evalResult.reasoning);
          }
        } catch (error: any) {
          const errorMsg = error.message || String(error);
          
          const analysis = await agents.analyzeError(quickWizardQuery, errorMsg, currentCode, [], models.errorAnalyzer);
          errorTelemetry = analysis.reasoning;
          
          setQuickWizardIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].status = 'error';
            newIters[newIters.length - 1].error = errorMsg;
            newIters[newIters.length - 1].errorAnalyzerReasoning = analysis.reasoning;
            return newIters;
          });
        }
      }
      
      setQuickWizardResult(result);
    } catch (error: any) {
      console.error("Error running quick wizard:", error);
      alert(`Failed to run code: ${error.message}`);
    } finally {
      setIsQuickWizardProcessing(false);
    }
  };



  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Star className="w-5 h-5 text-yellow-500" />
        Favourite Queries
      </h2>
      {favourites.length === 0 ? (
        <p className="text-gray-500">No favourites yet.</p>
      ) : (
        <div className="space-y-4">
          {favourites.map((fav) => (
            <div key={fav.id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div 
                className="p-4 bg-gray-50 cursor-pointer flex justify-between items-center hover:bg-gray-100 transition-colors"
                onClick={() => setExpandedId(expandedId === fav.id ? null : fav.id!)}
              >
                <div>
                  <p className="font-medium text-gray-900">{fav.userQuery}</p>
                  <p className="text-xs text-gray-500 mt-1">{new Date(fav.timestamp).toLocaleString()}</p>
                </div>
                {expandedId === fav.id ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
              </div>
              
              {expandedId === fav.id && (
                <div className="p-4 border-t border-gray-200 space-y-4 bg-white">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Refined Query</h4>
                    <p className="text-sm text-gray-800">{fav.refinedUserQuery}</p>
                  </div>
                  
                  {fav.analysisPlan && fav.analysisPlan.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase">Analysis Plan</h4>
                      <ul className="list-decimal list-inside text-sm text-gray-800">
                        {fav.analysisPlan.map((step, i) => <li key={i}>{step}</li>)}
                      </ul>
                    </div>
                  )}
                  
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">AI Narrative</h4>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{fav.narrative}</p>
                  </div>
                  
                  {fav.generatedCode && fav.generatedCode.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Successfully Executed Code</h4>
                      <div className="rounded overflow-hidden border border-gray-200">
                        <SyntaxHighlighter 
                          language="javascript" 
                          style={vscDarkPlus}
                          customStyle={{ margin: 0, fontSize: '0.75rem', maxHeight: '200px' }}
                        >
                          {fav.generatedCode[0]}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-gray-100 flex flex-wrap gap-2">
                    <button 
                      onClick={() => handleRunCode(fav)}
                      disabled={isRunning === fav.id || Object.keys(datasets).length === 0}
                      className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {isRunning === fav.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      RUN THE SAVED CODE AGAIN
                    </button>
                    
                    <button 
                      onClick={() => handleRunAnotherData(fav)}
                      disabled={Object.keys(datasets).length === 0}
                      className="flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-200 disabled:opacity-50 text-sm font-medium"
                    >
                      <Edit3 className="w-4 h-4" />
                      Run the code for another data
                    </button>
                    
                    <button 
                      onClick={() => handleSuggestVariations(fav)}
                      disabled={Object.keys(datasets).length === 0}
                      className="flex items-center gap-2 bg-purple-100 text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-200 disabled:opacity-50 text-sm font-medium"
                    >
                      <Lightbulb className="w-4 h-4" />
                      Suggest similar variations
                    </button>
                    
                    {Object.keys(datasets).length === 0 && (
                      <p className="text-xs text-red-500 mt-2 w-full">Data not loaded yet. Please wait.</p>
                    )}
                  </div>

                  {/* Comparison UI */}
                  {(fav.analysisResult || newResults[fav.id!] !== undefined) && (() => {
                    const parsedPrev = fav.analysisResult ? safeParseStoredResult(fav.analysisResult) : undefined;
                    const hasNew = newResults[fav.id!] !== undefined;
                    return (
                      <div className={`grid grid-cols-1 ${parsedPrev !== undefined && hasNew ? 'xl:grid-cols-2' : ''} gap-4 mt-4`}>
                        {parsedPrev !== undefined && parsedPrev !== null && (
                          <div className="border border-slate-200 rounded-lg p-4 bg-white">
                            <h4 className="text-xs font-semibold text-slate-600 uppercase mb-3">Previous Result</h4>
                            <SmartResultViewer
                              query={fav.refinedUserQuery || fav.userQuery}
                              result={parsedPrev}
                              label="Previous Result"
                              contextId={`${fav.id}-prev`}
                            />
                          </div>
                        )}

                        {hasNew && (
                          <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/40">
                            <h4 className="text-xs font-semibold text-blue-700 uppercase mb-3">New Result</h4>
                            <SmartResultViewer
                              query={fav.refinedUserQuery || fav.userQuery}
                              result={newResults[fav.id!]}
                              previousResult={parsedPrev}
                              label="New Result"
                              contextId={`${fav.id}-new`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Popup for 'Run the code for another data' */}
      {activePopup === 'anotherData' && popupFavId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Run for Another Data</h2>
              <button onClick={() => setActivePopup(null)} className="text-gray-500 hover:text-gray-700">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {isGeneratingFields ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-600">Identifying editable fields...</span>
                </div>
              ) : (
                <>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-blue-800 mb-2 font-medium">Edit the Refined Query</p>
                    <textarea 
                      value={editedQuery}
                      onChange={(e) => setEditedQuery(e.target.value)}
                      className="w-full p-2 border border-blue-200 rounded text-sm"
                      rows={3}
                    />
                  </div>
                  
                  {editableFields.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Suggested Fields to Edit</h3>
                      <div className="space-y-3">
                        {editableFields.map((field, idx) => (
                          <div key={idx} className="flex flex-col gap-1 bg-gray-50 p-3 rounded border border-gray-200">
                            <label className="text-xs font-medium text-gray-700">{field.name}</label>
                            <div className="flex gap-2 items-center">
                              <input 
                                type="text" 
                                defaultValue={field.currentValue}
                                className="flex-1 p-1.5 border border-gray-300 rounded text-sm"
                              />
                              <span className="text-xs text-gray-500 italic">{field.description}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Show result inside popup if available */}
              {popupFavId && newResults[popupFavId] !== undefined && (() => {
                const popupFav = favourites.find(f => f.id === popupFavId);
                const parsedPrev = popupFav?.analysisResult ? safeParseStoredResult(popupFav.analysisResult) : undefined;
                return (
                  <div className="mt-6 border-t pt-6">
                    <h3 className="text-sm font-semibold text-blue-700 uppercase mb-3">Execution Result</h3>
                    <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/40">
                      <SmartResultViewer
                        query={editedQuery || popupFav?.userQuery || ''}
                        result={newResults[popupFavId]}
                        previousResult={parsedPrev}
                        label="Execution Result"
                        contextId={`${popupFavId}-another`}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button onClick={() => setActivePopup(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button 
                onClick={() => handleRunNewInputs(favourites.find(f => f.id === popupFavId)!)} 
                disabled={isGeneratingFields || isExecutingNewInputs}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isExecutingNewInputs ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                RUN THE SAVED CODE ON THE NEW INPUTS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup for 'Suggest similar variations' */}
      {activePopup === 'similarVariations' && popupFavId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Similar Variations</h2>
              <button onClick={() => setActivePopup(null)} className="text-gray-500 hover:text-gray-700">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {isGeneratingVariations ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                  <span className="ml-2 text-gray-600">Generating variations...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 mb-4">Click a variation to open the Quick Wizard.</p>
                  {similarVariations.map((variation, idx) => (
                    <button 
                      key={idx}
                      onClick={() => handleSelectVariation(variation, favourites.find(f => f.id === popupFavId)!)}
                      className="w-full text-left p-4 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors text-purple-900 text-sm font-medium"
                    >
                      {variation}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Wizard */}
      {showQuickWizard && popupFavId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Quick Wizard</h2>
              <button onClick={() => setShowQuickWizard(false)} className="text-gray-500 hover:text-gray-700">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">One-Shot Example Context</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Original Query</p>
                    <p className="text-sm text-gray-800 bg-white p-2 border rounded">{favourites.find(f => f.id === popupFavId)?.userQuery}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Refined Query</p>
                    <p className="text-sm text-gray-800 bg-white p-2 border rounded">{favourites.find(f => f.id === popupFavId)?.refinedUserQuery}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-gray-500 font-medium mb-1">Successfully Executed Code</p>
                  <div className="rounded overflow-hidden border border-gray-200">
                    <SyntaxHighlighter 
                      language="javascript" 
                      style={vscDarkPlus}
                      customStyle={{ margin: 0, fontSize: '0.75rem', maxHeight: '100px' }}
                    >
                      {favourites.find(f => f.id === popupFavId)?.generatedCode?.[0] || '// No code'}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">New Generated Question</label>
                <textarea 
                  value={quickWizardQuery}
                  onChange={(e) => setQuickWizardQuery(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                />
              </div>

              <div className="flex justify-end">
                <button 
                  onClick={() => handleRunQuickWizard(favourites.find(f => f.id === popupFavId)!)}
                  disabled={isQuickWizardProcessing || !quickWizardQuery.trim()}
                  className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isQuickWizardProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                  Process with One-Shot Example
                </button>
              </div>

              {/* Quick Wizard Iterations */}
              {quickWizardIterations.length > 0 && (
                <div className="mt-6 space-y-4 border-t pt-6">
                  <h3 className="font-medium text-gray-700">Execution Log</h3>
                  {quickWizardIterations.map((iter, idx) => (
                    <div key={idx} className={`border rounded-lg p-4 ${iter.status === 'success' ? 'border-green-300 bg-green-50' : iter.status === 'error' ? 'border-red-300 bg-red-50' : 'border-blue-300 bg-blue-50'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-sm">Attempt {iter.attempt}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${iter.status === 'success' ? 'bg-green-200 text-green-800' : iter.status === 'error' ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800 animate-pulse'}`}>
                          {iter.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-gray-700 mb-1">Reasoning:</p>
                        <p className="text-sm text-gray-800 bg-white p-2 rounded border border-gray-200">{iter.reasoning}</p>
                      </div>
                      {iter.error && (
                        <div className="mb-2">
                          <p className="text-xs font-semibold text-red-700 mb-1">Error:</p>
                          <p className="text-sm text-red-900 bg-red-50 p-2 rounded border border-red-200">{iter.error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Wizard Result */}
              {quickWizardResult !== null && quickWizardResult !== undefined && (() => {
                const wizardFav = favourites.find(f => f.id === popupFavId);
                const parsedPrev = wizardFav?.analysisResult ? safeParseStoredResult(wizardFav.analysisResult) : undefined;
                return (
                  <div className="mt-6 border-t pt-6">
                    <h3 className="font-medium text-slate-800 mb-3">Final Result</h3>
                    <div className="border border-slate-200 rounded-lg p-4 bg-white overflow-hidden">
                      <SmartResultViewer
                        query={quickWizardQuery}
                        result={quickWizardResult}
                        previousResult={parsedPrev}
                        label="Final Result"
                        contextId={`${popupFavId}-wizard`}
                      />
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}

    </div>
  );
};
