import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Play, 
  ThumbsUp, 
  ThumbsDown, 
  Star, 
  RefreshCw, 
  Loader2, 
  Activity, 
  Cpu, 
  MessageSquare,
  Copy,
  Check,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { agents } from '../lib/agents';
import { DataAgentEngine } from '../lib/DataAgentEngine';
import Papa from 'papaparse';
import { localDb } from '../lib/localDb';
import { useSettings } from '../contexts/SettingsContext';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement
} from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement
);

const AVAILABLE_MODELS = [
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-opus-5-5',
  'gpt-6.1-sol',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gpt4o',
  'gpt-5.4',
  'gpt-5.4-2026-03-05',
  'gpt-5.4-mini'
];

interface AgentFlowEvent {
  id: string;
  agentName: string;
  modelUsed: string;
  action: string;
  response: string;
  thoughtProcess?: string;
  time: string;
  attemptNumber?: number;
  failureReason?: string;
  status: 'success' | 'error' | 'running' | 'info';
}

export const Wizard: React.FC = () => {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [refinedQuery, setRefinedQuery] = useState('');
  const [identifiedTables, setIdentifiedTables] = useState<string[]>([]);
  const [identifiedColumns, setIdentifiedColumns] = useState<string[]>([]);
  const [queryExplanation, setQueryExplanation] = useState('');
  const [taskType, setTaskType] = useState('Text to Data insights');
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [aiProcessingTemplate, setAiProcessingTemplate] = useState('ai_processing_template 1');
  const [userGuidance, setUserGuidance] = useState('');
  const [showSuccessfulOnly, setShowSuccessfulOnly] = useState(true);
  const [askMoreQuery, setAskMoreQuery] = useState('');
  const [classification, setClassification] = useState('');
  const [showSaveFavouriteModal, setShowSaveFavouriteModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [narrative, setNarrative] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [analysisPlan, setAnalysisPlan] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, any[]>>({});
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [dataLoadStatus, setDataLoadStatus] = useState<{loading: boolean, rows: number, error?: string}>({loading: false, rows: 0});
  const [debugLogs, setDebugLogs] = useState<{agent: string, prompt: string, response?: string, error?: string, timestamp: string, modelUsed?: string}[]>([]);
  const [activeTab, setActiveTab] = useState<'wizard' | 'debug'>('wizard');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [maxIterations, setMaxIterations] = useState<number>(5);
  const { models: modelConfigs } = useSettings();
  const abortRequested = React.useRef(false);
  const [iterations, setIterations] = useState<{
    attempt: number;
    reasoning: string;
    code: string;
    status: 'running' | 'success' | 'error';
    error?: string;
    logs: string[];
    modelUsed?: string;
    evaluatorReasoning?: string;
    errorAnalyzerReasoning?: string;
  }[]>([]);
  const [agentFlowEvents, setAgentFlowEvents] = useState<AgentFlowEvent[]>([]);

  const MAX_DEBUG_LOGS = 10;
  const MAX_RETAINED_ATTEMPTS = 3;

  const addDebugLog = (log: {agent: string, prompt: string, response?: string, error?: string, modelUsed?: string}) => {
    setDebugLogs(prev => {
      const updated = [...prev, { ...log, timestamp: new Date().toLocaleTimeString() }];
      return updated.slice(-MAX_DEBUG_LOGS);
    });
  };

  const clearAllDebugLogs = () => {
    setDebugLogs([]);
    setExpandedIndex(null);
  };

  const deleteDebugLogInList = (index: number) => {
    setDebugLogs(prev => prev.filter((_, i) => i !== index));
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fallback below
      }
    }
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      return successful;
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
      return false;
    }
  };

  const downloadJson = (data: any, filename: string) => {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyDebugLogs = async (index?: number) => {
    const payload = index !== undefined ? debugLogs[index] : debugLogs;
    const text = JSON.stringify(payload, null, 2);
    const success = await copyTextToClipboard(text);
    if (success) {
      if (index !== undefined) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    }
  };

  const handleDownloadDebugLogs = (index?: number) => {
    if (index !== undefined) {
      const log = debugLogs[index];
      const safeAgent = log.agent.toLowerCase().replace(/[^a-z0-9]/g, '_');
      downloadJson(log, `debug_log_${safeAgent}_${Date.now()}.json`);
    } else {
      downloadJson(debugLogs, `debug_logs_${Date.now()}.json`);
    }
  };

  const addFlowEvent = (event: Omit<AgentFlowEvent, 'id' | 'time'>) => {
    setAgentFlowEvents(prev => [...prev, {
      ...event,
      id: Math.random().toString(36).substring(7),
      time: new Date().toLocaleTimeString()
    }]);
  };

  useEffect(() => {
    // Load data when project changes
    const loadData = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) {
        setDataLoadStatus({loading: false, rows: 0, error: 'No data files found in project'});
        return;
      }
      
      const csvFiles = currentProject.dataFiles.filter(f => f.name.endsWith('.csv'));
      if (csvFiles.length === 0) {
        setDataLoadStatus({loading: false, rows: 0, error: 'No CSV files found'});
        return;
      }

      setDataLoadStatus({loading: true, rows: 0});
      try {
        const loadedDatasets: Record<string, any[]> = {};
        let totalRows = 0;

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
            } else {
              console.warn(`Local file ${fileName} not found in DB`);
              continue;
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
            // Filter out empty rows if any
            const cleanData = results.data.filter((row: any) => Object.values(row).some(v => v !== null && v !== ''));
            loadedDatasets[file.name] = cleanData;
            totalRows += cleanData.length;
          }
        }

        if (Object.keys(loadedDatasets).length > 0) {
          setDatasets(loadedDatasets);
          setDataLoadStatus({loading: false, rows: totalRows});
        } else {
          setDataLoadStatus({loading: false, rows: 0, error: 'No valid data found in CSV files'});
        }
      } catch (error: any) {
        console.error("Error loading CSVs:", error);
        setDataLoadStatus({loading: false, rows: 0, error: error.message || 'Failed to load CSVs'});
      }
    };
    loadData();
  }, [currentProject]);

  const handleAsk = async (e?: React.FormEvent, queryToUse?: string) => {
    if (e) e.preventDefault();
    const q = queryToUse || query;
    if (!q.trim() || !currentProject) return;
    
    setIsProcessing(true);
    setExecutionLogs([]);
    setAnalysisPlan([]);
    setAgentFlowEvents([]);
    setQueryExplanation('');
    try {
      const schema = currentProject.schemaDescription || 'No schema provided';
      
      addFlowEvent({
        agentName: 'Query Interpreter',
        modelUsed: modelConfigs.queryInterpreter,
        action: 'Interpreting user query',
        response: 'Thinking...',
        status: 'running'
      });
      
      const interpretation = await agents.interpretQuery(q, schema, modelConfigs.queryInterpreter, addDebugLog);
      
      addFlowEvent({
        agentName: 'Query Interpreter',
        modelUsed: interpretation.modelUsed || modelConfigs.queryInterpreter,
        action: 'Interpreted query',
        response: `Classification: ${interpretation.classification}\nRefined Query: ${interpretation.refinedQuery}\nTables: ${interpretation.identifiedTables?.join(', ')}\nColumns: ${interpretation.identifiedColumns?.join(', ')}`,
        status: 'success'
      });
      
      setClassification(interpretation.classification || 'Data Analysis');
      setRefinedQuery(interpretation.refinedQuery || q);
      setIdentifiedTables(interpretation.identifiedTables || []);
      setIdentifiedColumns(interpretation.identifiedColumns || []);
      
      setStep(2);
    } catch (error: any) {
      console.error("Error interpreting query:", error);
      addDebugLog({ agent: 'Query Interpreter', prompt: q, error: error.message });
      addFlowEvent({
        agentName: 'System',
        modelUsed: 'N/A',
        action: 'Error in interpretation',
        response: error.message,
        status: 'error'
      });
      alert("Failed to interpret query. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExplainQuery = async () => {
    setIsProcessing(true);
    try {
      const explanation = await agents.explainQuery(refinedQuery, modelConfigs.explainer, addDebugLog);
      setQueryExplanation(explanation.text);
    } catch (error) {
      console.error("Error explaining query:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateSuggestions = async () => {
    if (!currentProject) return;
    setIsProcessing(true);
    try {
      const schema = currentProject.schemaDescription || 'No schema provided';
      const result = await agents.generateSuggestions(taskType, schema, modelConfigs.planner, addDebugLog);
      setSuggestedQueries(result.suggestions || []);
    } catch (error) {
      console.error("Error generating suggestions:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!currentProject) return;
    setIsProcessing(true);
    try {
      const schema = currentProject.schemaDescription || 'No schema provided';
      
      addFlowEvent({
        agentName: 'Planner Agent',
        modelUsed: modelConfigs.planner,
        action: 'Creating analysis plan',
        response: 'Thinking...',
        status: 'running'
      });
      
      const plan = await agents.planAnalysis(refinedQuery, schema, aiProcessingTemplate, modelConfigs.planner, addDebugLog);
      
      addFlowEvent({
        agentName: 'Planner Agent',
        modelUsed: plan.modelUsed || modelConfigs.planner,
        action: 'Created plan',
        response: plan.steps?.join('\n') || 'No plan generated',
        status: 'success'
      });
      
      setAnalysisPlan(plan?.steps || []);
      setStep(3 as any);
    } catch (error: any) {
      console.error("Error generating plan:", error);
      alert("Failed to generate plan.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefinePlan = async () => {
    if (!userGuidance.trim()) return;
    setIsProcessing(true);
    try {
      const plan = await agents.refinePlan(analysisPlan, userGuidance, modelConfigs.planner, addDebugLog);
      setAnalysisPlan(plan?.steps || []);
      setUserGuidance('');
    } catch (error) {
      console.error("Error refining plan:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExplainFindings = async () => {
    setIsProcessing(true);
    try {
      const successfulIterations = iterations.filter(i => i.status === 'success');
      const findings = successfulIterations.map(i => ({
        attempt: i.attempt,
        reasoning: i.reasoning,
        code: i.code
      }));
      
      const explanation = await agents.explainFindings(findings, modelConfigs.explainer, addDebugLog);
      setNarrative(explanation.text);
      setStep(5);
    } catch (error) {
      console.error("Error explaining findings:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAskMore = async () => {
    if (!askMoreQuery.trim()) return;
    // Append to query and go back to step 2/3
    setQuery(query + "\nFollow up: " + askMoreQuery);
    setAskMoreQuery('');
    // We can just call handleAsk again with the new query
    handleAsk(undefined, query + "\nFollow up: " + askMoreQuery);
  };

  const handleAnalyze = async () => {
    if (!currentProject) return;
    setStep(4);
    setIsProcessing(true);
    setExecutionLogs([]);
    setIterations([]);
    abortRequested.current = false;
    
    try {
      const schema = currentProject.schemaDescription || 'No schema provided';
      const engine = new DataAgentEngine();

      let currentCode = '';
      let result = null;
      let errorTelemetry = undefined;
      let previousCode = undefined;

      for (let attempt = 1; attempt <= maxIterations; attempt++) {
        if (abortRequested.current) {
          addDebugLog({ agent: 'System', prompt: 'Execution aborted by user.' });
          addFlowEvent({
            agentName: 'System',
            modelUsed: 'N/A',
            action: 'Aborted',
            response: 'Execution aborted by user',
            status: 'error'
          });
          break;
        }

        const currentIteration = {
          attempt,
          reasoning: 'Generating...',
          code: '',
          status: 'running' as const,
          logs: [] as string[]
        };
        
        // Auto-delete older attempts beyond MAX_RETAINED_ATTEMPTS (3) to prevent memory crashes
        setIterations(prev => {
          const updated = [...prev, currentIteration];
          return updated.slice(-MAX_RETAINED_ATTEMPTS);
        });

        const onLog = (msg: string) => {
          setExecutionLogs(prev => [...prev, msg]);
          setIterations(prev => {
            const newIters = [...prev];
            if (newIters.length > 0) {
              newIters[newIters.length - 1].logs.push(msg);
            }
            return newIters;
          });
        };

        onLog(`--- Attempt ${attempt}/${maxIterations} ---`);
        
        // Generate code
        onLog(`Generating code for attempt ${attempt}...`);
        
        addFlowEvent({
          agentName: 'Code Generator',
          modelUsed: modelConfigs.codeGenerator,
          action: 'Generating code',
          response: 'Thinking...',
          attemptNumber: attempt,
          status: 'running'
        });
        
        const genResult = await agents.generateCode(refinedQuery, schema, analysisPlan, errorTelemetry, previousCode, modelConfigs.codeGenerator, addDebugLog);
        currentCode = genResult.code;
        setGeneratedCode(currentCode);
        
        addFlowEvent({
          agentName: 'Code Generator',
          modelUsed: genResult.modelUsed || modelConfigs.codeGenerator,
          action: 'Generated code',
          response: 'Code generated successfully',
          thoughtProcess: genResult.reasoning,
          attemptNumber: attempt,
          status: 'success'
        });
        
        setIterations(prev => {
          const newIters = [...prev];
          newIters[newIters.length - 1].reasoning = genResult.reasoning;
          newIters[newIters.length - 1].code = genResult.code;
          newIters[newIters.length - 1].modelUsed = genResult.modelUsed;
          return newIters;
        });

        // Small delay to let user see the code
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (abortRequested.current) break;

        try {
          onLog(`Executing code...`);
          addFlowEvent({
            agentName: 'Code Executor',
            modelUsed: 'N/A',
            action: 'Executing code',
            response: 'Running in sandbox...',
            attemptNumber: attempt,
            status: 'running'
          });
          
          result = await engine.runAnalysis(currentCode, datasets, onLog);
          onLog(`Execution successful!`);
          
          addFlowEvent({
            agentName: 'Code Executor',
            modelUsed: 'N/A',
            action: 'Execution successful',
            response: 'Code ran without errors',
            attemptNumber: attempt,
            status: 'success'
          });
          
          // Evaluate Result (Reasoning Agent 1)
          onLog(`Evaluating result...`);
          addFlowEvent({
            agentName: 'Result Evaluator',
            modelUsed: modelConfigs.evaluator,
            action: 'Evaluating execution result',
            response: 'Thinking...',
            attemptNumber: attempt,
            status: 'running'
          });
          
          const evalResult = await agents.evaluateResult(refinedQuery, result, currentCode, modelConfigs.evaluator, addDebugLog);
          
          addFlowEvent({
            agentName: 'Result Evaluator',
            modelUsed: evalResult.modelUsed || modelConfigs.evaluator,
            action: 'Evaluated result',
            response: evalResult.isComplete ? 'Result is complete and answers the query.' : 'Result is incomplete.',
            thoughtProcess: evalResult.reasoning,
            attemptNumber: attempt,
            status: evalResult.isComplete ? 'success' : 'error'
          });
          
          setIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].evaluatorReasoning = evalResult.reasoning;
            return newIters;
          });
          
          if (evalResult.isComplete) {
            setIterations(prev => {
              const newIters = [...prev];
              newIters[newIters.length - 1].status = 'success';
              return newIters;
            });
            break; // Success!
          } else {
            onLog(`Result incomplete: ${evalResult.suggestedNextSteps}`);
            errorTelemetry = `The code executed successfully but the result was incomplete. Evaluator feedback: ${evalResult.suggestedNextSteps}`;
            previousCode = currentCode;
            
            setIterations(prev => {
              const newIters = [...prev];
              newIters[newIters.length - 1].status = 'error';
              newIters[newIters.length - 1].error = 'Result incomplete';
              return newIters;
            });
            
            if (attempt === maxIterations) {
              throw new Error(`Failed to generate complete result after ${maxIterations} attempts. Evaluator feedback: ${evalResult.suggestedNextSteps}`);
            }
          }
        } catch (error: any) {
          onLog(`Execution failed: ${error.message}`);
          
          addFlowEvent({
            agentName: 'Code Executor',
            modelUsed: 'N/A',
            action: 'Execution failed',
            response: error.message,
            attemptNumber: attempt,
            failureReason: error.message,
            status: 'error'
          });
          
          // Analyze Error (Reasoning Agent 2)
          onLog(`Analyzing error...`);
          addFlowEvent({
            agentName: 'Error Analyzer',
            modelUsed: modelConfigs.errorAnalyzer,
            action: 'Analyzing execution error',
            response: 'Thinking...',
            attemptNumber: attempt,
            status: 'running'
          });
          
          const errorAnalysis = await agents.analyzeError(refinedQuery, error.message, currentCode, executionLogs, modelConfigs.errorAnalyzer, addDebugLog);
          
          addFlowEvent({
            agentName: 'Error Analyzer',
            modelUsed: errorAnalysis.modelUsed || modelConfigs.errorAnalyzer,
            action: 'Analyzed error',
            response: errorAnalysis.tips || 'No tips provided',
            thoughtProcess: errorAnalysis.reasoning,
            attemptNumber: attempt,
            status: 'success'
          });
          
          setIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].errorAnalyzerReasoning = errorAnalysis.reasoning;
            return newIters;
          });
          
          errorTelemetry = `Execution failed with error: ${error.message}. Error Analyzer tips: ${errorAnalysis.tips}`;
          previousCode = currentCode;
          
          setIterations(prev => {
            const newIters = [...prev];
            newIters[newIters.length - 1].status = 'error';
            newIters[newIters.length - 1].error = error.message;
            return newIters;
          });

          if (attempt === maxIterations) {
            // Don't throw, just let it finish the loop so the UI doesn't clear out
            onLog(`Max iterations reached. Stopping.`);
          } else {
            onLog(`Refining code based on error...`);
          }
        }
      }
      
      if (result) {
        setAnalysisResult(result);
        setStep(5);
        
        addFlowEvent({
          agentName: 'Explainer Agent',
          modelUsed: modelConfigs.explainer,
          action: 'Generating narrative',
          response: 'Thinking...',
          status: 'running'
        });
        
        const explanation = await agents.explainResults(refinedQuery, result, modelConfigs.explainer, addDebugLog);
        
        addFlowEvent({
          agentName: 'Explainer Agent',
          modelUsed: explanation.modelUsed || modelConfigs.explainer,
          action: 'Generated narrative',
          response: 'Narrative generated successfully',
          status: 'success'
        });
        
        setNarrative(explanation.text);
        
        // Save to history
        if (user) {
          try {
            const { db, handleFirestoreError, OperationType } = await import('../firebase');
            const { collection, addDoc } = await import('firebase/firestore');
            await addDoc(collection(db, 'history'), {
              projectId: currentProject.projectId,
              userId: user.uid,
              userQuery: query,
              refinedUserQuery: refinedQuery,
              generatedCode: [currentCode],
              executionStatus: 'success',
              narrative: explanation.text,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            console.error("Error saving history:", error);
          }
        }
      } else if (abortRequested.current) {
        alert("Execution aborted.");
        // Keep step at 4 so UI doesn't clear out
      } else {
        // Failed after max iterations
        // Keep step at 4 so UI doesn't clear out
        setExecutionLogs(prev => [...prev, "Analysis failed after maximum iterations."]);
      }
    } catch (error: any) {
      console.error("Error during analysis:", error);
      addDebugLog({ agent: 'Analysis Execution', prompt: refinedQuery, error: error.message });
      alert(`Analysis failed: ${error.message}`);
      // Keep step at 4 so UI doesn't clear out
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFeedback = async (type: 'ThumbsUp' | 'ThumbsDown' | 'Favourite') => {
    if (!user || !currentProject) return;
    
    if (type === 'Favourite') {
      setShowSaveFavouriteModal(true);
      return;
    }

    try {
      // We could have a separate table for successful answers if needed, 
      // but history already tracks success.
      alert('Feedback submitted!');
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const confirmSaveFavourite = async () => {
    if (!user || !currentProject) return;
    
    try {
      const { db } = await import('../firebase');
      const { collection, addDoc } = await import('firebase/firestore');
      
      // Get the successful code
      const successfulIter = iterations.find(i => i.status === 'success');
      const codeToSave = successfulIter ? successfulIter.code : generatedCode;

      await addDoc(collection(db, 'favourites'), {
        projectId: currentProject.projectId,
        userId: user.uid,
        userQuery: query,
        refinedUserQuery: refinedQuery,
        generatedCode: [codeToSave],
        narrative: narrative,
        analysisPlan: analysisPlan,
        analysisResult: analysisResult ? JSON.stringify(analysisResult) : null,
        timestamp: new Date().toISOString(),
        feedback: 'Favourite'
      });
      alert('Saved to Favourites!');
      setShowSaveFavouriteModal(false);
    } catch (error) {
      console.error("Error saving favourite:", error);
      alert('Failed to save to Favourites.');
    }
  };

  const renderChart = () => {
    if (!analysisResult) return null;

    // Support for advanced chartSpec returned by the agent
    if (analysisResult.chartSpec) {
      const { type, data, options: specOptions } = analysisResult.chartSpec;
      const defaultOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' as const } },
        ...specOptions
      };

      return (
        <div className="h-64 w-full relative pb-10">
          {type === 'bar' && <Bar data={data} options={defaultOptions} />}
          {type === 'line' && <Line data={data} options={defaultOptions} />}
          {type === 'pie' && <Pie data={data} options={defaultOptions} />}
          {/* Fallback if type is not one of the above */}
          {!['bar', 'line', 'pie'].includes(type) && <Bar data={data} options={defaultOptions} />}
        </div>
      );
    }

    // Fallback for simple labels/values format
    if (!analysisResult.labels || !analysisResult.values) return null;

    const chartData = {
      labels: analysisResult.labels,
      datasets: [
        {
          label: 'Data',
          data: analysisResult.values,
          backgroundColor: [
            'rgba(59, 130, 246, 0.5)',
            'rgba(16, 185, 129, 0.5)',
            'rgba(245, 158, 11, 0.5)',
            'rgba(239, 68, 68, 0.5)',
            'rgba(139, 92, 246, 0.5)',
          ],
          borderColor: [
            'rgb(59, 130, 246)',
            'rgb(16, 185, 129)',
            'rgb(245, 158, 11)',
            'rgb(239, 68, 68)',
            'rgb(139, 92, 246)',
          ],
          borderWidth: 1,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top' as const,
        },
      },
    };

    return (
      <div className="h-64 w-full relative pb-10">
        <div className="absolute top-0 right-0 z-10 flex gap-2">
          <select 
            value={chartType} 
            onChange={(e) => setChartType(e.target.value as any)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="pie">Pie</option>
          </select>
        </div>
        {chartType === 'bar' && <Bar data={chartData} options={options} />}
        {chartType === 'line' && <Line data={chartData} options={options} />}
        {chartType === 'pie' && <Pie data={chartData} options={options} />}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('wizard')}
          className={`py-2 px-4 font-medium transition-colors ${activeTab === 'wizard' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Wizard
        </button>
        <button
          onClick={() => setActiveTab('debug')}
          className={`py-2 px-4 font-medium transition-colors flex items-center gap-2 ${activeTab === 'debug' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Debug Logs
          <span className={`text-xs px-2 py-0.5 rounded-full ${debugLogs.length >= 10 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
            {debugLogs.length}/10
          </span>
        </button>
      </div>

      {activeTab === 'wizard' ? (
        <>
          {/* Agent Flow Summary Card */}
          {agentFlowEvents.length > 0 && (
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl shadow-lg border border-slate-700 p-6 text-slate-200">
              <div className="flex items-center gap-3 mb-6 border-b border-slate-700 pb-4">
                <Activity className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-semibold text-white">Multi-Agent Intelligence Flow</h2>
              </div>
              <div className="space-y-4 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                {agentFlowEvents.map((event) => (
                  <div key={event.id} className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-blue-400" />
                        <span className="font-semibold text-blue-300">{event.agentName}</span>
                        {event.attemptNumber && (
                          <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800">
                            Attempt {event.attemptNumber}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 font-mono">{event.time}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Action</div>
                        <div className="text-sm text-slate-200">{event.action}</div>
                        <div className="text-xs text-slate-400 mt-2 mb-1">Model</div>
                        <div className="text-xs font-mono bg-slate-900 px-2 py-1 rounded border border-slate-700 inline-block">{event.modelUsed}</div>
                      </div>
                      
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Status / Response</div>
                        <div className={`text-sm flex items-start gap-2 ${
                          event.status === 'success' ? 'text-emerald-400' : 
                          event.status === 'error' ? 'text-rose-400' : 
                          'text-amber-400'
                        }`}>
                          {event.status === 'running' && <Loader2 className="w-4 h-4 animate-spin mt-0.5" />}
                          <span className="whitespace-pre-wrap">{event.response}</span>
                        </div>
                      </div>
                    </div>
                    
                    {event.thoughtProcess && (
                      <div className="mt-3 pt-3 border-t border-slate-700/50">
                        <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                          <MessageSquare className="w-3 h-3" />
                          <span>Agent Reasoning</span>
                        </div>
                        <div className="text-sm text-slate-300 italic bg-slate-900/50 p-3 rounded border border-slate-800">
                          {event.thoughtProcess}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Input */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">1. What would you like to know?</h2>
              <div className="text-sm">
                {dataLoadStatus.loading ? (
                  <span className="text-blue-600 flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin" /> Loading data...</span>
                ) : dataLoadStatus.error ? (
                  <span className="text-red-600">Data error: {dataLoadStatus.error}</span>
                ) : (
                  <span className="text-green-600 font-medium">{dataLoadStatus.rows} rows loaded</span>
                )}
              </div>
            </div>
            <form onSubmit={handleAsk} className="space-y-4">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g., Show me the distribution of..."
                className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={step > 1 || isProcessing}
              />
              {step === 1 && (
                <div className="flex gap-4 items-center">
                  <button
                    type="submit"
                    disabled={isProcessing || !query.trim()}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    Interpret Query
                  </button>
                </div>
              )}
            </form>
            
            {step === 1 && (
              <div className="mt-6 border-t pt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Auto-generate suggestions</h3>
                <div className="flex flex-wrap gap-4 items-center mb-4">
                  {['Text to Data insights', 'Text to ML insights', 'Text to Visuals', 'Text to clustering'].map(type => (
                    <label key={type} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="taskType" value={type} checked={taskType === type} onChange={(e) => setTaskType(e.target.value)} />
                      {type}
                    </label>
                  ))}
                  <button onClick={handleGenerateSuggestions} disabled={isProcessing} className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200">
                    Generate
                  </button>
                </div>
                {suggestedQueries.length > 0 && (
                  <div className="space-y-2">
                    {suggestedQueries.map((sq, i) => (
                      <button key={i} onClick={() => setQuery(sq)} className="block text-left text-sm text-blue-600 hover:underline">
                        {sq}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Query Interpretation */}
          {step >= 2 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">2. Query Interpretation</h2>
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-gray-500 mb-1">Refined Query</p>
                <p className="font-medium">{refinedQuery}</p>
                
                <div className="mt-4 flex gap-4">
                  <div className="flex-1 bg-white p-3 rounded border border-gray-200">
                    <p className="text-xs text-gray-500 font-semibold mb-2">IDENTIFIED TABLES</p>
                    <div className="flex flex-wrap gap-2">
                      {identifiedTables.map(t => <span key={t} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">{t}</span>)}
                      {identifiedTables.length === 0 && <span className="text-xs text-gray-400">None identified</span>}
                    </div>
                  </div>
                  <div className="flex-1 bg-white p-3 rounded border border-gray-200">
                    <p className="text-xs text-gray-500 font-semibold mb-2">IDENTIFIED COLUMNS</p>
                    <div className="flex flex-wrap gap-2">
                      {identifiedColumns.map(c => <span key={c} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">{c}</span>)}
                      {identifiedColumns.length === 0 && <span className="text-xs text-gray-400">None identified</span>}
                    </div>
                  </div>
                </div>
              </div>
              
              {step === 2 && (
                <>
                  <div className="flex gap-4 items-center mb-6">
                    <button onClick={handleExplainQuery} disabled={isProcessing} className="text-sm bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200">
                      Explain in Simple English
                    </button>
                  </div>
                  
                  {queryExplanation && (
                    <div className="bg-blue-50 text-blue-800 p-4 rounded-lg mb-6 text-sm">
                      {queryExplanation}
                    </div>
                  )}
                  
                  <button onClick={handleGeneratePlan} disabled={isProcessing} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                    Move Ahead to Planning
                  </button>
                </>
              )}
            </div>
          )}

          {/* Step 3: Analysis Plan */}
          {step >= 3 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">3. Analysis Plan</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Processing Template</label>
                <select 
                  value={aiProcessingTemplate} 
                  onChange={(e) => setAiProcessingTemplate(e.target.value)} 
                  className="w-full border border-gray-300 rounded-lg p-2"
                  disabled={step > 3 || isProcessing}
                >
                  <option value="ai_processing_template 1">Template 1: Code generation and execution</option>
                  <option value="ai_processing_template 2">Template 2: Mix of code gen and Gemini analysis</option>
                </select>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <ol className="list-decimal list-inside space-y-2">
                  {analysisPlan.map((stepDesc, i) => (
                    <li key={i} className="text-gray-700">{stepDesc}</li>
                  ))}
                  {analysisPlan.length === 0 && <li>Generating plan...</li>}
                </ol>
              </div>
              
              {step === 3 && (
                <>
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Refine Plan (Optional)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={userGuidance} 
                        onChange={(e) => setUserGuidance(e.target.value)} 
                        placeholder="e.g., Also include a step to check for outliers" 
                        className="flex-1 border border-gray-300 rounded-lg p-2" 
                      />
                      <button onClick={handleRefinePlan} disabled={isProcessing || !userGuidance.trim()} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                        Auto-refine
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Max Iterations:</label>
                      <select 
                        value={maxIterations} 
                        onChange={(e) => setMaxIterations(Number(e.target.value))}
                        className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                        disabled={isProcessing}
                      >
                        <option value={5}>5</option>
                        <option value={20}>20</option>
                        <option value={30}>30</option>
                      </select>
                    </div>
                    <button onClick={handleAnalyze} disabled={isProcessing} className="flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
                      {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                      Validate & Execute Plan
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Execution */}
          {step >= 4 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">4. Analysis Execution</h2>
                {isProcessing && (
                  <button
                    onClick={() => { abortRequested.current = true; }}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm font-medium transition-colors"
                  >
                    Abort Run
                  </button>
                )}
              </div>

              <div className="mb-4 flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="showSuccessful" 
                  checked={showSuccessfulOnly} 
                  onChange={(e) => setShowSuccessfulOnly(e.target.checked)} 
                />
                <label htmlFor="showSuccessful" className="text-sm text-gray-700">Display successful attempts only</label>
              </div>

              {/* Iterations Visualizer */}
              <div className="mb-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-700">
                      Iterations ({iterations.length}/3 attempts retained)
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      Memory Protection Active: Capped to 3 attempts
                    </span>
                  </div>
                </div>

                {iterations.length > 0 && iterations[0].attempt > 1 && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 flex items-center gap-1.5">
                    <span>Older attempt(s) (1 to {iterations[0].attempt - 1}) auto-deleted from memory to prevent crashes.</span>
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {iterations.filter(i => !showSuccessfulOnly || i.status === 'success' || i.status === 'running').map((iter) => (
                    <div key={iter.attempt} className={`border rounded-lg p-4 ${iter.status === 'success' ? 'border-green-300 bg-green-50' : iter.status === 'error' ? 'border-red-300 bg-red-50' : 'border-blue-300 bg-blue-50'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-sm">Attempt {iter.attempt}</span>
                          {iter.modelUsed && (
                            <span className="text-xs font-mono bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-600">
                              {iter.modelUsed}
                            </span>
                          )}
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${iter.status === 'success' ? 'bg-green-200 text-green-800' : iter.status === 'error' ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800 animate-pulse'}`}>
                          {iter.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-700 mb-1">AI Reasoning (Code Generator):</p>
                        <p className="text-sm text-gray-800 bg-white p-2 rounded border border-gray-200">{iter.reasoning}</p>
                      </div>
                      
                      {iter.evaluatorReasoning && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-indigo-700 mb-1">Result Evaluator Reasoning:</p>
                          <p className="text-sm text-indigo-900 bg-indigo-50 p-2 rounded border border-indigo-200">{iter.evaluatorReasoning}</p>
                        </div>
                      )}
                      
                      {iter.errorAnalyzerReasoning && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-rose-700 mb-1">Error Analyzer Reasoning:</p>
                          <p className="text-sm text-rose-900 bg-rose-50 p-2 rounded border border-rose-200">{iter.errorAnalyzerReasoning}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold text-gray-700 mb-1">Generated Code:</p>
                          <div className="rounded overflow-hidden border border-gray-200">
                            <SyntaxHighlighter 
                              language="javascript" 
                              style={vscDarkPlus}
                              customStyle={{ margin: 0, fontSize: '0.75rem', maxHeight: '160px' }}
                            >
                              {iter.code || '// Generating...'}
                            </SyntaxHighlighter>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-700 mb-1">Execution Logs:</p>
                          <div className="text-xs text-green-400 bg-black p-2 rounded overflow-auto max-h-40 font-mono">
                            {iter.logs.map((l, i) => <div key={i}>{l}</div>)}
                            {iter.status === 'error' && <div className="text-red-400 mt-2 font-bold">Error: {iter.error}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {step === 4 && !isProcessing && iterations.some(i => i.status === 'success') && (
                <div className="mt-6 border-t pt-6">
                  <button onClick={handleExplainFindings} className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium">
                    Explain Findings & Generate Report
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Analysis Report */}
          {step >= 5 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">5. Analysis Report</h2>
                <button 
                  onClick={() => {
                    setStep(1);
                    setQuery('');
                    setRefinedQuery('');
                    setClassification('');
                    setAnalysisResult(null);
                    setNarrative('');
                    setGeneratedCode('');
                    setAgentFlowEvents([]);
                    setIdentifiedTables([]);
                    setIdentifiedColumns([]);
                    setQueryExplanation('');
                    setSuggestedQueries([]);
                    setAnalysisPlan([]);
                  }}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  <RefreshCw className="w-4 h-4" />
                  Start New Query
                </button>
              </div>
              
              <div className="prose max-w-none mb-8">
                <div dangerouslySetInnerHTML={{ __html: narrative.replace(/\n/g, '<br/>') }} />
              </div>
              
              <div className="border border-gray-200 rounded-lg p-4 h-80 flex flex-col bg-white overflow-hidden shadow-sm mb-8">
                {analysisResult?.chartSpec || (analysisResult?.labels && analysisResult?.values) ? (
                  renderChart()
                ) : (
                  <div className="flex-1 overflow-auto bg-gray-50 p-2 rounded">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                      {JSON.stringify(analysisResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
              
              <div className="flex gap-4 mb-8">
                <button onClick={() => handleFeedback('ThumbsUp')} className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200">
                  <ThumbsUp className="w-4 h-4" /> Helpful
                </button>
                <button onClick={() => handleFeedback('ThumbsDown')} className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200">
                  <ThumbsDown className="w-4 h-4" /> Not Helpful
                </button>
                <button onClick={() => handleFeedback('Favourite')} className="flex items-center gap-2 bg-yellow-50 text-yellow-600 px-4 py-2 rounded-lg hover:bg-yellow-100">
                  <Star className="w-4 h-4" /> Add to Favourites
                </button>
                <button onClick={() => alert('Report saved!')} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-100 ml-auto">
                  Save entire analysis
                </button>
              </div>
              
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium mb-4">Continue asking questions</h3>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={askMoreQuery} 
                    onChange={(e) => setAskMoreQuery(e.target.value)} 
                    placeholder="e.g., Generate visual based on the findings so far" 
                    className="flex-1 border border-gray-300 rounded-lg p-3" 
                  />
                  <button onClick={handleAskMore} disabled={isProcessing || !askMoreQuery.trim()} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    Ask
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save Favourite Modal */}
          {showSaveFavouriteModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="text-xl font-semibold text-gray-900">Save to Favourites</h2>
                  <button onClick={() => setShowSaveFavouriteModal(false)} className="text-gray-500 hover:text-gray-700">
                    &times;
                  </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">User Query</h3>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{query}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Refined Query</h3>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{refinedQuery}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Analysis Plan</h3>
                    <ul className="list-decimal list-inside text-sm text-gray-600 bg-gray-50 p-2 rounded">
                      {analysisPlan.map((step, i) => <li key={i}>{step}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">AI Narrative</h3>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded line-clamp-3">{narrative}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Successfully Executed Code</h3>
                    <div className="bg-gray-50 p-2 rounded overflow-hidden">
                      <SyntaxHighlighter 
                        language="javascript" 
                        style={vscDarkPlus}
                        customStyle={{ margin: 0, fontSize: '0.75rem', maxHeight: '100px' }}
                      >
                        {iterations.find(i => i.status === 'success')?.code || generatedCode || '// No code'}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
                  <button onClick={() => setShowSaveFavouriteModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                    Cancel
                  </button>
                  <button onClick={confirmSaveFavourite} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Confirm Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Debug Logs</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {debugLogs.length} / 10 max
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Full logs are retained in memory up to 10 items (older items auto-deleted to preserve memory). Use copy or download to inspect complete payloads.
              </p>
            </div>

            {debugLogs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleCopyDebugLogs()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
                  title="Copy all debug logs to clipboard"
                >
                  {copiedAll ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedAll ? 'Copied All!' : 'Copy All'}
                </button>
                <button
                  onClick={() => handleDownloadDebugLogs()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
                  title="Download all debug logs as JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download All
                </button>
                <button
                  onClick={clearAllDebugLogs}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors shadow-xs"
                  title="Delete all debug logs from memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete All
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {debugLogs.map((log, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3.5 bg-gray-50/50 hover:bg-gray-50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs text-gray-900 bg-white px-2 py-1 rounded border border-gray-200 shadow-xs">
                      #{i + 1} {log.agent}
                    </span>
                    {log.modelUsed && (
                      <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                        {log.modelUsed}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400">
                      {log.timestamp}
                    </span>
                    {log.error ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-medium">
                        <AlertCircle className="w-3 h-3" /> Error
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Response ready
                      </span>
                    )}
                    <span className="text-[11px] text-gray-500">
                      ~{Math.round(((log.prompt?.length || 0) + (log.response?.length || 0)) / 1024 * 10) / 10} KB
                    </span>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    <button
                      onClick={() => handleCopyDebugLogs(i)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 rounded transition-colors shadow-xs"
                      title="Copy this log to clipboard"
                    >
                      {copiedIndex === i ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedIndex === i ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={() => handleDownloadDebugLogs(i)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 rounded transition-colors shadow-xs"
                      title="Download this log as JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => deleteDebugLogInList(i)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded transition-colors shadow-xs"
                      title="Delete this log"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                    <button
                      onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                      className="p-1 text-gray-500 hover:text-gray-800 hover:bg-white rounded transition-colors"
                      title={expandedIndex === i ? "Hide snippet preview" : "View snippet preview"}
                    >
                      {expandedIndex === i ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {expandedIndex === i && (
                  <div className="mt-3 pt-3 border-t border-gray-200 text-xs font-mono space-y-2 bg-white p-3 rounded border">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-700">Prompt Snippet:</span>
                        <span className="text-[10px] text-gray-400">Total: {log.prompt?.length || 0} chars</span>
                      </div>
                      <pre className="p-2 bg-gray-50 rounded text-gray-800 whitespace-pre-wrap max-h-28 overflow-y-auto text-[11px]">
                        {log.prompt && log.prompt.length > 300 
                          ? `${log.prompt.slice(0, 300)}...\n[Truncated to optimize memory. Use Copy or Download for full payload]`
                          : log.prompt}
                      </pre>
                    </div>
                    {log.response && (
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-green-700">Response Snippet:</span>
                          <span className="text-[10px] text-gray-400">Total: {log.response.length} chars</span>
                        </div>
                        <pre className="p-2 bg-green-50/50 rounded text-gray-800 whitespace-pre-wrap max-h-28 overflow-y-auto text-[11px]">
                          {log.response.length > 300 
                            ? `${log.response.slice(0, 300)}...\n[Truncated to optimize memory. Use Copy or Download for full payload]`
                            : log.response}
                        </pre>
                      </div>
                    )}
                    {log.error && (
                      <div>
                        <span className="font-semibold text-red-700">Error:</span>
                        <div className="mt-1 p-2 bg-red-50 text-red-800 rounded text-[11px]">
                          {log.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {debugLogs.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900">No debug logs in memory</p>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  When you run queries in the Wizard, logs will be collected here (up to 10 max). Full payloads can be copied or downloaded anytime.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
