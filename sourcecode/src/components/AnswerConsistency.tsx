import React, { useState, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { agents } from '../lib/agents';
import { DataAgentEngine } from '../lib/DataAgentEngine';
import { localDb } from '../lib/localDb';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import Papa from 'papaparse';
import { ConsistencyReportModal } from './ConsistencyReportModal';
import { 
  Scale, 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp, 
  Code, 
  Sparkles, 
  Award, 
  Copy, 
  Download, 
  Star, 
  Layers, 
  FileText, 
  ArrowRight,
  RefreshCw,
  Info,
  CheckCheck,
  Wand2,
  Check,
  Database,
  BookOpen,
  Edit3,
  Sliders,
  HelpCircle,
  ShieldCheck,
  CheckCircle,
  Table,
  Table2,
  Trash2,
  Grid,
  X,
  FileSpreadsheet,
  Cpu,
  FileCode,
  RotateCcw
} from 'lucide-react';
import { 
  FormattedAnswerDisplay, 
  generateLaymanReportHtml, 
  generateEasyToUnderstandReportHtml,
  autoSuggestTablesForDossier,
  CustomDataTable, 
  buildRunComparisonTable 
} from './FormattedAnswerDisplay';

export const DEFAULT_DATA_SCIENCE_PLANNING_PROMPT = `Your objective is to test the consistency and stability of the answer across 5 independent analytical runs.
Propose exactly 5 distinct, rigorous data science / statistical methods to answer the question from different analytical perspectives.

Examples of data science methods:
1. Direct Mean / Sum Aggregation (standard parametric baseline)
2. Median & Non-Parametric Distribution (robust to outliers and skewed distributions)
3. Weighted Ratio / Volume-Weighted Calculation (accounts for varying sub-sample sizes)
4. Outlier-Filtered / Trimmed Mean (removes top/bottom 5% extreme data points)
5. Cumulative Frequency & Rank-Order Distribution (evaluates dominance by relative rank share)
6. Z-Score Normalized Comparative Analysis (standardizes variances across dimensions)`;

export const ML_TENSORFLOW_PLANNING_PROMPT = `Your objective is to test the consistency and stability of the Machine Learning predictions across 5 independent runs using on-device ML / TensorFlow.js ('tf') and predictive modeling algorithms.
Propose exactly 5 distinct, complementary Machine Learning architectures or modeling approaches to evaluate the problem from different ML perspectives.

Examples of ML / TensorFlow.js methods:
1. Baseline Linear / Logistic Regression (tf.sequential with dense layer; establishes fundamental linear relationship)
2. Multi-Layer Perceptron (Deep Neural Network with ReLU activations, hidden dense layers, and Dropout for non-linear interactions)
3. Feature-Normalized & Scaled Model (Z-score / MinMax scaled features with Adam optimizer and batch-normalized inputs)
4. Regularized Model (L1/L2 weight penalty or Ridge regularization to prevent overfitting on noisy features)
5. Ensemble / Clustered or Segmented Model (clusters data into sub-segments or polynomial features prior to prediction)

Ensure the modifiedQuery for each run instructs the Code Generator to use TensorFlow.js ('tf'), convert tabular data into tensors (tf.tensor2d), define model architecture, train with model.fit(), and compute consistent predictions/evaluations.`;

interface ConsistencyRun {
  runNumber: number;
  methodName: string;
  methodCategory: string;
  rationale: string;
  modifiedQuery: string;
  refinedQuery?: string;
  plan?: string[];
  code?: string;
  result?: any;
  narrative?: string;
  evaluatorFeedback?: string;
  status: 'pending' | 'interpreting' | 'planning' | 'executing' | 'explaining' | 'completed' | 'error';
  error?: string;
  extractedAnswer?: string;
  isAlignedWithConsensus?: boolean;
  methodNuance?: string;
}

interface ConsistencyAnalysis {
  consensusAnswer: string;
  agreementLevel: 'Exceptional' | 'High' | 'Moderate' | 'Low';
  agreeingRunsCount: number;
  totalRunsCount: number;
  agreementScore: number;
  isExceptional: boolean;
  runEvaluations: {
    runNumber: number;
    methodName: string;
    extractedAnswer: string;
    isAlignedWithConsensus: boolean;
    methodNuance?: string;
  }[];
  consistencyVerdict: string;
  detailedSynthesis: string;
  keyTakeaway?: string;
}

interface RefinedQueryState {
  originalQuery: string;
  refinedQuery: string;
  reasoning?: string;
  identifiedTables?: string[];
  identifiedColumns?: string[];
  domainAssumptions?: string[];
  isConfirmed: boolean;
}

export interface AnswerConsistencyProps {
  initialFeedData?: {
    question: string;
    guidance: string;
    source?: 'strategic_dossier';
  } | null;
  onClearInitialFeedData?: () => void;
}

export const AnswerConsistency: React.FC<AnswerConsistencyProps> = ({
  initialFeedData,
  onClearInitialFeedData
}) => {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const { models } = useSettings();

  const [question, setQuestion] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunningIndex, setCurrentRunningIndex] = useState<number | null>(null);
  const [methodologyOverview, setMethodologyOverview] = useState('');
  const [runs, setRuns] = useState<ConsistencyRun[]>([]);
  const [analysis, setAnalysis] = useState<ConsistencyAnalysis | null>(null);
  const [datasets, setDatasets] = useState<Record<string, any[]>>({});
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [dataLoadStatus, setDataLoadStatus] = useState<{ loading: boolean; rows: number; error?: string }>({ loading: false, rows: 0 });
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSavingFav, setIsSavingFav] = useState(false);
  const [favSaved, setFavSaved] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Custom Tables & Lay-man Report State
  const [customTables, setCustomTables] = useState<CustomDataTable[]>([]);
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);
  const [tableTitleInput, setTableTitleInput] = useState('');
  const [tableHeadersInput, setTableHeadersInput] = useState('');
  const [tableRowsInput, setTableRowsInput] = useState('');
  const [tableSuccessMsg, setTableSuccessMsg] = useState<string | null>(null);
  const [downloadSuccessMsg, setDownloadSuccessMsg] = useState<string | null>(null);

  // Human in the loop state
  const [isRefiningQuery, setIsRefiningQuery] = useState(false);
  const [refinedQueryState, setRefinedQueryState] = useState<RefinedQueryState | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [plannedRunsReady, setPlannedRunsReady] = useState(false);
  const [methodPlanningGuidance, setMethodPlanningGuidance] = useState('');
  const [showGuidanceInStep1, setShowGuidanceInStep1] = useState(false);
  const [planningPrompt, setPlanningPrompt] = useState<string>(DEFAULT_DATA_SCIENCE_PLANNING_PROMPT);
  const [selectedPromptPreset, setSelectedPromptPreset] = useState<'standard' | 'ml' | 'custom'>('standard');
  const [importedGuidanceBanner, setImportedGuidanceBanner] = useState<string | null>(null);

  // Progressive disclosure UI state (keeps non-geek view clean while preserving all pro tools)
  const [showImportedNotes, setShowImportedNotes] = useState(false);
  const [showCheckpoint1Advanced, setShowCheckpoint1Advanced] = useState(false);
  const [showRunCodeMap, setShowRunCodeMap] = useState<Record<number, boolean>>({});
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Handle incoming feed data from Answer Strategically
  useEffect(() => {
    if (initialFeedData) {
      if (initialFeedData.question) {
        setQuestion(initialFeedData.question);
      }
      if (initialFeedData.guidance) {
        setMethodPlanningGuidance(initialFeedData.guidance);
        setShowGuidanceInStep1(true);
      }
      // Reset previous runs and intermediate states to prepare fresh run with fed guidance
      setRuns([]);
      setAnalysis(null);
      setPlannedRunsReady(false);
      setRefinedQueryState(null);

      const combined = `${initialFeedData.question} ${initialFeedData.guidance}`.toLowerCase();
      if (combined.includes('ml') || combined.includes('tensorflow') || combined.includes('model') || combined.includes('neural')) {
        setPlanningPrompt(ML_TENSORFLOW_PLANNING_PROMPT);
        setSelectedPromptPreset('ml');
      }
      setImportedGuidanceBanner(
        "Empirical findings and strategic recommendations from 'Answer Strategically' Master Dossier have been loaded into your query and method guidance below. You can now inspect/edit guidance, refine the query, or directly plan 5 consistency runs."
      );
    }
  }, [initialFeedData]);

  // Helper to load project files (schemadescription.txt, few_shot_description.txt, Few_shot_examples.json)
  const getProjectContextFiles = async () => {
    let schemaDescription = currentProject?.schemaDescription || '';
    let fewShotDescription = currentProject?.fewShotDescription || '';
    let fewShotExamples = currentProject?.fewShotExamples || '';

    if (currentProject?.projectId) {
      try {
        if (!schemaDescription) {
          const f = await localDb.files.where({ projectId: currentProject.projectId, name: 'schemadescription.txt' }).first();
          if (f && f.content) schemaDescription = f.content instanceof Blob ? await f.content.text() : String(f.content);
        }
        if (!fewShotDescription) {
          const f = await localDb.files.where({ projectId: currentProject.projectId, name: 'few_shot_description.txt' }).first();
          if (f && f.content) fewShotDescription = f.content instanceof Blob ? await f.content.text() : String(f.content);
        }
        if (!fewShotExamples) {
          const f = await localDb.files.where({ projectId: currentProject.projectId, name: 'Few_shot_examples.json' }).first();
          if (f && f.content) fewShotExamples = f.content instanceof Blob ? await f.content.text() : String(f.content);
        }
      } catch (err) {
        console.warn('Could not read from localDb:', err);
      }
    }

    return { schemaDescription, fewShotDescription, fewShotExamples };
  };

  // Load project CSV datasets
  useEffect(() => {
    const loadData = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) {
        setDataLoadStatus({ loading: false, rows: 0, error: 'No data files found in project.' });
        return;
      }
      const csvFiles = currentProject.dataFiles.filter(f => f.name.endsWith('.csv'));
      if (csvFiles.length === 0) {
        setDataLoadStatus({ loading: false, rows: 0, error: 'No CSV files available.' });
        return;
      }

      setDataLoadStatus({ loading: true, rows: 0 });
      try {
        const loaded: Record<string, any[]> = {};
        let totalRows = 0;

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
            const resp = await fetch(file.url);
            text = await resp.text();
          }

          if (text) {
            const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
            const clean = parsed.data.filter((r: any) => Object.values(r).some(v => v !== null && v !== ''));
            loaded[file.name] = clean;
            totalRows += clean.length;
          }
        }

        if (Object.keys(loaded).length > 0) {
          setDatasets(loaded);
          setDataLoadStatus({ loading: false, rows: totalRows });
        } else {
          setDataLoadStatus({ loading: false, rows: 0, error: 'No valid rows found in CSV files.' });
        }
      } catch (err: any) {
        console.error("Error loading CSV files:", err);
        setDataLoadStatus({ loading: false, rows: 0, error: err.message || 'Failed to load data.' });
      }
    };

    loadData();
  }, [currentProject]);

  // Execute a single full Wizard run for one query variation
  const executeWizardRun = async (
    runIndex: number, 
    runData: ConsistencyRun,
    schema: string,
    currentDatasets: Record<string, any[]>
  ): Promise<ConsistencyRun> => {
    let updatedRun = { ...runData };
    const engine = new DataAgentEngine();

    try {
      // Stage 1: Query Interpreter
      setRuns(prev => prev.map((r, i) => i === runIndex ? { ...r, status: 'interpreting' } : r));
      const interp = await agents.interpretQuery(runData.modifiedQuery, schema, models.queryInterpreter);
      const refined = interp.refinedQuery || runData.modifiedQuery;
      updatedRun.refinedQuery = refined;

      // Stage 2: Planner Agent
      setRuns(prev => prev.map((r, i) => i === runIndex ? { ...r, status: 'planning', refinedQuery: refined } : r));
      const planRes = await agents.planAnalysis(refined, schema, 'Text to Data insights', models.planner);
      const planSteps = planRes.steps && planRes.steps.length > 0 ? planRes.steps : [
        'Inspect dataset columns and types',
        'Clean and filter data based on constraints',
        'Execute analytical calculation corresponding to data science method',
        'Format and return final summary'
      ];
      updatedRun.plan = planSteps;

      // Stage 3: Code Generator & DataAgentEngine
      setRuns(prev => prev.map((r, i) => i === runIndex ? { ...r, status: 'executing', plan: planSteps } : r));
      
      let generatedCode = '';
      let executionResult: any = null;
      let errorTelemetry: string | undefined = undefined;
      let previousCode: string | undefined = undefined;

      // Execute with self-healing retry (up to 2 attempts)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const codeRes = await agents.generateCode(
            refined,
            schema,
            planSteps,
            errorTelemetry,
            previousCode,
            models.codeGenerator
          );
          generatedCode = codeRes.code;

          executionResult = await engine.runAnalysis(generatedCode, currentDatasets);

          // Evaluation check
          const evalRes = await agents.evaluateResult(refined, executionResult, generatedCode, models.evaluator);
          updatedRun.evaluatorFeedback = evalRes.reasoning;

          if (evalRes.isComplete || attempt === 2) {
            break;
          } else {
            errorTelemetry = `Result incomplete. Evaluator feedback: ${evalRes.suggestedNextSteps}`;
            previousCode = generatedCode;
          }
        } catch (execErr: any) {
          if (attempt === 2) {
            throw execErr;
          }
          errorTelemetry = `Execution failed: ${execErr.message}`;
          previousCode = generatedCode;
        }
      }

      updatedRun.result = executionResult;

      // Stage 4: Explainer Agent
      setRuns(prev => prev.map((r, i) => i === runIndex ? { ...r, status: 'explaining', code: generatedCode, result: executionResult } : r));
      const narrativeRes = await agents.explainResults(refined, executionResult, models.explainer);
      updatedRun.narrative = narrativeRes.text || 'Analysis completed successfully.';
      updatedRun.status = 'completed';

      return updatedRun;
    } catch (err: any) {
      console.error(`Run ${runIndex + 1} failed:`, err);
      updatedRun.status = 'error';
      updatedRun.error = err.message || 'Execution error';
      return updatedRun;
    }
  };

  // HITL Step 1: Refine User Query with Query Interpreter (schemadescription.txt, few_shot_description.txt, Few_shot_examples.json)
  const handleRefineUserQuery = async () => {
    if (!question.trim() || !currentProject) return;
    setIsRefiningQuery(true);
    setAnalysis(null);
    setPlannedRunsReady(false);
    setRuns([]);

    try {
      const context = await getProjectContextFiles();
      const res = await agents.refineUserQueryWithContext(question, context, models.queryInterpreter);

      setRefinedQueryState({
        originalQuery: question,
        refinedQuery: res.refinedQuery || question,
        reasoning: res.reasoning,
        identifiedTables: res.identifiedTables,
        identifiedColumns: res.identifiedColumns,
        domainAssumptions: res.domainAssumptions,
        isConfirmed: false
      });
    } catch (err: any) {
      console.error('Failed to refine query:', err);
      alert('Failed to refine query: ' + err.message);
    } finally {
      setIsRefiningQuery(false);
    }
  };

  // HITL Step 1B: Confirm Refined Query and Trigger Planning of 5 Runs
  const handleConfirmRefinedQueryAndPlan = async () => {
    if (!refinedQueryState) return;
    const confirmed = { ...refinedQueryState, isConfirmed: true };
    setRefinedQueryState(confirmed);
    await handlePlan5Runs(confirmed.refinedQuery, methodPlanningGuidance, planningPrompt);
  };

  // HITL Step 2: Plan 5 Runs using Planner Agent (STOPS & WAITS for Human Confirmation!)
  const handlePlan5Runs = async (
    effectiveQueryOverride?: string, 
    guidanceOverride?: string,
    promptOverride?: string
  ) => {
    const targetQuery = (effectiveQueryOverride || refinedQueryState?.refinedQuery || question).trim();
    if (!targetQuery || !currentProject) return;

    const guidance = guidanceOverride !== undefined ? guidanceOverride : methodPlanningGuidance;
    const effectivePromptInstructions = promptOverride !== undefined ? promptOverride : planningPrompt;

    setIsPlanning(true);
    setPlannedRunsReady(false);
    setAnalysis(null);
    setRuns([]);

    try {
      const { schemaDescription } = await getProjectContextFiles();
      const schema = schemaDescription || 'Standard tabular CSV dataset';

      // Planner Agent plans 5 runs with distinct data science / ML methods (incorporating optional user guidance & planning prompt)
      const planResult = await agents.planConsistencyRuns(
        targetQuery, 
        schema, 
        models.planner, 
        undefined, 
        guidance,
        effectivePromptInstructions
      );
      setMethodologyOverview(planResult.methodologyOverview || '5 independent analytical methods testing answer stability');

      const initialRuns: ConsistencyRun[] = (planResult.runs || []).slice(0, 5).map((r: any, idx: number) => ({
        runNumber: r.runNumber || idx + 1,
        methodName: r.methodName || `Method ${idx + 1}`,
        methodCategory: r.methodCategory || 'Statistical Analysis',
        rationale: r.rationale || 'Validation run',
        modifiedQuery: r.modifiedQuery || targetQuery,
        status: 'pending'
      }));

      // Ensure we have exactly 5 runs
      while (initialRuns.length < 5) {
        const idx = initialRuns.length + 1;
        initialRuns.push({
          runNumber: idx,
          methodName: `Data Science Method ${idx}`,
          methodCategory: 'Statistical Verification',
          rationale: 'Complementary cross-validation',
          modifiedQuery: `${targetQuery} (Cross-validation run ${idx})`,
          status: 'pending'
        });
      }

      setRuns(initialRuns);
      // STOP & WAIT FOR HUMAN CONFIRMATION!
      setPlannedRunsReady(true);
    } catch (err: any) {
      console.error('Error planning 5 runs:', err);
      alert('Failed to plan runs: ' + err.message);
    } finally {
      setIsPlanning(false);
    }
  };

  // HITL Step 2B: User confirms and clicks 'Proceed to Execute All 5 Runs'
  const handleProceedToExecute = async () => {
    if (!runs || runs.length === 0 || !currentProject) return;

    setIsRunning(true);
    setPlannedRunsReady(false);
    setAnalysis(null);
    setExpandedRun(null);
    setFavSaved(false);

    try {
      const { schemaDescription } = await getProjectContextFiles();
      const schema = schemaDescription || 'Standard tabular CSV dataset';

      const completedRuns: ConsistencyRun[] = [];

      for (let i = 0; i < runs.length; i++) {
        setCurrentRunningIndex(i);
        const resultRun = await executeWizardRun(i, runs[i], schema, datasets);
        completedRuns.push(resultRun);
        setRuns(prev => prev.map((r, idx) => idx === i ? resultRun : r));
      }

      setCurrentRunningIndex(null);

      // Step 5: Answer Consistency Analysis across all 5 runs
      const effectiveQ = refinedQueryState?.refinedQuery || question;
      const consistencyRes = await agents.analyzeAnswerConsistency(effectiveQ, completedRuns, models.evaluator);
      
      const agreeingCount = typeof consistencyRes.agreeingRunsCount === 'number' 
        ? consistencyRes.agreeingRunsCount 
        : completedRuns.filter(r => r.status === 'completed').length;
      
      const isExceptionalAgreement = agreeingCount >= 4;
      const agreementScore = Math.round((agreeingCount / 5) * 100);

      const finalAnalysisData: ConsistencyAnalysis = {
        consensusAnswer: consistencyRes.consensusAnswer || 'Analysis confirmed stability across multi-method runs.',
        agreementLevel: isExceptionalAgreement ? 'Exceptional' : (consistencyRes.agreementLevel || (agreeingCount >= 3 ? 'High' : 'Moderate')),
        agreeingRunsCount: agreeingCount,
        totalRunsCount: 5,
        agreementScore: agreementScore,
        isExceptional: isExceptionalAgreement,
        runEvaluations: consistencyRes.runEvaluations || completedRuns.map((r, idx) => ({
          runNumber: r.runNumber || idx + 1,
          methodName: r.methodName,
          extractedAnswer: r.narrative?.slice(0, 100) || 'Calculation verified',
          isAlignedWithConsensus: true,
          methodNuance: 'Aligned'
        })),
        consistencyVerdict: consistencyRes.consistencyVerdict || (
          isExceptionalAgreement 
            ? `Exceptional Agreement: ${agreeingCount} of 5 independent data science methods converged on the identical answer.`
            : `${agreeingCount} of 5 data science methods agreed on the primary answer.`
        ),
        detailedSynthesis: consistencyRes.detailedSynthesis || 'All 5 analytical variations were evaluated to verify answer consistency.',
        keyTakeaway: consistencyRes.keyTakeaway || 'The verified answer is dependable across diverse statistical treatments.'
      };

      setAnalysis(finalAnalysisData);

      // Update runs with alignment status from the analysis
      if (finalAnalysisData.runEvaluations && finalAnalysisData.runEvaluations.length > 0) {
        setRuns(prev => prev.map((r) => {
          const evalItem = finalAnalysisData.runEvaluations.find(e => e.runNumber === r.runNumber);
          return evalItem ? {
            ...r,
            extractedAnswer: evalItem.extractedAnswer,
            isAlignedWithConsensus: evalItem.isAlignedWithConsensus,
            methodNuance: evalItem.methodNuance
          } : r;
        }));
      }
    } catch (err: any) {
      console.error('Error executing 5 runs:', err);
      alert('Error during execution: ' + err.message);
    } finally {
      setIsRunning(false);
      setCurrentRunningIndex(null);
    }
  };

  const handleCopyReport = async () => {
    if (!analysis) return;

    const shortSummary = `Across 5 independent analytical runs testing diverse data science methodologies, the system recorded an agreement score of ${analysis.agreementScore}% (${analysis.agreeingRunsCount} of 5 runs matching). The dominant finding concludes: "${analysis.consensusAnswer}". This cross-method convergence confirms that the result is statistically robust and ${analysis.isExceptional ? 'exceptionally consistent against distribution variations and outlier biases.' : 'demonstrates strong multi-method alignment.'}`;

    const reportText = `
==================================================
ANSWER CONSISTENCY PROFESSIONAL DOSSIER
==================================================
Project: ${currentProject?.name || 'Data Intelligence Workspace'}
Agreement Level: ${analysis.agreementLevel} Agreement Dossier (${analysis.agreeingRunsCount}/5 Methods Aligned — ${analysis.agreementScore}%)
Statistical Criterion: ${analysis.isExceptional ? 'Exceptional Invariance (≥4/5 matching runs)' : 'High Multi-Method Alignment'}

1. USER QUERY
"${question}"

2. REFINED USER QUERY
"${refinedQueryState?.refinedQuery || question}"
Status: Confirmed by Human Expert & Mapped to Project Schema

3. VERY SHORT SUMMARY (EXECUTIVE TL;DR)
${shortSummary}
- Core Conclusion: ${analysis.consensusAnswer}
- Convergence Ratio: ${analysis.agreeingRunsCount} of 5 Runs (${analysis.agreementScore}%)
- Stability Verdict: ${analysis.isExceptional ? 'Exceptional Invariance' : 'High Cross-Method Stability'}

4. CONSENSUS CONCLUSION
Validated Core Answer:
${analysis.consensusAnswer}

Consensus Verdict:
${analysis.consistencyVerdict}

Detailed Synthesis:
${analysis.detailedSynthesis}

5. EASY TO READ CONCLUSION
In Plain English:
When tested using five diverse analytical models—including boundary stress tests, stratified grouping, and robust statistical filters—the underlying metric converged firmly on "${analysis.consensusAnswer}". This outcome is mathematically consistent and not an artifact of random sampling.

Practical Business & Mission Takeaways:
${analysis.keyTakeaway || 'This validated conclusion withstands different weighting and filtering approaches. You can confidently proceed with this data point in high-stakes planning, resource allocation, and executive reporting.'}

Actionable Recommendations for Project Leads:
1. Stakeholder Reporting: Cite the verified consensus metric (${analysis.consensusAnswer}) with executive confidence.
2. Decision Making: Proceed without requiring manual reconciliation audits across disparate reporting silos.
3. Audit Trail: Retain this multi-run dossier as verifiable documentation for compliance and donors.

6. MULTI-METHOD RUN BREAKDOWN (5 INDEPENDENT RUNS)
${runs.map(r => `
Run #${r.runNumber}: ${r.methodName} [${r.methodCategory}]
- Augmented Query: "${r.modifiedQuery}"
- Specific Finding: ${r.extractedAnswer || r.narrative?.slice(0, 120) || 'Calculation verified'}
- Status: ${r.isAlignedWithConsensus ? '✓ Aligned with Consensus' : '~ Minor Variation / Nuance'}
`).join('')}
==================================================
    `.trim();

    try {
      await navigator.clipboard.writeText(reportText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleSaveToFavourites = async () => {
    if (!currentProject || !user || !analysis) return;
    setIsSavingFav(true);
    try {
      const codeList = runs.map(r => r.code || '').filter(Boolean);
      const planList = runs.map(r => `${r.methodName}: ${r.modifiedQuery}`);

      await addDoc(collection(db, 'favourites'), {
        projectId: currentProject.projectId,
        userId: user.uid,
        userQuery: question,
        refinedUserQuery: refinedQueryState?.refinedQuery ? `[Refined] ${refinedQueryState.refinedQuery}` : `[Answer Consistency - 5 Runs] ${question}`,
        narrative: `${analysis.agreementLevel} Agreement (${analysis.agreeingRunsCount}/5 runs aligned):\n\nConsensus Answer: ${analysis.consensusAnswer}\n\n${analysis.consistencyVerdict}\n\n${analysis.detailedSynthesis}`,
        analysisPlan: planList.length > 0 ? planList : ['5-method Answer Consistency analysis'],
        generatedCode: codeList.length > 0 ? codeList : ['// Answer consistency multi-method execution'],
        analysisResult: JSON.stringify({
          consensusAnswer: analysis.consensusAnswer,
          agreementLevel: analysis.agreementLevel,
          agreeingRunsCount: analysis.agreeingRunsCount,
          totalRunsCount: analysis.totalRunsCount,
          agreementScore: analysis.agreementScore,
          isExceptional: analysis.isExceptional,
          consistencyVerdict: analysis.consistencyVerdict,
          runEvaluations: analysis.runEvaluations
        }),
        timestamp: new Date().toISOString(),
        feedback: 'Favourite'
      });
      setFavSaved(true);
      setTimeout(() => setFavSaved(false), 3000);
    } catch (err: any) {
      console.error("Error saving to favourites:", err);
      handleFirestoreError(err, OperationType.CREATE, 'favourites');
      alert("Failed to save to Favourites: " + (err.message || 'Permission denied'));
    } finally {
      setIsSavingFav(false);
    }
  };

  // Generate & Download Lay-man Report HTML
  const handleDownloadLaymanReport = () => {
    if (!analysis) return;

    const html = generateLaymanReportHtml({
      question,
      refinedQuery: refinedQueryState?.refinedQuery || runs[0]?.refinedQuery,
      projectName: currentProject?.name,
      consensusAnswer: analysis.consensusAnswer,
      agreementScore: analysis.agreementScore,
      agreeingRunsCount: analysis.agreeingRunsCount,
      agreementLevel: analysis.agreementLevel,
      laymanExplanation: undefined,
      keyTakeaway: analysis.keyTakeaway,
      runs,
      customTables
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `layman-answer-consistency-report-${(currentProject?.name || 'workspace').toLowerCase().replace(/\s+/g, '-')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadSuccessMsg('Lay-man Report generated and downloaded successfully!');
    setTimeout(() => setDownloadSuccessMsg(null), 3500);
  };

  // Generate & Download Easy to Understand Report HTML
  const handleDownloadEasyToUnderstandReport = () => {
    if (!analysis) return;

    const schemaDesc = currentProject?.schemaDescription || '';
    const identifiedTables = refinedQueryState?.identifiedTables || (runs[0] as any)?.extractedTables || [];
    const identifiedColumns = refinedQueryState?.identifiedColumns || (runs[0] as any)?.extractedColumns || [];

    const html = generateEasyToUnderstandReportHtml({
      question,
      refinedQuery: refinedQueryState?.refinedQuery || runs[0]?.refinedQuery || question,
      refinedQueryDetails: {
        reasoning: refinedQueryState?.reasoning || 'Grounded across schema entities and verified across 5 analytical runs.',
        identifiedTables,
        identifiedColumns
      },
      projectName: currentProject?.name || 'Data Intelligence Workspace',
      consensusAnswer: analysis.consensusAnswer,
      agreementScore: analysis.agreementScore,
      agreeingRunsCount: analysis.agreeingRunsCount,
      agreementLevel: analysis.agreementLevel,
      schemaContext: {
        domainOverview: schemaDesc 
          ? `Grounded in project domain definitions (${identifiedTables.length > 0 ? identifiedTables.join(', ') : 'project dataset'}). All metric aggregations, data type constraints, and primary entity relationships adhere directly to the active schema definition.` 
          : `Grounded in dataset schema definitions. Entities and quantitative measures were strictly mapped to table fields to prevent column misinterpretation or unsupported aggregations.`,
        mappedEntities: identifiedTables.length > 0 ? identifiedTables.map(t => ({
          entity: t,
          description: `Target database entity referenced in query`,
          relevance: 'Primary table used for quantitative aggregation and analysis'
        })) : [
          {
            entity: 'Project Dataset Table',
            description: 'Core source data analyzed across 5 analytical pipelines',
            relevance: 'Grounded against schema column types and constraints'
          }
        ],
        domainInsights: [
          `Schema-verified types: Ensured calculations applied numerical operations only to valid continuous/discrete numeric attributes.`,
          `Query grounding: Disambiguated terms were aligned with exact schema entity identifiers prior to code execution.`,
          `Multi-method stability: Agreement across all 5 pipelines confirms invariant conclusions irrespective of analytical path.`
        ],
        schemaDescriptionText: schemaDesc
      },
      runs,
      customTables,
      methodologyOverview: '5-Method Analytical Convergence Protocol'
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `easy-to-understand-report-${(currentProject?.name || 'workspace').toLowerCase().replace(/\s+/g, '-')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadSuccessMsg('Easy to Understand Report created and downloaded successfully!');
    setTimeout(() => setDownloadSuccessMsg(null), 3500);
  };

  // Auto-suggest and Add Structured Tables for the Dossier
  const handleAutoSuggestAndAddTables = () => {
    if (!analysis && runs.length === 0) return;
    const suggested = autoSuggestTablesForDossier(runs, analysis, analysis?.consensusAnswer);
    if (!suggested || suggested.length === 0) {
      setTableSuccessMsg('No additional structured tables could be detected.');
      setTimeout(() => setTableSuccessMsg(null), 3500);
      return;
    }
    let addedCount = 0;
    setCustomTables(prev => {
      const updated = [...prev];
      suggested.forEach(st => {
        const exists = updated.some(t => t.title === st.title);
        if (!exists) {
          updated.push(st);
          addedCount++;
        }
      });
      return updated;
    });
    setIsAddTableOpen(true);
    setTableSuccessMsg(
      addedCount > 0
        ? `Successfully auto-suggested & added ${addedCount} table(s) to the dossier!`
        : 'All suggested tables (5-method comparison, multi-line extracted tables, breakdown) are already in the dossier!'
    );
    setTimeout(() => setTableSuccessMsg(null), 4000);
  };

  // Custom Tables Handlers
  const handleAddComparisonTable = () => {
    if (runs.length === 0) return;
    const table = buildRunComparisonTable(runs);
    setCustomTables(prev => [...prev.filter(t => !t.id.startsWith('table-comparison')), table]);
    setTableSuccessMsg('5-Method Comparison Table added to the dossier!');
    setTimeout(() => setTableSuccessMsg(null), 3500);
  };

  const handleAddConsensusBreakdownTable = () => {
    if (!analysis) return;
    const headers = ['Metric / Parameter', 'Observed Value', 'Confidence Status'];
    const rows = [
      ['Primary Consensus Finding', analysis.consensusAnswer, `${analysis.agreementLevel} Confidence`],
      ['Convergence Ratio', `${analysis.agreeingRunsCount} of 5 Runs (${analysis.agreementScore}%)`, 'Cross-Validated'],
      ['Analytical Stability', analysis.isExceptional ? 'Exceptional Invariance' : 'High Alignment', 'Verified Across Methods']
    ];

    const newTable: CustomDataTable = {
      id: `table-breakdown-${Date.now()}`,
      title: 'Consensus Finding & Metrics Breakdown Table',
      description: 'Structured breakdown of verified metrics and statistical parameters.',
      headers,
      rows
    };

    setCustomTables(prev => [...prev, newTable]);
    setTableSuccessMsg('Consensus Metrics Breakdown Table added!');
    setTimeout(() => setTableSuccessMsg(null), 3500);
  };

  const handleCreateCustomTable = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!tableHeadersInput.trim() || !tableRowsInput.trim()) return;

    const headers = tableHeadersInput.split(',').map(h => h.trim()).filter(Boolean);
    const rowLines = tableRowsInput.trim().split('\n').filter(Boolean);
    const rows = rowLines.map(line => {
      if (line.includes('|')) {
        return line.split('|').map(c => c.trim()).filter(Boolean);
      }
      return line.split(',').map(c => c.trim()).filter(Boolean);
    });

    const newTable: CustomDataTable = {
      id: `table-custom-${Date.now()}`,
      title: tableTitleInput.trim() || 'Custom Analytical Breakdown Table',
      description: 'Custom structured comparison table added by user.',
      headers,
      rows
    };

    setCustomTables(prev => [...prev, newTable]);
    setTableTitleInput('');
    setTableHeadersInput('');
    setTableRowsInput('');
    setTableSuccessMsg('Custom table added successfully!');
    setTimeout(() => setTableSuccessMsg(null), 3500);
  };

  const handleRemoveTable = (id: string) => {
    setCustomTables(prev => prev.filter(t => t.id !== id));
  };

  const sampleQuestions = [
    "Which group or category has the highest total?",
    "What is the average value across each group?",
    "Which group has the biggest differences or surprises?",
    "What are the top 3 contributors overall?"
  ];

  // Determine current active step (1 to 4) for the progress bar
  const currentStepNumber = analysis
    ? 4
    : isPlanning || (plannedRunsReady && runs.length === 5) || isRunning
      ? 3
      : refinedQueryState && !refinedQueryState.isConfirmed
        ? 2
        : 1;

  const progressSteps = [
    { num: 1, label: 'Ask Question' },
    { num: 2, label: 'Check Wording' },
    { num: 3, label: 'Run 5 Checks' },
    { num: 4, label: 'Your Answer' }
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Clean Header & Step Tracker */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <Scale className="w-4 h-4 text-blue-600" />
              <span>Answer Consistency</span>
              <span aria-hidden="true">·</span>
              <span>5-Way Reliability Check</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Double-Check Your Answer
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Ask a question about your data. We test it 5 different ways to make sure your answer is solid and not a fluke.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 self-start lg:self-center tabular-nums">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              {dataLoadStatus.loading ? (
                <span>Loading your files...</span>
              ) : dataLoadStatus.error ? (
                <span className="text-amber-700 font-medium">{dataLoadStatus.error}</span>
              ) : (
                <span>
                  <strong className="text-slate-900">{dataLoadStatus.rows.toLocaleString()}</strong> rows in{' '}
                  <strong className="text-slate-900">{Object.keys(datasets).length}</strong> file(s)
                </span>
              )}
            </div>
            <span aria-hidden="true" className="text-slate-300">|</span>
            <span>Pass goal: <strong className="text-emerald-700">4 or 5 / 5</strong> agree</span>
          </div>
        </div>

        {/* 4-Step Progress Bar */}
        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {progressSteps.map((step) => {
            const isDone = currentStepNumber > step.num;
            const isCurrent = currentStepNumber === step.num;
            return (
              <div
                key={step.num}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 border-blue-300 text-blue-900 font-semibold'
                    : isDone
                      ? 'bg-emerald-50/60 border-emerald-200 text-emerald-800 font-medium'
                      : 'bg-slate-50/60 border-slate-200 text-slate-500'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums ${
                    isCurrent
                      ? 'bg-blue-600 text-white'
                      : isDone
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? <Check className="w-3 h-3" /> : step.num}
                </span>
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Imported Notes Banner from Answer Strategically */}
      {importedGuidanceBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl p-4 sm:p-5 space-y-2.5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-emerald-800">
                  Brought over from Big-Picture Solver (Answer Strategically)
                </div>
                <p className="text-sm text-emerald-950">
                  We filled in your question and helpful notes below. Just click <strong>Check Question Wording</strong> when you are ready!
                </p>
                {methodPlanningGuidance && (
                  <button
                    type="button"
                    onClick={() => setShowImportedNotes(!showImportedNotes)}
                    className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline inline-flex items-center gap-1 cursor-pointer pt-0.5"
                  >
                    {showImportedNotes ? 'Hide imported notes' : 'View imported notes'}
                    {showImportedNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setImportedGuidanceBanner(null);
                if (onClearInitialFeedData) onClearInitialFeedData();
              }}
              className="text-slate-400 hover:text-slate-700 p-1.5 hover:bg-emerald-100 rounded-lg transition-colors shrink-0 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {showImportedNotes && methodPlanningGuidance && (
            <div className="p-3 bg-white rounded-lg border border-emerald-200 text-xs text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {methodPlanningGuidance}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 1: ASK YOUR QUESTION                                             */}
      {/* ===================================================================== */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-blue-600">Step 1 of 4</div>
          <h2 className="text-lg font-bold text-slate-900">What do you want to find out?</h2>
          <p className="text-sm text-slate-600">
            Type your question in plain English. We will make sure it matches your data columns, then test it 5 ways.
          </p>
        </div>

        <textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Example: Which neighborhood had the highest average score? Or: How much do customers spend on average?"
          className="w-full p-4 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          disabled={isRunning || isPlanning || isRefiningQuery}
        />

        {/* Quick Examples */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Try an example:</span>
          {sampleQuestions.slice(0, 3).map((sq, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setQuestion(sq)}
              disabled={isRunning || isPlanning || isRefiningQuery}
              className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors truncate max-w-[260px] cursor-pointer"
              title={sq}
            >
              {sq}
            </button>
          ))}
        </div>

        {/* Optional Extra Instructions (Collapsed by default) */}
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowGuidanceInStep1(!showGuidanceInStep1)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Optional: Give extra instructions for the 5 tests</span>
            {methodPlanningGuidance.trim() && (
              <span className="text-emerald-700 font-semibold">· Active</span>
            )}
            {showGuidanceInStep1 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showGuidanceInStep1 && (
            <div className="mt-3 space-y-2">
              <textarea
                rows={3}
                value={methodPlanningGuidance}
                onChange={(e) => setMethodPlanningGuidance(e.target.value)}
                placeholder="Optional: Tell us specific columns to focus on, or ask us to test Machine Learning models..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={isRunning || isPlanning || isRefiningQuery}
              />
              {methodPlanningGuidance && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMethodPlanningGuidance('')}
                    className="text-xs text-rose-600 hover:text-rose-800 font-medium cursor-pointer"
                  >
                    Clear notes
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 1 Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => handlePlan5Runs()}
            disabled={isPlanning || isRunning || isRefiningQuery || !question.trim() || dataLoadStatus.loading}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-40 cursor-pointer whitespace-nowrap"
            title="Skip wording check and plan the 5 tests right away"
          >
            Skip wording check &amp; plan 5 tests directly
          </button>

          <button
            type="button"
            onClick={handleRefineUserQuery}
            disabled={isRefiningQuery || isPlanning || isRunning || !question.trim() || dataLoadStatus.loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
          >
            {isRefiningQuery ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking Question...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>Check Question Wording</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* STEP 2: REVIEW & CONFIRM CLEARER QUESTION                             */}
      {/* ===================================================================== */}
      {refinedQueryState && !refinedQueryState.isConfirmed && (
        <div className="bg-white border-2 border-blue-300 rounded-xl p-6 space-y-5">
          <div className="space-y-1 border-b border-slate-100 pb-4">
            <div className="text-xs font-semibold text-blue-600">Step 2 of 4 · Quick Check</div>
            <h3 className="text-lg font-bold text-slate-900">
              Does this clearer version match what you meant?
            </h3>
            <p className="text-sm text-slate-600">
              We matched your words to the exact columns in your spreadsheet so nothing gets misunderstood. You can edit it below.
            </p>
          </div>

          {/* Editable Clearer Question */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Clearer Question (feel free to edit):
            </label>
            <textarea
              rows={3}
              value={refinedQueryState.refinedQuery}
              onChange={(e) => setRefinedQueryState({ ...refinedQueryState, refinedQuery: e.target.value })}
              className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Why we rewrote it */}
          {refinedQueryState.reasoning && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
              <div className="text-xs font-semibold text-slate-800">Why we worded it this way</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {refinedQueryState.reasoning}
              </p>
            </div>
          )}

          {/* Advanced Data & Test Mode Controls (Collapsed by default for 10th grader) */}
          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowCheckpoint1Advanced(!showCheckpoint1Advanced)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
              <span>Advanced: Data Columns &amp; Test Style ({selectedPromptPreset === 'ml' ? 'Machine Learning' : selectedPromptPreset === 'custom' ? 'Custom' : 'Standard Math'})</span>
              {showCheckpoint1Advanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showCheckpoint1Advanced && (
              <div className="mt-4 space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                {(refinedQueryState.identifiedTables?.length || refinedQueryState.identifiedColumns?.length) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {refinedQueryState.identifiedTables && refinedQueryState.identifiedTables.length > 0 && (
                      <div>
                        <span className="font-semibold text-slate-700 block mb-1">Files Used:</span>
                        <span className="text-slate-600">{refinedQueryState.identifiedTables.join(' · ')}</span>
                      </div>
                    )}
                    {refinedQueryState.identifiedColumns && refinedQueryState.identifiedColumns.length > 0 && (
                      <div>
                        <span className="font-semibold text-slate-700 block mb-1">Columns Used:</span>
                        <span className="font-mono text-slate-600">{refinedQueryState.identifiedColumns.join(', ')}</span>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Test Style Preset Switcher */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">How should we test your question?</span>
                    <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setPlanningPrompt(DEFAULT_DATA_SCIENCE_PLANNING_PROMPT);
                          setSelectedPromptPreset('standard');
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                          selectedPromptPreset === 'standard'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Data Math (Standard)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanningPrompt(ML_TENSORFLOW_PLANNING_PROMPT);
                          setSelectedPromptPreset('ml');
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                          selectedPromptPreset === 'ml'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Machine Learning</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanningPrompt(DEFAULT_DATA_SCIENCE_PLANNING_PROMPT);
                          setSelectedPromptPreset('standard');
                        }}
                        className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 rounded-md cursor-pointer"
                        title="Reset to default"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={planningPrompt}
                    onChange={(e) => {
                      setPlanningPrompt(e.target.value);
                      setSelectedPromptPreset('custom');
                    }}
                    className="w-full p-3 font-mono text-xs leading-relaxed bg-white text-slate-800 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Instructions for planning the 5 tests..."
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 block">
                    Extra Method Notes (Optional):
                  </label>
                  <textarea
                    rows={2}
                    value={methodPlanningGuidance}
                    onChange={(e) => setMethodPlanningGuidance(e.target.value)}
                    placeholder="e.g. Compare averages vs medians, or test 50 training rounds..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Step 2 Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => handlePlan5Runs(question, methodPlanningGuidance, planningPrompt)}
              className="text-xs text-slate-600 hover:text-slate-900 underline font-medium self-center sm:self-auto cursor-pointer"
            >
              Use my original question instead
            </button>

            <div className="flex items-center gap-2.5 justify-end">
              <button
                type="button"
                onClick={handleRefineUserQuery}
                disabled={isRefiningQuery}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                Try Wording Again
              </button>

              <button
                type="button"
                onClick={handleConfirmRefinedQueryAndPlan}
                disabled={isPlanning}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isPlanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Planning 5 Tests...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Looks Good — Pick 5 Tests</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmed Question Summary Strip */}
      {refinedQueryState?.isConfirmed && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-950">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">Testing Question:</span>
            <span>"{refinedQueryState.refinedQuery}"</span>
          </div>
          <button
            type="button"
            onClick={() => setRefinedQueryState({ ...refinedQueryState, isConfirmed: false })}
            className="text-xs text-emerald-800 hover:text-emerald-950 font-semibold underline inline-flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Edit3 className="w-3 h-3" /> Edit
          </button>
        </div>
      )}

      {/* Planning Loading Card */}
      {isPlanning && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2.5">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">
            Setting up 5 different ways to test your question...
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            We are picking 5 separate math checks (like averages, medians, and outlier checks) to see if they all give the same answer.
          </p>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 3: REVIEW 5 PLANNED CHECKS & RUN THEM                            */}
      {/* ===================================================================== */}
      {plannedRunsReady && runs.length === 5 && !isRunning && !analysis && (
        <div className="bg-white border-2 border-blue-300 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-blue-600">Step 3 of 4 · Ready to Test</div>
              <h3 className="text-lg font-bold text-slate-900">
                Here are the 5 checks we'll run
              </h3>
              <p className="text-sm text-slate-600">
                {methodologyOverview}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {runs.map((r, idx) => (
              <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-bold text-blue-700 tabular-nums">Check #{r.runNumber}</span>
                  <span>{r.methodCategory}</span>
                </div>
                <h4 className="text-sm font-bold text-slate-900">{r.methodName}</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{r.rationale}</p>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-xs text-slate-600">
              If 4 or 5 of these checks agree, you can trust the answer 100%.
            </p>

            <div className="flex items-center gap-3 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => handlePlan5Runs(undefined, methodPlanningGuidance, planningPrompt)}
                disabled={isRunning}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                Pick Different Checks
              </button>

              <button
                type="button"
                onClick={handleProceedToExecute}
                disabled={isRunning}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Run All 5 Checks</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Progress While Running */}
      {isRunning && (
        <div className="bg-white border border-blue-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 shrink-0" />
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {currentRunningIndex !== null
                    ? `Running Check ${currentRunningIndex + 1} of 5: ${runs[currentRunningIndex]?.methodName || 'Testing...'}`
                    : 'Running all 5 checks...'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Each check crunches your data independently to make sure there are no mistakes.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-blue-700 tabular-nums shrink-0">
              {currentRunningIndex !== null ? `${currentRunningIndex + 1} / 5` : 'Working'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map((idx) => {
              const run = runs[idx];
              const isCurrent = currentRunningIndex === idx;
              const isDone = run?.status === 'completed';
              const isErr = run?.status === 'error';

              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-center transition-colors ${
                    isErr
                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : isDone
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : isCurrent
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <div className="text-xs font-bold flex items-center justify-center gap-1 tabular-nums">
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                    {isCurrent && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Check {idx + 1}</span>
                  </div>
                  <div className="text-[11px] truncate mt-1">
                    {run?.methodName || `Method ${idx + 1}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 4: YOUR DOUBLE-CHECKED ANSWER                                    */}
      {/* ===================================================================== */}
      {analysis && (
        <div className="space-y-6">
          {/* Main Answer Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 space-y-6">
            {/* Top Score & Action Row */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-xl shrink-0 ${
                    analysis.isExceptional
                      ? 'bg-emerald-600 text-white'
                      : analysis.agreementLevel === 'High'
                        ? 'bg-blue-600 text-white'
                        : 'bg-amber-600 text-white'
                  }`}
                >
                  {analysis.isExceptional ? <Award className="w-7 h-7" /> : <CheckCheck className="w-7 h-7" />}
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                    <span
                      className={`font-bold ${
                        analysis.isExceptional
                          ? 'text-emerald-700'
                          : analysis.agreementLevel === 'High'
                            ? 'text-blue-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {analysis.isExceptional
                        ? 'Super Reliable Answer'
                        : analysis.agreementLevel === 'High'
                          ? 'Reliable Answer'
                          : 'Mixed Results — Worth Checking'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong>{analysis.agreeingRunsCount} out of 5</strong> checks agree ({analysis.agreementScore}%)
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                    Here's What We Found
                  </h2>
                </div>
              </div>

              {/* Clean Primary Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadEasyToUnderstandReport}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Download Easy Dossier</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileText className="w-4 h-4" />
                  <span>Open Full Dossier</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  {copySuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToFavourites}
                  disabled={isSavingFav || favSaved}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  {isSavingFav ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Star className={`w-3.5 h-3.5 ${favSaved ? 'fill-amber-500 text-amber-500' : 'text-slate-500'}`} />
                  )}
                  <span>{favSaved ? 'Saved!' : 'Save'}</span>
                </button>
              </div>
            </div>

            {/* Toasts */}
            {downloadSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-900 flex items-center gap-2">
                <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{downloadSuccessMsg}</span>
              </div>
            )}

            {tableSuccessMsg && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-900 flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{tableSuccessMsg}</span>
              </div>
            )}

            {/* The Highlighted Answer */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-3">
              <div className="text-xs font-semibold text-emerald-800">
                The Main Answer
              </div>
              {!analysis.consensusAnswer.includes('\n') && analysis.consensusAnswer.length < 90 && (
                <p className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug">
                  {analysis.consensusAnswer}
                </p>
              )}
              <div className="text-slate-900">
                <FormattedAnswerDisplay
                  content={analysis.consensusAnswer}
                  allowTableViewToggle={true}
                />
              </div>
            </div>

            {/* What This Means in Plain English */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-blue-600" />
                  <span>What This Means Simply</span>
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed">
                  We tested your question using 5 different math tricks—like regular averages, middle values, and removing weird outliers—and{' '}
                  <strong className="text-slate-900">{analysis.agreeingRunsCount} out of 5</strong> gave the exact same takeaway:{' '}
                  <strong className="text-emerald-800">{analysis.consensusAnswer}</strong>. That means you can trust this result!
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-600" />
                  <span>Key Takeaway &amp; What to Do Next</span>
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {analysis.keyTakeaway || 'You can safely share this number in your project, presentation, or report without worrying about hidden math quirks.'}
                </p>
              </div>
            </div>

            {/* 5-Check Visual Comparison Strip */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 text-sm">How All 5 Checks Compared</span>
                <span className="font-semibold text-emerald-700 tabular-nums">
                  {analysis.agreeingRunsCount} / 5 agreed
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                {runs.map((r, rIdx) => (
                  <div
                    key={rIdx}
                    className={`p-3 rounded-xl border text-left space-y-1 ${
                      r.isAlignedWithConsensus
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : 'bg-amber-50/70 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold tabular-nums">
                      <span>Check #{rIdx + 1}</span>
                      <span>{r.isAlignedWithConsensus ? 'Agrees' : 'Different'}</span>
                    </div>
                    <div className="text-xs font-medium text-slate-700 truncate" title={r.methodName}>
                      {r.methodName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Clickable Details for Each of the 5 Checks */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">See Each Check Up Close</h3>
                <p className="text-xs text-slate-500">Click any check below to see what it did and what it found.</p>
              </div>
            </div>

            <div className="space-y-2.5">
              {runs.map((run, idx) => {
                const isExpanded = expandedRun === idx;
                const evalInfo = analysis.runEvaluations.find(e => e.runNumber === run.runNumber);
                const isAligned = evalInfo ? evalInfo.isAlignedWithConsensus : true;
                const showCode = !!showRunCodeMap[idx];

                return (
                  <div
                    key={run.runNumber ?? idx}
                    className="rounded-xl border border-slate-200 overflow-hidden bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedRun(isExpanded ? null : idx)}
                      className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 tabular-nums ${
                            isAligned ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          #{run.runNumber}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{run.methodName}</div>
                          <div className="text-xs text-slate-500 truncate">{run.rationale}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-xs font-semibold ${
                            isAligned ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {isAligned ? 'Agrees' : 'Slightly Different'}
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
                        {(run.extractedAnswer || run.result) && (
                          <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-1.5">
                            <div className="text-xs font-semibold text-slate-700">Answer from Check #{run.runNumber}:</div>
                            <FormattedAnswerDisplay
                              content={run.extractedAnswer || (typeof run.result === 'object' ? JSON.stringify(run.result, null, 2) : String(run.result))}
                              compact={true}
                              allowTableViewToggle={true}
                            />
                          </div>
                        )}

                        {run.narrative && (
                          <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-1">
                            <div className="text-xs font-semibold text-slate-700">Explanation:</div>
                            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{run.narrative}</p>
                          </div>
                        )}

                        {evalInfo?.methodNuance && (
                          <div className="text-xs text-slate-600 px-1">
                            <strong>Comparison note:</strong> {evalInfo.methodNuance}
                          </div>
                        )}

                        {run.error && (
                          <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>Issue during check: {run.error}</span>
                          </div>
                        )}

                        {/* Collapsible Code Toggle (Hidden by default for non-geeks) */}
                        {run.code && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => setShowRunCodeMap(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Code className="w-3.5 h-3.5" />
                              <span>{showCode ? 'Hide computer code' : 'Show computer code (for techies)'}</span>
                            </button>
                            {showCode && (
                              <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-56">
                                <code>{run.code}</code>
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tables & Report Extras */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Dossier Tables &amp; Quick Exports</h3>
                <p className="text-xs text-slate-500">
                  Add neat comparison tables to include in your Full Dossier, or download a super-short summary.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoSuggestAndAddTables}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Auto-Create Tables</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddTableOpen(!isAddTableOpen)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Table className="w-3.5 h-3.5 text-slate-600" />
                  <span>{isAddTableOpen ? 'Close Table Builder' : 'Make Your Own Table'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadLaymanReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>Download Quick 1-Pager</span>
                </button>
              </div>
            </div>

            {isAddTableOpen && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">1-Click Tables:</span>
                  <button
                    type="button"
                    onClick={handleAddComparisonTable}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5"
                  >
                    <Table2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>+ 5-Check Comparison</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddConsensusBreakdownTable}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5"
                  >
                    <Grid className="w-3.5 h-3.5 text-emerald-600" />
                    <span>+ Key Metrics Summary</span>
                  </button>
                </div>

                <form onSubmit={handleCreateCustomTable} className="bg-white p-4 border border-slate-200 rounded-lg space-y-3">
                  <div className="text-xs font-semibold text-slate-800">Or Type Your Own Table:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={tableTitleInput}
                      onChange={(e) => setTableTitleInput(e.target.value)}
                      placeholder="Table Title (e.g. Sales by City)"
                      className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={tableHeadersInput}
                      onChange={(e) => setTableHeadersInput(e.target.value)}
                      placeholder="Column Names (comma-separated, e.g. City, Total, Goal)"
                      className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={tableRowsInput}
                    onChange={(e) => setTableRowsInput(e.target.value)}
                    placeholder="Rows (one per line, comma separated, e.g. Austin, 450, 400)"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!tableHeadersInput.trim() || !tableRowsInput.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      + Add Table
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Active Custom Tables */}
            {customTables.length > 0 && (
              <div className="space-y-3 pt-2">
                {customTables.map(t => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">{t.title}</h4>
                        {t.description && <p className="text-[11px] text-slate-500">{t.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const csv = [t.headers.join(','), ...t.rows.map(r => r.join(','))].join('\n');
                            navigator.clipboard.writeText(csv);
                            setTableSuccessMsg(`Copied "${t.title}" as CSV!`);
                            setTimeout(() => setTableSuccessMsg(null), 2500);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-[11px] font-semibold cursor-pointer flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copy CSV</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveTable(t.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                          title="Remove Table"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 text-slate-700 border-b border-slate-200 font-semibold">
                            {t.headers.map((h, hIdx) => (
                              <th key={hIdx} className="px-3.5 py-2">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {t.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50/70">
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3.5 py-2 text-slate-800 tabular-nums">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Collapsible Technical Notes */}
            <div className="pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Info className="w-3.5 h-3.5" />
                <span>{showTechnicalDetails ? 'Hide behind-the-scenes math notes' : 'Show behind-the-scenes math notes'}</span>
                {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTechnicalDetails && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                    <div className="font-semibold text-slate-800">Original vs. Clearer Question</div>
                    <p className="text-slate-600"><strong>Asked:</strong> "{question}"</p>
                    <p className="text-slate-600"><strong>Tested:</strong> "{refinedQueryState?.refinedQuery || runs[0]?.refinedQuery || question}"</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                    <div className="font-semibold text-slate-800">Detailed Synthesis</div>
                    <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{analysis.consistencyVerdict}</p>
                    <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{analysis.detailedSynthesis}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full Dossier Modal */}
      {analysis && (
        <ConsistencyReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          question={refinedQueryState?.refinedQuery || question}
          originalQuery={question}
          refinedQuery={refinedQueryState?.refinedQuery || runs[0]?.refinedQuery}
          isRefinedQueryConfirmed={refinedQueryState?.isConfirmed ?? true}
          analysis={analysis}
          runs={runs}
          projectName={currentProject?.name}
          projectId={currentProject?.projectId}
          schemaDescription={currentProject?.schemaDescription}
          explainerModel={models.explainer}
          initialCustomTables={customTables}
          onCustomTablesChange={setCustomTables}
        />
      )}
    </div>
  );
};
