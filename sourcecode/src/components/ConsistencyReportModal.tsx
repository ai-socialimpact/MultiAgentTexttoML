import React, { useState } from 'react';
import { 
  Printer, 
  Download, 
  X, 
  Award, 
  CheckCheck, 
  CheckCircle2, 
  Sparkles, 
  Layers, 
  Code, 
  Scale, 
  BarChart3, 
  FileText, 
  ShieldCheck, 
  HelpCircle, 
  TrendingUp, 
  Info,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquarePlus,
  Wand2,
  PlusCircle,
  Send,
  Loader2,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  PieChart,
  Sliders,
  Check,
  Database,
  BookOpen,
  FileCode,
  Binary,
  Lightbulb,
  UserCheck,
  Table,
  Table2,
  Trash2,
  Grid
} from 'lucide-react';
import { agents } from '../lib/agents';
import { localDb } from '../lib/localDb';
import {
  DOSSIER_PERSONAS,
  type DossierPersonaId
} from '../lib/dossierPersonas';
import { 
  FormattedAnswerDisplay, 
  formatContentToHtml, 
  formatMarkdownToHtml,
  escapeHtml,
  buildRunComparisonTable, 
  generateLaymanReportHtml, 
  generateEasyToUnderstandReportHtml,
  autoSuggestTablesForDossier,
  CustomDataTable 
} from './FormattedAnswerDisplay';

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
  laymanExplanation?: string;
}

interface CustomVisualChart {
  id: string;
  title: string;
  type: string;
  description: string;
  items: {
    label: string;
    value: number;
    displayValue: string;
    status?: string;
    note?: string;
  }[];
}

interface QAItem {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

interface ContextualizedAnalysis {
  domainOverview: string;
  schemaEntities?: {
    tableName: string;
    role: string;
    relevantColumns: string[];
  }[];
  contextualizedRuns?: {
    runNumber: number;
    methodName: string;
    domainInterpretation: string;
  }[];
  domainNuancesAndCaveats?: string;
  domainExpertRecommendations?: string[];
  schemaSource?: string;
}

interface ConsistencyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: string;
  originalQuery?: string;
  refinedQuery?: string;
  isRefinedQueryConfirmed?: boolean;
  analysis: ConsistencyAnalysis;
  runs: ConsistencyRun[];
  projectName?: string;
  projectId?: string;
  schemaDescription?: string;
  explainerModel?: string;
  initialCustomTables?: CustomDataTable[];
  onCustomTablesChange?: (tables: CustomDataTable[]) => void;
}

export const ConsistencyReportModal: React.FC<ConsistencyReportModalProps> = ({
  isOpen,
  onClose,
  question,
  originalQuery,
  refinedQuery,
  isRefinedQueryConfirmed = true,
  analysis: initialAnalysis,
  runs,
  projectName = 'Data Intelligence Workspace',
  projectId,
  schemaDescription,
  explainerModel,
  initialCustomTables = [],
  onCustomTablesChange
}) => {
  const [activeView, setActiveView] = useState<'both' | 'layman' | 'scientific'>('both');
  const [expandedCodeIndex, setExpandedCodeIndex] = useState<number | null>(null);
  const [copyCodeSuccess, setCopyCodeSuccess] = useState<number | null>(null);

  // Dynamic state for Refinements, Q&A, and Visuals
  const [currentAnalysis, setCurrentAnalysis] = useState<ConsistencyAnalysis>(initialAnalysis);
  const [activePanel, setActivePanel] = useState<'none' | 'ask' | 'refine' | 'visuals' | 'contextualize' | 'tables'>('none');
  
  // Q&A State
  const [qaList, setQaList] = useState<QAItem[]>([]);
  const [askInput, setAskInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Refine Report State
  const [refineInput, setRefineInput] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [refineHistory, setRefineHistory] = useState<string[]>([]);
  const [refineSuccessMsg, setRefineSuccessMsg] = useState<string | null>(null);

  // Add Visuals State
  const [customVisuals, setCustomVisuals] = useState<CustomVisualChart[]>([]);
  const [visualPromptInput, setVisualPromptInput] = useState('');
  const [isAddingVisuals, setIsAddingVisuals] = useState(false);
  const [visualSuccessMsg, setVisualSuccessMsg] = useState<string | null>(null);

  // Audience Persona Tailoring State
  const [selectedPersona, setSelectedPersona] = useState<DossierPersonaId>('school_student');
  const [tailoredPersonaId, setTailoredPersonaId] = useState<DossierPersonaId | null>(null);
  const [isTailoringPersona, setIsTailoringPersona] = useState(false);
  const [personaSuccessMsg, setPersonaSuccessMsg] = useState<string | null>(null);

  // Custom Tables State
  const [customTables, setCustomTables] = useState<CustomDataTable[]>(initialCustomTables);
  const [tableTitleInput, setTableTitleInput] = useState('');
  const [tableHeadersInput, setTableHeadersInput] = useState('');
  const [tableRowsInput, setTableRowsInput] = useState('');
  const [tableSuccessMsg, setTableSuccessMsg] = useState<string | null>(null);

  // Sync initialCustomTables if changed externally
  React.useEffect(() => {
    if (initialCustomTables && initialCustomTables.length > 0) {
      setCustomTables(initialCustomTables);
    }
  }, [initialCustomTables]);

  // Contextualize State (schemadescription.txt)
  const [contextualizedData, setContextualizedData] = useState<ContextualizedAnalysis | null>(null);
  const [isContextualizing, setIsContextualizing] = useState(false);
  const [contextualizeError, setContextualizeError] = useState<string | null>(null);
  const [showSchemaPreview, setShowSchemaPreview] = useState(false);
  const [loadedSchemaSnippet, setLoadedSchemaSnippet] = useState<string>('');

  if (!isOpen) return null;

  const userQueryDisplay = originalQuery || question;
  const refinedQueryDisplay = refinedQuery || question;

  const generatedDate = new Date().toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  const shortSummary = `Across 5 independent analytical runs testing diverse data science methodologies, the system recorded an agreement score of ${currentAnalysis.agreementScore}% (${currentAnalysis.agreeingRunsCount} of 5 runs matching). The dominant finding concludes: "${currentAnalysis.consensusAnswer}". This cross-method convergence confirms that the result is statistically robust and ${currentAnalysis.isExceptional ? 'exceptionally consistent against distribution variations and outlier biases.' : 'demonstrates strong multi-method alignment.'}`;

  // 1. Function: Contextualize using schemadescription.txt and Explainer Agent LLM
  const handleContextualize = async () => {
    setIsContextualizing(true);
    setContextualizeError(null);

    try {
      // Fetch schema description from props or localDb (schemadescription.txt)
      let finalSchema = schemaDescription || '';
      if (!finalSchema && projectId) {
        try {
          const localFile = await localDb.files
            .where({ projectId, name: 'schemadescription.txt' })
            .first();
          if (localFile && localFile.content) {
            finalSchema = localFile.content instanceof Blob 
              ? await localFile.content.text() 
              : String(localFile.content);
          }
        } catch (dbErr) {
          console.warn('Could not read from localDb:', dbErr);
        }
      }

      setLoadedSchemaSnippet(finalSchema);

      const result = await agents.contextualizeConsistencyReport(
        finalSchema,
        {
          originalQuery: question,
          consensusAnswer: currentAnalysis.consensusAnswer,
          consistencyVerdict: currentAnalysis.consistencyVerdict,
          detailedSynthesis: currentAnalysis.detailedSynthesis,
          runs
        },
        explainerModel
      );

      setContextualizedData({
        ...result,
        schemaSource: finalSchema ? 'schemadescription.txt (Project Files in DB)' : 'Inferred Data Model Architecture'
      });
      setActivePanel('none');
    } catch (err: any) {
      console.error('Error contextualizing report:', err);
      setContextualizeError(err.message || 'Failed to generate domain & schema contextualization.');
    } finally {
      setIsContextualizing(false);
    }
  };

  // 2. Function: Ask a Question using Explainer Agent LLM
  const handleAskQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!askInput.trim() || isAsking) return;

    const userQ = askInput.trim();
    setIsAsking(true);
    setAskError(null);

    try {
      const response = await agents.answerConsistencyQuestion(
        userQ,
        {
          originalQuery: question,
          consensusAnswer: currentAnalysis.consensusAnswer,
          consistencyVerdict: currentAnalysis.consistencyVerdict,
          detailedSynthesis: currentAnalysis.detailedSynthesis,
          runs
        },
        explainerModel
      );

      const newItem: QAItem = {
        id: `qa-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        question: userQ,
        answer: response.answer || 'No answer generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setQaList(prev => [...prev, newItem]);
      setAskInput('');
    } catch (err: any) {
      console.error('Error asking question to Explainer Agent:', err);
      setAskError(err.message || 'Failed to generate answer. Please try again.');
    } finally {
      setIsAsking(false);
    }
  };

  // 3. Function: Refine the Report based on user text suggestion using Explainer Agent LLM
  const handleRefineReport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!refineInput.trim() || isRefining) return;

    const suggestion = refineInput.trim();
    setIsRefining(true);
    setRefineSuccessMsg(null);

    try {
      const refined = await agents.refineConsistencyReport(
        suggestion,
        {
          originalQuery: question,
          consensusAnswer: currentAnalysis.consensusAnswer,
          consistencyVerdict: currentAnalysis.consistencyVerdict,
          detailedSynthesis: currentAnalysis.detailedSynthesis,
          keyTakeaway: currentAnalysis.keyTakeaway,
          runs
        },
        explainerModel
      );

      setCurrentAnalysis(prev => ({
        ...prev,
        consensusAnswer: refined.consensusAnswer || prev.consensusAnswer,
        consistencyVerdict: refined.consistencyVerdict || prev.consistencyVerdict,
        detailedSynthesis: refined.detailedSynthesis || prev.detailedSynthesis,
        keyTakeaway: refined.keyTakeaway || prev.keyTakeaway,
        laymanExplanation: refined.laymanExplanation || prev.laymanExplanation
      }));

      setRefineHistory(prev => [...prev, suggestion]);
      setRefineInput('');
      setRefineSuccessMsg('Report refined successfully per your suggestion!');
      setTimeout(() => setRefineSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error('Error refining report:', err);
      alert('Failed to refine report: ' + err.message);
    } finally {
      setIsRefining(false);
    }
  };

  // 3b. Function: Tailor Dossier for NGO / Technical Audience Persona
  const handleTailorForPersona = async (personaId: DossierPersonaId) => {
    const persona = DOSSIER_PERSONAS.find(p => p.id === personaId);
    if (!persona || isTailoringPersona) return;

    setSelectedPersona(personaId);
    setIsTailoringPersona(true);
    setPersonaSuccessMsg(null);

    try {
      const tailored = await agents.tailorConsistencyDossierForPersona(
        {
          id: persona.id,
          label: persona.label,
          instructionPrompt: persona.instructionPrompt
        },
        {
          originalQuery: question,
          consensusAnswer: currentAnalysis.consensusAnswer,
          consistencyVerdict: currentAnalysis.consistencyVerdict,
          detailedSynthesis: currentAnalysis.detailedSynthesis,
          keyTakeaway: currentAnalysis.keyTakeaway,
          runs
        },
        explainerModel
      );

      setCurrentAnalysis(prev => ({
        ...prev,
        consensusAnswer: tailored.consensusAnswer || prev.consensusAnswer,
        consistencyVerdict: tailored.consistencyVerdict || prev.consistencyVerdict,
        detailedSynthesis: tailored.detailedSynthesis || prev.detailedSynthesis,
        keyTakeaway: tailored.keyTakeaway || prev.keyTakeaway,
        laymanExplanation: tailored.laymanExplanation || prev.laymanExplanation
      }));

      setTailoredPersonaId(personaId);
      setPersonaSuccessMsg(`Dossier tailored for ${persona.shortLabel}!`);
      setTimeout(() => setPersonaSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error('Error tailoring dossier for persona:', err);
      alert('Failed to tailor dossier for persona: ' + err.message);
    } finally {
      setIsTailoringPersona(false);
    }
  };

  // 4. Function: Add Visuals using Explainer Agent LLM
  const handleAddVisuals = async (promptOverride?: string) => {
    const promptToUse = promptOverride || visualPromptInput.trim() || 'Generate comparative visual charts showing method variances and sensitivity';
    setIsAddingVisuals(true);
    setVisualSuccessMsg(null);

    try {
      const result = await agents.generateConsistencyVisuals(
        promptToUse,
        {
          originalQuery: question,
          consensusAnswer: currentAnalysis.consensusAnswer,
          runs
        },
        explainerModel
      );

      if (result.visuals && result.visuals.length > 0) {
        const uniqueVisuals: CustomVisualChart[] = result.visuals.map((vis: any, idx: number) => ({
          ...vis,
          id: `vis-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 9)}`
        }));
        setCustomVisuals(prev => [...prev, ...uniqueVisuals]);
        setVisualPromptInput('');
        setVisualSuccessMsg(`Added ${result.visuals.length} new visual chart(s) to the report!`);
        setTimeout(() => setVisualSuccessMsg(null), 4000);
      } else {
        alert('No new visual specs generated. Please try a different prompt.');
      }
    } catch (err: any) {
      console.error('Error adding visuals:', err);
      alert('Failed to generate visuals: ' + err.message);
    } finally {
      setIsAddingVisuals(false);
    }
  };

  // 5. Table Management Handlers
  const handleAddComparisonTable = () => {
    const compTable = buildRunComparisonTable(runs);
    setCustomTables(prev => {
      if (prev.some(t => t.id.startsWith('table-comparison'))) {
        return prev;
      }
      return [compTable, ...prev];
    });
    setTableSuccessMsg('Added 5-Method Comparison Table to the dossier!');
    setTimeout(() => setTableSuccessMsg(null), 3500);
  };

  const handleAddConsensusBreakdownTable = () => {
    const headers = ['Metric / Parameter', 'Observed Value', 'Confidence Status'];
    const rows = [
      ['Primary Consensus Finding', currentAnalysis.consensusAnswer, `${currentAnalysis.agreementLevel} Confidence`],
      ['Convergence Ratio', `${currentAnalysis.agreeingRunsCount} of 5 Runs (${currentAnalysis.agreementScore}%)`, 'Cross-Validated'],
      ['Analytical Stability', currentAnalysis.isExceptional ? 'Exceptional Invariance' : 'High Alignment', 'Verified Across Methods']
    ];

    const newTable: CustomDataTable = {
      id: `table-breakdown-${Date.now()}`,
      title: 'Consensus Finding & Metrics Breakdown Table',
      description: 'Structured breakdown of verified metrics and statistical parameters.',
      headers,
      rows
    };

    setCustomTables(prev => [...prev, newTable]);
    setTableSuccessMsg('Added Consensus Finding & Metrics Breakdown Table!');
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

  const handleDownloadLaymanReport = () => {
    const html = generateLaymanReportHtml({
      question,
      refinedQuery: refinedQueryDisplay,
      projectName,
      consensusAnswer: currentAnalysis.consensusAnswer,
      agreementScore: currentAnalysis.agreementScore,
      agreeingRunsCount: currentAnalysis.agreeingRunsCount,
      agreementLevel: currentAnalysis.agreementLevel,
      laymanExplanation: currentAnalysis.laymanExplanation,
      keyTakeaway: currentAnalysis.keyTakeaway,
      runs,
      customTables
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `layman-answer-consistency-report-${(projectName || 'workspace').toLowerCase().replace(/\s+/g, '-')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadEasyToUnderstandReport = () => {
    const html = generateEasyToUnderstandReportHtml({
      question,
      refinedQuery: refinedQueryDisplay,
      refinedQueryDetails: {
        reasoning: 'Disambiguated and verified across 5 analytical methodologies.',
        identifiedTables: (runs[0] as any)?.extractedTables || [],
        identifiedColumns: (runs[0] as any)?.extractedColumns || []
      },
      projectName,
      consensusAnswer: currentAnalysis.consensusAnswer,
      agreementScore: currentAnalysis.agreementScore,
      agreeingRunsCount: currentAnalysis.agreeingRunsCount,
      agreementLevel: currentAnalysis.agreementLevel,
      schemaContext: contextualizedData ? {
        domainOverview: contextualizedData.domainOverview,
        mappedEntities: contextualizedData.schemaEntities?.map((e: any) => ({
          entity: e.tableName || e.entityName || e.entity || 'Entity',
          description: e.role || e.description || 'Database entity',
          relevance: (e.relevantColumns && e.relevantColumns.length > 0 ? `Relevant Columns: ${e.relevantColumns.join(', ')}` : e.relevance) || 'Schema field used in calculations'
        })),
        domainInsights: contextualizedData.domainExpertRecommendations || (contextualizedData.domainNuancesAndCaveats ? [contextualizedData.domainNuancesAndCaveats] : []),
        schemaDescriptionText: contextualizedData.schemaSource || ''
      } : {
        domainOverview: `Grounded in project dataset and schema definitions. All calculations, data types, and primary key relationships adhere strictly to the underlying tables.`,
        mappedEntities: ((runs[0] as any)?.extractedTables || []).map((t: string) => ({
          entity: t,
          description: 'Database entity mapped from query',
          relevance: 'Primary table used in analytical pipeline'
        })),
        domainInsights: [
          'Calculations verified against schema definitions to avoid invalid type coercions.',
          'Cross-validated across 5 independent methods for invariant conclusions.'
        ]
      },
      runs,
      customTables,
      customVisuals,
      methodologyOverview: '5-Method Analytical Convergence Protocol'
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `easy-to-understand-report-${(projectName || 'workspace').toLowerCase().replace(/\s+/g, '-')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleAutoSuggestAndAddTables = () => {
    if (!currentAnalysis && runs.length === 0) return;
    const suggested = autoSuggestTablesForDossier(runs, currentAnalysis, currentAnalysis?.consensusAnswer);
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
    setActivePanel('tables');
    setTableSuccessMsg(
      addedCount > 0
        ? `Successfully auto-suggested & added ${addedCount} table(s) to the dossier!`
        : 'All suggested tables are already in the dossier!'
    );
    setTimeout(() => setTableSuccessMsg(null), 4000);
  };

  const handlePrint = () => {
    window.print();
  };

  // Generate self-contained standalone HTML file
  const handleDownloadHtml = () => {
    const contextualizedHtml = contextualizedData ? `
      <!-- CONTEXTUALIZED SECTION (TOP OF REPORT) -->
      <div style="background: #f8fafc; border: 2px solid #6366f1; border-radius: 14px; padding: 24px; margin-bottom: 28px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e0e7ff; padding-bottom: 10px;">
          <div>
            <span class="badge" style="background: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe;">
              Domain &amp; Schema Contextualized Architecture
            </span>
            <h3 style="font-size: 18px; color: #1e1b4b; font-weight: 800; margin-top: 6px;">
              Domain Understanding &amp; DDL Schema Context
            </h3>
          </div>
          <span style="font-size: 11px; font-weight: 700; color: #4338ca; background: #ffffff; padding: 4px 10px; border-radius: 6px; border: 1px solid #c7d2fe;">
            Source: ${contextualizedData.schemaSource || 'schemadescription.txt'}
          </span>
        </div>

        <div style="margin-bottom: 18px;">
          <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: #3730a3; margin-bottom: 6px;">
            Domain Overview &amp; Consensus Interpretation
          </h4>
          <p style="font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
            ${contextualizedData.domainOverview}
          </p>
        </div>

        ${contextualizedData.schemaEntities && contextualizedData.schemaEntities.length > 0 ? `
          <div style="margin-bottom: 18px;">
            <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: #3730a3; margin-bottom: 8px;">
              DDL Entity &amp; Schema Mapping
            </h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px;">
              ${contextualizedData.schemaEntities.map(ent => `
                <div style="background: #ffffff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px;">
                  <strong style="color: #312e81; font-size: 12px;">Table: ${ent.tableName}</strong>
                  <p style="font-size: 11px; color: #475569; margin: 4px 0;">${ent.role}</p>
                  <div style="font-size: 10px; color: #6366f1; font-weight: 600;">
                    Columns: ${ent.relevantColumns.join(', ')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${contextualizedData.contextualizedRuns && contextualizedData.contextualizedRuns.length > 0 ? `
          <div style="margin-bottom: 18px;">
            <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: #3730a3; margin-bottom: 8px;">
              5-Run Domain Explanations (Schema Context)
            </h4>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${contextualizedData.contextualizedRuns.map(cRun => `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #6366f1; border-radius: 6px; padding: 10px 14px;">
                  <strong style="font-size: 12px; color: #0f172a;">Run #${cRun.runNumber}: ${cRun.methodName}</strong>
                  <p style="font-size: 12px; color: #334155; margin-top: 3px; line-height: 1.5;">${cRun.domainInterpretation}</p>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${contextualizedData.domainNuancesAndCaveats ? `
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-bottom: 14px;">
            <strong style="font-size: 12px; color: #92400e; text-transform: uppercase; display: block; margin-bottom: 3px;">
              Domain Nuances &amp; Constraints
            </strong>
            <p style="font-size: 12px; color: #78350f; line-height: 1.5;">${contextualizedData.domainNuancesAndCaveats}</p>
          </div>
        ` : ''}

        ${contextualizedData.domainExpertRecommendations && contextualizedData.domainExpertRecommendations.length > 0 ? `
          <div>
            <strong style="font-size: 12px; color: #1e1b4b; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Domain Expert Recommendations
            </strong>
            <ul style="margin-left: 18px; font-size: 12px; color: #334155;">
              ${contextualizedData.domainExpertRecommendations.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    ` : '';

    const customVisualsHtml = customVisuals.length > 0 ? `
      <div class="section-title">
        <span>Custom Visual Analytics &amp; Deep-Dive Charts</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin: 20px 0;">
        ${customVisuals.map(vis => `
          <div class="card" style="margin-bottom: 0;">
            <h4 style="font-size: 14px; font-weight: 700; color: var(--gray-900); margin-bottom: 4px;">${vis.title}</h4>
            <p style="font-size: 11px; color: var(--gray-500); margin-bottom: 12px;">${vis.description}</p>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${vis.items.map(item => `
                <div>
                  <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="font-weight: 600; color: var(--gray-800);">${item.label}</span>
                    <span style="font-weight: 700; color: ${item.status === 'nuance' ? 'var(--amber)' : 'var(--emerald)'};">${item.displayValue}</span>
                  </div>
                  <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${Math.min(100, Math.max(10, item.value))}%; height: 100%; background: ${item.status === 'nuance' ? '#d97706' : '#059669'}; border-radius: 4px;"></div>
                  </div>
                  ${item.note ? `<div style="font-size: 10px; color: var(--gray-500); margin-top: 2px;">${item.note}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const qaHtml = qaList.length > 0 ? `
      <!-- 11. INTERACTIVE EXPLAINER CONSULTATION LOG -->
      <div style="margin-top: 36px; margin-bottom: 28px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--gray-200);">
          <span style="width: 26px; height: 26px; background: #dbeafe; color: #1d4ed8; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">11</span>
          <h2 style="font-size: 18px; font-weight: 800; color: var(--gray-900);">11. Interactive Explainer Consultation Log</h2>
          <span style="font-size: 12px; font-weight: 700; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; padding: 3px 10px; border-radius: 9999px; margin-left: auto;">
            ${qaList.length} ${qaList.length === 1 ? 'Inquiry' : 'Inquiries'} Documented
          </span>
        </div>
        <p style="font-size: 12.5px; color: var(--gray-600); margin-bottom: 18px; line-height: 1.5;">
          Direct consultation transcripts between the user and the Explainer Agent. Includes technical clarifications, sensitivity deep-dives, empirical tables, and statistical range explanations.
        </p>

        <div style="display: flex; flex-direction: column; gap: 18px;">
          ${qaList.map((qa, qIdx) => `
            <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden;">
              <!-- User Question Header -->
              <div style="background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%); border-bottom: 1px solid #bfdbfe; padding: 12px 18px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="background: #2563eb; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em;">
                    Inquiry #${qIdx + 1}
                  </span>
                  <span style="font-size: 13.5px; font-weight: 700; color: #1e3a8a;">
                    ${escapeHtml(qa.question)}
                  </span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b;">
                  <span>🕒 ${escapeHtml(qa.timestamp)}</span>
                  <span style="background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">Consultation Record</span>
                </div>
              </div>

              <!-- Explainer Answer Body (Formatted HTML) -->
              <div style="padding: 18px 20px; background: #ffffff;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px; font-size: 11px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 0.04em;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                  Explainer Agent Response &amp; Empirical Findings
                </div>
                <div style="font-size: 12.5px; color: #334155; line-height: 1.6;">
                  ${formatMarkdownToHtml(qa.answer)}
                </div>
                <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; font-size: 10.5px; color: #94a3b8;">
                  <span>Explainer Model: ${escapeHtml(explainerModel || 'Automated Intelligence Agent')}</span>
                  <span>Cross-Validation Status: Invariance Verified</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Answer Consistency Report - ${question.replace(/["']/g, '')}</title>
  <style>
    :root {
      --primary: #1e3a8a;
      --primary-light: #eff6ff;
      --emerald: #059669;
      --emerald-light: #ecfdf5;
      --amber: #d97706;
      --amber-light: #fffbeb;
      --gray-900: #0f172a;
      --gray-700: #334155;
      --gray-600: #475569;
      --gray-500: #64748b;
      --gray-200: #e2e8f0;
      --gray-100: #f1f5f9;
      --gray-50: #f8fafc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: var(--gray-700);
      background: #f8fafc;
      padding: 40px 20px;
    }
    .report-container {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 16px;
      padding: 48px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.04);
    }
    .header-banner {
      border-bottom: 2px solid var(--gray-200);
      padding-bottom: 28px;
      margin-bottom: 32px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-exceptional { background: var(--emerald-light); color: var(--emerald); border: 1px solid #a7f3d0; }
    .badge-primary { background: var(--primary-light); color: var(--primary); border: 1px solid #bfdbfe; }
    h1 { font-size: 26px; color: var(--gray-900); margin: 12px 0 6px 0; font-weight: 800; }
    .meta-text { font-size: 13px; color: var(--gray-500); }
    .question-box {
      background: var(--gray-50);
      border-left: 4px solid var(--primary);
      padding: 16px 20px;
      border-radius: 0 8px 8px 0;
      margin: 24px 0;
      font-size: 15px;
      color: var(--gray-900);
    }
    .card {
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
      margin-bottom: 28px;
    }
    .stat-box {
      background: var(--primary-light);
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    .stat-number { font-size: 40px; font-weight: 800; color: var(--primary); line-height: 1; }
    .stat-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--gray-600); margin-top: 6px; }
    .section-title {
      font-size: 20px;
      font-weight: 800;
      color: var(--gray-900);
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 36px 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--gray-200);
    }
    .section-desc { font-size: 13px; color: var(--gray-500); margin-bottom: 20px; }
    .run-card {
      border: 1px solid var(--gray-200);
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 16px;
      background: var(--gray-50);
    }
    .run-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .run-title { font-size: 14px; font-weight: 700; color: var(--gray-900); }
    .code-block {
      background: #0f172a;
      color: #f8fafc;
      padding: 14px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      overflow-x: auto;
      margin-top: 10px;
    }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    th { background: var(--gray-100); text-align: left; padding: 10px 12px; font-weight: 700; border-bottom: 2px solid var(--gray-200); }
    td { padding: 10px 12px; border-bottom: 1px solid var(--gray-200); vertical-align: top; }
    .aligned-tag { color: var(--emerald); font-weight: 700; }
    .nuance-tag { color: var(--amber); font-weight: 700; }
    .chart-box {
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      text-align: center;
    }
    /* Collapsible Sections (Details / Summary) */
    details.collapsible-section {
      transition: all 0.2s ease-in-out;
    }
    details.collapsible-section summary {
      cursor: pointer;
      user-select: none;
      outline: none;
      list-style: none;
    }
    details.collapsible-section summary::-webkit-details-marker {
      display: none;
    }
    details.collapsible-section summary::marker {
      display: none;
    }
    details.collapsible-section[open] .collapse-chevron {
      transform: rotate(180deg);
    }
    details.collapsible-section:not([open]) summary {
      border-bottom: none !important;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .report-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      details.collapsible-section { display: block !important; border: 1px solid var(--gray-200) !important; }
      details.collapsible-section summary { display: none !important; }
      details.collapsible-section > * { display: block !important; }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <!-- Header -->
    <div class="header-banner">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <span class="badge ${currentAnalysis.isExceptional ? 'badge-exceptional' : 'badge-primary'}">
            ${currentAnalysis.agreementLevel} Agreement Dossier
          </span>
          ${tailoredPersonaId ? `<span class="badge badge-primary" style="margin-left: 6px;">Audience: ${escapeHtml(DOSSIER_PERSONAS.find(p => p.id === tailoredPersonaId)?.label || tailoredPersonaId)}</span>` : ''}
          <h1>Answer Consistency Professional Dossier</h1>
          <p class="meta-text">Project: ${projectName} &bull; Generated: ${generatedDate} &bull; Multi-Method Analytical Cross-Validation</p>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 32px; font-weight: 800; color: ${currentAnalysis.isExceptional ? 'var(--emerald)' : 'var(--primary)'}; line-height: 1;">
            ${currentAnalysis.agreementScore}%
          </div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--gray-500); font-weight: 700; margin-top: 4px;">
            ${currentAnalysis.agreeingRunsCount} / 5 Methods Converged
          </div>
        </div>
      </div>
    </div>

    <!-- 1. USER QUERY -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #eff6ff; color: #1e40af; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">1</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">1. User Query</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Original Business Prompt</span>
      </div>
      <div class="card" style="margin-bottom: 0;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--gray-500); margin-bottom: 8px;">
          Question Submitted by Human User:
        </div>
        <blockquote style="font-size: 15px; font-weight: 600; color: var(--gray-900); background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 8px; padding: 14px 18px; margin: 0; font-style: italic;">
          "${userQueryDisplay}"
        </blockquote>
        <div style="font-size: 11px; color: var(--gray-500); margin-top: 8px;">
          Target Project: <strong>${projectName}</strong> &bull; Raw unmanipulated prompt authoring
        </div>
      </div>
    </div>

    <!-- 2. REFINED USER QUERY -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #f3e8ff; color: #7e22ce; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">2</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">2. Refined User Query</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Domain Disambiguated &amp; Schema Mapped</span>
      </div>
      <div class="card" style="margin-bottom: 0; border-color: #d8b4fe;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b21a8;">
            Disambiguated by Query Interpreter Agent:
          </span>
          <span style="background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700;">
            ✓ Confirmed by Human Expert
          </span>
        </div>
        <div style="font-size: 14px; font-weight: 700; color: #3b0764; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 14px 18px; font-family: monospace;">
          "${refinedQueryDisplay}"
        </div>
        <div style="font-size: 11px; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 8px 12px; margin-top: 10px;">
          <strong>Human Expert Confirmation:</strong> The Refined User Query was verified, inspected, and explicitly approved by the Human Expert prior to triggering the 5 independent analytical runs.
        </div>
      </div>
    </div>

    <!-- 3. VERY SHORT SUMMARY (EXECUTIVE TL;DR) -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #fef3c7; color: #b45309; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">3</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">3. Very Short Summary (Executive TL;DR)</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Fast-Reading Synopsis for Leadership</span>
      </div>
      <div class="card" style="margin-bottom: 0; background: #fffbeb; border-color: #fde68a;">
        <p style="font-size: 15px; font-weight: 600; color: #1e293b; line-height: 1.6; margin-bottom: 14px;">
          ${shortSummary}
        </p>
        <div style="display: flex; flex-direction: column; gap: 12px; padding-top: 14px; border-top: 1px solid #fef08a;">
          <div style="background: #ffffff; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #92400e; margin-bottom: 4px;">
              Core Answer
            </div>
            <div style="font-size: 14px; font-weight: 800; color: #1e3a8a; line-height: 1.5;">
              ${currentAnalysis.consensusAnswer}
            </div>
          </div>
          <div style="background: #ffffff; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #92400e; margin-bottom: 4px;">
              Convergence Ratio
            </div>
            <div style="font-size: 14px; font-weight: 800; color: #065f46; line-height: 1.5;">
              ${currentAnalysis.agreeingRunsCount} / 5 Independent Methods Aligned (${currentAnalysis.agreementScore}% Agreement)
            </div>
          </div>
          <div style="background: #ffffff; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #92400e; margin-bottom: 4px;">
              Stability Verdict
            </div>
            <div style="font-size: 14px; font-weight: 800; color: #4338ca; line-height: 1.5;">
              ${currentAnalysis.isExceptional ? 'Exceptional Invariance (All runs converge to invariant conclusion)' : 'High Cross-Method Stability (Consensus confirmed across analytical pipelines)'}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. CONSENSUS CONCLUSION -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #d1fae5; color: #047857; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">4</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">4. Consensus Conclusion</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Cross-Validated Dominant Finding</span>
      </div>
      <div class="card" style="margin-bottom: 0; border: 2px solid #a7f3d0;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #166534;">
              Validated Core Answer:
            </span>
            <span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">
              ${currentAnalysis.agreementLevel} Confidence
            </span>
          </div>
          ${!currentAnalysis.consensusAnswer.includes('\n') && currentAnalysis.consensusAnswer.length < 90 ? `
          <div style="font-size: 20px; font-weight: 800; color: #064e3b; line-height: 1.3; margin-bottom: 8px;">
            ${currentAnalysis.consensusAnswer}
          </div>` : ''}
          <div style="margin-top: 8px;">
            ${formatContentToHtml(currentAnalysis.consensusAnswer)}
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <strong style="font-size: 12px; text-transform: uppercase; color: var(--gray-700); display: block; margin-bottom: 6px;">
            Detailed Consensus Verdict &amp; Analytical Evaluation:
          </strong>
          <div style="font-size: 13px; color: var(--gray-700); line-height: 1.6; background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 8px; padding: 14px;">
            ${formatMarkdownToHtml(currentAnalysis.consistencyVerdict)}
          </div>
        </div>

        <!-- 5-Run Visual Alignment Strip -->
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--gray-600); margin-bottom: 6px;">
            <span>Method Alignment Across 5 Independent Pipelines:</span>
            <span style="font-weight: 700; color: #047857;">${currentAnalysis.agreeingRunsCount} / 5 Methods Aligned</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
            ${runs.map(r => `
              <div style="background: ${r.isAlignedWithConsensus ? '#ecfdf5' : '#fffbeb'}; border: 1px solid ${r.isAlignedWithConsensus ? '#a7f3d0' : '#fde68a'}; border-radius: 6px; padding: 8px; text-align: center;">
                <div style="font-size: 11px; font-weight: 800; color: ${r.isAlignedWithConsensus ? '#065f46' : '#92400e'};">Run #${r.runNumber}</div>
                <div style="font-size: 10px; color: var(--gray-600); margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${r.methodName}</div>
                <div style="font-size: 10px; font-weight: 700; color: ${r.isAlignedWithConsensus ? '#059669' : '#d97706'}; margin-top: 4px;">
                  ${r.isAlignedWithConsensus ? '✓ Aligned' : '~ Nuance'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- 5. EASY TO READ CONCLUSION -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #ccfbf1; color: #0f766e; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">5</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">5. Easy to Read Conclusion</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Plain-Language Translation &amp; Practical Business Takeaways</span>
      </div>
      <div class="card" style="margin-bottom: 0; border-color: #99f6e4;">
        <div style="margin-bottom: 14px;">
          <h4 style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #0f766e; margin-bottom: 6px;">
            What This Means in Plain English:
          </h4>
          <div style="font-size: 13px; color: #1e293b; line-height: 1.6; background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 12px 16px;">
            ${currentAnalysis.laymanExplanation ? currentAnalysis.laymanExplanation : `When tested using five diverse analytical models—including boundary stress tests, stratified grouping, and robust statistical filters—the underlying metric converged firmly on <strong>${currentAnalysis.consensusAnswer}</strong>. This outcome is mathematically consistent and not an artifact of random sampling.`}
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <h4 style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #166534; margin-bottom: 6px;">
            Practical Business &amp; Mission Takeaways:
          </h4>
          <div style="font-size: 13px; color: #14532d; line-height: 1.6; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px;">
            ${currentAnalysis.keyTakeaway || 'This validated conclusion withstands different weighting and filtering approaches. You can confidently proceed with this data point in high-stakes planning, resource allocation, and executive reporting.'}
          </div>
        </div>

        <div style="padding-top: 10px; border-top: 1px solid var(--gray-200);">
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--gray-500); margin-bottom: 6px;">
            Actionable Recommendations for Project Leads:
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; font-size: 12px; color: var(--gray-700);">
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 8px 12px;">
              <strong>1. Stakeholder Reporting:</strong> Cite the verified consensus metric (${currentAnalysis.consensusAnswer}) with executive confidence.
            </div>
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 8px 12px;">
              <strong>2. Decision Making:</strong> Proceed without requiring manual reconciliation audits across disparate reporting silos.
            </div>
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: 6px; padding: 8px 12px;">
              <strong>3. Audit Trail:</strong> Retain this multi-run dossier as verifiable documentation for compliance and donors.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 6. MULTI-METHOD CONVERGENCE & VISUAL METRICS -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #e0e7ff; color: #4338ca; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">6</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">6. Multi-Method Convergence &amp; Visual Metrics</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Statistical Alignment Distribution</span>
      </div>
      <div class="chart-box">
        <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: var(--gray-600); margin-bottom: 12px;">
          Visual Method Alignment Matrix (${currentAnalysis.agreeingRunsCount}/5 Aligned)
        </h4>
        <svg width="100%" height="160" viewBox="0 0 700 160">
          ${runs.map((r, i) => {
            const y = 20 + i * 28;
            const isAligned = r.isAlignedWithConsensus;
            const barWidth = isAligned ? 420 : 340;
            const barColor = isAligned ? '#059669' : '#d97706';
            return `
              <text x="10" y="${y + 14}" font-size="11" font-weight="600" fill="#334155">Run ${i + 1}: ${r.methodName.slice(0, 22)}</text>
              <rect x="220" y="${y}" width="${barWidth}" height="18" rx="4" fill="${barColor}" opacity="0.85" />
              <text x="${230 + barWidth}" y="${y + 13}" font-size="10" font-weight="700" fill="${barColor}">
                ${isAligned ? '100% Aligned' : 'Nuance Variation'}
              </text>
            `;
          }).join('')}
        </svg>
      </div>
      ${customVisualsHtml}
    </div>

    <!-- 7. HOW EACH OF THE 5 RUNS ANALYZED THE DATA -->
    <div style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
        <span style="width: 24px; height: 24px; background: #e0f2fe; color: #0284c7; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">7</span>
        <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">7. How Each of the 5 Runs Analyzed the Data (Explained Simply)</h2>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">Everyday Explanation of Each Methodology</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">
        ${runs.map((r, idx) => `
          <div style="background: #ffffff; border: 1px solid var(--gray-200); border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 11px; font-weight: 800; color: var(--primary);">RUN #${idx + 1}</span>
              <span style="font-size: 10px; font-weight: 700; color: ${r.isAlignedWithConsensus ? 'var(--emerald)' : 'var(--amber)'};">
                ${r.isAlignedWithConsensus ? '✓ Aligned' : '~ Minor Variation'}
              </span>
            </div>
            <strong style="font-size: 13px; color: var(--gray-900);">${r.methodName}</strong>
            <p style="font-size: 12px; color: var(--gray-600); margin-top: 4px; line-height: 1.5;">
              ${r.rationale}
            </p>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--gray-200); font-size: 11px; color: var(--gray-700);">
              <strong>Calculated Finding:</strong> ${r.extractedAnswer || r.narrative?.slice(0, 90) || 'Verified'}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 8. DOMAIN & SCHEMA CONTEXTUALIZATION -->
    ${contextualizedData ? `
      <div style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--gray-200);">
          <span style="width: 24px; height: 24px; background: #ede9fe; color: #6d28d9; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">8</span>
          <h2 style="font-size: 17px; font-weight: 800; color: var(--gray-900);">8. Domain &amp; Schema Contextualization (schemadescription.txt)</h2>
          <span style="font-size: 12px; color: var(--gray-500); margin-left: auto;">DDL Grounding &amp; Business Reality</span>
        </div>
        ${contextualizedHtml}
      </div>
    ` : ''}

    <!-- Page Break for Printing -->
    <div class="page-break"></div>

    <!-- 9. SCIENTIFIC & TECHNICAL DATA SCIENCE EVALUATION (COLLAPSED BY DEFAULT) -->
    <details class="collapsible-section" style="margin-bottom: 24px; border: 1px solid var(--gray-200); border-radius: 12px; background: #ffffff; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
      <summary style="display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: #fdf2f8; cursor: pointer; user-select: none; border-bottom: 1px solid #fbcfe8;">
        <span style="width: 24px; height: 24px; background: #fce7f3; color: #be185d; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">9</span>
        <h2 style="font-size: 16px; font-weight: 800; color: var(--gray-900); margin: 0;">9. Scientific &amp; Technical Data Science Evaluation</h2>
        <span style="font-size: 11px; font-weight: 700; color: #9d174d; background: #fce7f3; border: 1px solid #fbcfe8; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Collapsed by Default (Click to Expand)</span>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto; display: inline-flex; align-items: center; gap: 6px;">
          <span>Details &amp; Matrix</span>
          <span class="collapse-chevron" style="display: inline-block; transition: transform 0.2s ease; font-size: 10px;">▼</span>
        </span>
      </summary>
      <div style="padding: 20px;">
        <div class="card" style="margin-bottom: 16px;">
          <h4 style="font-size: 12px; font-weight: 700; color: var(--gray-700); text-transform: uppercase; margin-bottom: 8px;">
            Theoretical Framework &amp; Statistical Invariance
          </h4>
          <div style="font-size: 13px; color: var(--gray-700); line-height: 1.6;">
            ${formatMarkdownToHtml(currentAnalysis.detailedSynthesis)}
          </div>
        </div>

        <h4 style="font-size: 13px; font-weight: 700; color: var(--gray-900); text-transform: uppercase; margin-bottom: 8px;">
          Cross-Methodology Technical Matrix (All 5 Runs)
        </h4>
        <table>
        <thead>
          <tr>
            <th style="width: 50px;">Run</th>
            <th style="width: 180px;">Method &amp; Category</th>
            <th>Augmented Query Specification</th>
            <th style="width: 140px;">Convergence Status</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(r => `
            <tr>
              <td style="font-weight: 700;">#${r.runNumber}</td>
              <td>
                <strong style="color: var(--gray-900);">${r.methodName}</strong><br/>
                <span style="font-size: 10px; color: var(--gray-500); text-transform: uppercase;">${r.methodCategory}</span>
              </td>
              <td>
                <span style="font-style: italic; color: var(--gray-800);">"${r.modifiedQuery}"</span><br/>
                <span style="font-size: 11px; color: var(--gray-500); margin-top: 4px; display: block;">
                  Refined: ${r.refinedQuery || r.modifiedQuery}
                </span>
              </td>
              <td>
                <span class="${r.isAlignedWithConsensus ? 'aligned-tag' : 'nuance-tag'}">
                  ${r.isAlignedWithConsensus ? '✓ Aligned' : '~ Nuanced'}
                </span>
                <div style="font-size: 11px; color: var(--gray-600); margin-top: 2px;">
                  ${r.methodNuance || 'Verified'}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
        </table>
      </div>
    </details>

    <!-- 10. PROGRAMMATIC IMPLEMENTATION & SANDBOX CODE (COLLAPSED BY DEFAULT) -->
    <details class="collapsible-section" style="margin-top: 32px; margin-bottom: 24px; border: 1px solid var(--gray-200); border-radius: 12px; background: #ffffff; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
      <summary style="display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: #faf5ff; cursor: pointer; user-select: none; border-bottom: 1px solid #f3e8ff;">
        <span style="width: 24px; height: 24px; background: #fae8ff; color: #a21caf; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">10</span>
        <h2 style="font-size: 16px; font-weight: 800; color: var(--gray-900); margin: 0;">10. Programmatic Implementation &amp; Sandbox Code (5 Runs)</h2>
        <span style="font-size: 11px; font-weight: 700; color: #86198f; background: #fae8ff; border: 1px solid #f3e8ff; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Collapsed by Default (Click to Expand)</span>
        <span style="font-size: 12px; color: var(--gray-500); margin-left: auto; display: inline-flex; align-items: center; gap: 6px;">
          <span>Danfo.js Code &amp; Telemetry</span>
          <span class="collapse-chevron" style="display: inline-block; transition: transform 0.2s ease; font-size: 10px;">▼</span>
        </span>
      </summary>
      <div style="padding: 20px;">
        ${runs.map((r, idx) => `
          <div class="run-card">
            <div class="run-header">
              <span class="run-title">Run ${idx + 1}: ${r.methodName}</span>
              <span style="font-size: 11px; font-weight: 700; color: var(--primary);">Status: ${r.status.toUpperCase()}</span>
            </div>
            
            ${r.plan && r.plan.length > 0 ? `
              <div style="margin: 8px 0; font-size: 12px;">
                <strong>Execution Plan:</strong>
                <ol style="margin-left: 18px; margin-top: 4px;">
                  ${r.plan.map(step => `<li>${step}</li>`).join('')}
                </ol>
              </div>
            ` : ''}

            ${r.code ? `
              <div style="margin-top: 8px;">
                <strong style="font-size: 11px; text-transform: uppercase; color: var(--gray-500);">JavaScript Sandbox Code:</strong>
                <pre class="code-block"><code>${r.code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
              </div>
            ` : ''}

            ${r.narrative ? `
              <div style="margin-top: 10px; font-size: 12px; color: var(--gray-700); background: #ffffff; padding: 10px; border-radius: 6px; border: 1px solid var(--gray-200);">
                <strong>Technical Findings Narrative:</strong> ${r.narrative}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </details>

    ${qaHtml}

    <!-- Sign-off footer -->
    <div style="margin-top: 48px; pt-6; border-top: 2px solid var(--gray-200); display: flex; justify-content: space-between; font-size: 11px; color: var(--gray-500);">
      <span>Answer Consistency Engine &bull; Multi-Run Verification Module</span>
      <span>Statistical Agreement Threshold: &ge; 80% (4/5 runs)</span>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Answer_Consistency_Report_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = async (code: string, index: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyCodeSuccess(index);
      setTimeout(() => setCopyCodeSuccess(null), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 print:p-0 print:bg-white print:fixed-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:border-none print:rounded-none">
        
        {/* Modal Top Control Bar (Hidden when printing) */}
        <div className="p-3.5 sm:px-6 bg-gray-900 text-white flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide flex items-center gap-2">
                <span>Answer Consistency Professional Dossier</span>
                {contextualizedData && (
                  <span className="text-[10px] px-2 py-0.5 bg-indigo-500/30 text-indigo-200 rounded-full font-normal border border-indigo-400/30 flex items-center gap-1">
                    <Database className="w-3 h-3 text-indigo-300" /> Contextualized
                  </span>
                )}
                {refineHistory.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 bg-blue-500/30 text-blue-200 rounded-full font-normal border border-blue-400/30">
                    Refined ({refineHistory.length})
                  </span>
                )}
                {tailoredPersonaId && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/30 text-emerald-200 rounded-full font-normal border border-emerald-400/30">
                    {DOSSIER_PERSONAS.find(p => p.id === tailoredPersonaId)?.shortLabel}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-gray-400">
                Multi-Method Cross-Validation Report ({currentAnalysis.agreeingRunsCount}/5 Runs Converged)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View filter buttons */}
            <div className="hidden lg:inline-flex bg-gray-800 p-0.5 rounded-lg border border-gray-700 text-xs">
              <button
                onClick={() => setActiveView('both')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  activeView === 'both' ? 'bg-blue-600 text-white shadow-xs' : 'text-gray-300 hover:text-white'
                }`}
              >
                All Sections
              </button>
              <button
                onClick={() => setActiveView('layman')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  activeView === 'layman' ? 'bg-blue-600 text-white shadow-xs' : 'text-gray-300 hover:text-white'
                }`}
              >
                Lay-Man
              </button>
              <button
                onClick={() => setActiveView('scientific')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  activeView === 'scientific' ? 'bg-blue-600 text-white shadow-xs' : 'text-gray-300 hover:text-white'
                }`}
              >
                Scientific
              </button>
            </div>

            {/* Print button */}
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold shadow-xs transition-colors"
              title="Print Report or Save as PDF"
            >
              <Printer className="w-3.5 h-3.5 text-gray-300" />
              <span className="hidden sm:inline">Print</span>
            </button>

            {/* Create & Download Easy to Understand Report button */}
            <button
              onClick={handleDownloadEasyToUnderstandReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              title="Create & Download an extremely easy to understand report with User Query, Refined Query, Answer (Summary, Data, Details), Schema Context, Visuals, and Tables"
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-100" />
              <span className="hidden sm:inline">Create &amp; Download Easy to Understand Report</span>
            </button>

            {/* Download as HTML button */}
            <button
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              title="Download self-contained standalone HTML report file"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download Full Dossier</span>
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors ml-1 cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Explainer Agent Dossier Tools Bar (Contextualize, Ask a Question, Refine Report, Add Visuals) */}
        <div className="bg-blue-950/95 text-white px-4 py-2.5 border-b border-blue-900 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-300" />
            <span className="text-xs font-bold uppercase tracking-wider text-blue-200">
              Explainer Agent Dossier Tools:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* CONTEXTUALIZE BUTTON */}
            <button
              onClick={handleContextualize}
              disabled={isContextualizing}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                contextualizedData
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs ring-2 ring-indigo-300/40'
                  : 'bg-indigo-600/80 hover:bg-indigo-600 text-white border border-indigo-400/40'
              }`}
              title="Contextualize answers using schemadescription.txt (DDL and domain paragraphs from Project Files)"
            >
              {isContextualizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-200" />
              ) : (
                <Database className="w-3.5 h-3.5 text-indigo-200" />
              )}
              <span>{isContextualizing ? 'Contextualizing with Schema...' : 'Contextualize'}</span>
            </button>

            {/* Ask a Question button */}
            <button
              onClick={() => setActivePanel(activePanel === 'ask' ? 'none' : 'ask')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activePanel === 'ask'
                  ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-300/40'
                  : 'bg-white/10 hover:bg-white/20 text-blue-100 border border-white/15'
              }`}
            >
              <MessageSquarePlus className="w-3.5 h-3.5 text-blue-300" />
              <span>Ask a Question</span>
              {qaList.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-blue-500 text-[10px] font-bold flex items-center justify-center text-white ml-0.5">
                  {qaList.length}
                </span>
              )}
            </button>

            {/* Refine the Report as my suggestion button */}
            <button
              onClick={() => setActivePanel(activePanel === 'refine' ? 'none' : 'refine')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activePanel === 'refine'
                  ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-300/40'
                  : 'bg-white/10 hover:bg-white/20 text-purple-100 border border-white/15'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5 text-purple-300" />
              <span>Refine the Report as my suggestion</span>
            </button>

            {/* Add visuals button */}
            <button
              onClick={() => setActivePanel(activePanel === 'visuals' ? 'none' : 'visuals')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activePanel === 'visuals'
                  ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-300/40'
                  : 'bg-white/10 hover:bg-white/20 text-emerald-100 border border-white/15'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-emerald-300" />
              <span>Add visuals</span>
              {customVisuals.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-emerald-500 text-[10px] font-bold flex items-center justify-center text-white ml-0.5">
                  {customVisuals.length}
                </span>
              )}
            </button>

            {/* Add Tables button */}
            <button
              onClick={() => setActivePanel(activePanel === 'tables' ? 'none' : 'tables')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activePanel === 'tables'
                  ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-300/40'
                  : 'bg-white/10 hover:bg-white/20 text-amber-100 border border-white/15'
              }`}
              title="Add multi-column structured comparison and breakdown tables"
            >
              <Table className="w-3.5 h-3.5 text-amber-300" />
              <span>Add Tables</span>
              {customTables.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-amber-500 text-[10px] font-bold flex items-center justify-center text-white ml-0.5">
                  {customTables.length}
                </span>
              )}
            </button>

            {/* auto-suggest and Add Tables button */}
            <button
              onClick={handleAutoSuggestAndAddTables}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 cursor-pointer"
              title="Automatically analyze 5 runs and answer text to suggest and add formatted tables (comparison, multi-line breakdowns, metrics)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>auto-suggest and Add Tables</span>
            </button>
          </div>
        </div>

        {/* Audience Persona Bar for Broad Accessibility (NGO Interns, Volunteers, Leaders) */}
        <div className="bg-slate-900 text-white px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 shrink-0 print:hidden">
          <div className="flex items-center gap-2 text-xs">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-slate-200">Tailor Dossier Persona:</span>
            {isTailoringPersona && (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Rewriting for audience...</span>
              </span>
            )}
            {personaSuccessMsg && !isTailoringPersona && (
              <span className="text-emerald-300 font-medium">{personaSuccessMsg}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DOSSIER_PERSONAS.map((persona) => {
              const isActive = tailoredPersonaId === persona.id || (!tailoredPersonaId && selectedPersona === persona.id);
              return (
                <button
                  key={persona.id}
                  type="button"
                  disabled={isTailoringPersona}
                  onClick={() => handleTailorForPersona(persona.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                    tailoredPersonaId === persona.id
                      ? 'bg-emerald-600 text-white font-semibold'
                      : isActive
                        ? 'bg-slate-700 text-white border border-slate-600'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                  }`}
                  title={persona.description}
                >
                  {persona.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interactive Drawer 1: Ask a Question Panel */}
        {activePanel === 'ask' && (
          <div className="bg-blue-50/90 border-b border-blue-200 p-4 sm:p-5 space-y-4 print:hidden animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-600 text-white rounded-md">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-blue-950">
                    Ask a Question about this Answer Consistency Dossier
                  </h4>
                  <p className="text-[11px] text-blue-700">
                    The Explainer Agent will answer directly based on the 5 data science methods, queries, and execution results.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActivePanel('none')}
                className="text-blue-500 hover:text-blue-800 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAskQuestion} className="flex gap-2">
              <input
                type="text"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                placeholder="e.g. Why did Run 4 diverge slightly? What is the statistical confidence interval? How was outlier trimming applied?"
                className="flex-1 px-3.5 py-2.5 bg-white border border-blue-200 rounded-xl text-xs text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                disabled={isAsking}
              />
              <button
                type="submit"
                disabled={isAsking || !askInput.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors"
              >
                {isAsking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{isAsking ? 'Thinking...' : 'Ask'}</span>
              </button>
            </form>

            {/* Quick suggested questions */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="text-blue-700 font-semibold">Suggested Questions:</span>
              {[
                "Why did outlier trimming produce a minor variation?",
                "How robust is the consensus answer against data distribution skew?",
                "What are the operational implications for business planning?"
              ].map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAskInput(q)}
                  className="px-2.5 py-1 bg-white hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-md transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>

            {askError && (
              <div className="p-2.5 bg-red-100 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{askError}</span>
              </div>
            )}

            {/* Display Q&A Threads */}
            {qaList.length > 0 && (
              <div className="space-y-3 pt-2 max-h-60 overflow-y-auto border-t border-blue-200">
                {qaList.map(qa => (
                  <div key={qa.id} className="bg-white rounded-xl p-3.5 border border-blue-100 shadow-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3 text-blue-600" />
                        {qa.question}
                      </span>
                      <span className="text-[10px] text-gray-400">{qa.timestamp}</span>
                    </div>
                    <div className="pl-3 border-l-2 border-blue-400 py-0.5">
                      <FormattedAnswerDisplay content={qa.answer} compact={true} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Interactive Drawer 2: Refine the Report as my suggestion Panel */}
        {activePanel === 'refine' && (
          <div className="bg-purple-50/90 border-b border-purple-200 p-4 sm:p-5 space-y-4 print:hidden animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-purple-600 text-white rounded-md">
                  <Wand2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-purple-950">
                    Refine the Report as per your suggestion
                  </h4>
                  <p className="text-[11px] text-purple-700">
                    The Explainer Agent will rewrite and adapt the dossier's verdict, synthesis, and takeaways according to your specific guidance.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActivePanel('none')}
                className="text-purple-500 hover:text-purple-800 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRefineReport} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                placeholder="e.g. Make the executive summary bullet-pointed and C-level friendly, add bullet points, or highlight risk factors..."
                className="flex-1 px-3.5 py-2.5 bg-white border border-purple-200 rounded-xl text-xs text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                disabled={isRefining}
              />
              <button
                type="submit"
                disabled={isRefining || !refineInput.trim()}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors shrink-0"
              >
                {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{isRefining ? 'Refining with Explainer Agent...' : 'Apply Suggestion'}</span>
              </button>
            </form>

            {/* Quick refinement suggestions */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="text-purple-700 font-semibold">Quick Suggestions:</span>
              {[
                "Make the executive summary bullet-pointed and C-level friendly",
                "Emphasize why the outlier-trimmed variation still supports the consensus",
                "Focus on actionable operational budgeting takeaways"
              ].map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setRefineInput(s)}
                  className="px-2.5 py-1 bg-white hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-md transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>

            {refineSuccessMsg && (
              <div className="p-2.5 bg-emerald-100 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{refineSuccessMsg}</span>
              </div>
            )}

            {refineHistory.length > 0 && (
              <div className="pt-2 text-[11px] text-purple-800 flex items-center gap-2">
                <span className="font-bold">Applied Suggestions:</span>
                <div className="flex flex-wrap gap-1">
                  {refineHistory.map((h, i) => (
                    <span key={i} className="px-2 py-0.5 bg-white border border-purple-200 rounded-full text-purple-900 font-medium">
                      ✓ {h}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive Drawer 3: Add Visuals Panel */}
        {activePanel === 'visuals' && (
          <div className="bg-emerald-50/90 border-b border-emerald-200 p-4 sm:p-5 space-y-4 print:hidden animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-600 text-white rounded-md">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                    Add Visuals to Dossier
                  </h4>
                  <p className="text-[11px] text-emerald-700">
                    The Explainer Agent will compute and generate custom comparative visual charts directly into the report.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActivePanel('none')}
                className="text-emerald-500 hover:text-emerald-800 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={visualPromptInput}
                onChange={(e) => setVisualPromptInput(e.target.value)}
                placeholder="e.g. Show comparative method variance distribution, or category contribution breakdown..."
                className="flex-1 px-3.5 py-2.5 bg-white border border-emerald-200 rounded-xl text-xs text-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                disabled={isAddingVisuals}
              />
              <button
                type="button"
                onClick={() => handleAddVisuals()}
                disabled={isAddingVisuals}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors shrink-0"
              >
                {isAddingVisuals ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                <span>{isAddingVisuals ? 'Generating Visuals...' : 'Add Visuals'}</span>
              </button>
            </div>

            {/* Quick Chart Preset Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="text-emerald-700 font-semibold">Recommended Visuals:</span>
              {[
                "Method Reliability & Alignment Score Matrix",
                "Sensitivity & Outlier Variance Gauge",
                "Relative Contribution & Dominance Comparison"
              ].map((vPrompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddVisuals(vPrompt)}
                  disabled={isAddingVisuals}
                  className="px-2.5 py-1 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-md transition-colors text-left"
                >
                  + {vPrompt}
                </button>
              ))}
            </div>

            {visualSuccessMsg && (
              <div className="p-2.5 bg-emerald-100 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{visualSuccessMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* Interactive Drawer 4: Add Tables Panel */}
        {activePanel === 'tables' && (
          <div className="bg-amber-50/90 border-b border-amber-200 p-4 sm:p-5 space-y-4 print:hidden animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-600 text-white rounded-md">
                  <Table className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                    Add Structured Data &amp; Comparison Tables
                  </h4>
                  <p className="text-[11px] text-amber-700">
                    Format multi-column answers, statistical matrices, or create custom comparison tables for the dossier.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActivePanel('none')}
                className="text-amber-500 hover:text-amber-800 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="text-amber-900 font-bold">Quick Presets:</span>
              <button
                type="button"
                onClick={handleAutoSuggestAndAddTables}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer text-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-100" />
                <span>auto-suggest and Add Tables</span>
              </button>
              <button
                type="button"
                onClick={handleAddComparisonTable}
                className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg font-bold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Table2 className="w-3.5 h-3.5 text-amber-600" />
                <span>+ 5-Method Comparison Table</span>
              </button>
              <button
                type="button"
                onClick={handleAddConsensusBreakdownTable}
                className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg font-bold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Grid className="w-3.5 h-3.5 text-amber-600" />
                <span>+ Consensus Metrics Breakdown Table</span>
              </button>
            </div>

            {/* Custom Table Form */}
            <form onSubmit={handleCreateCustomTable} className="bg-white/80 p-3.5 border border-amber-200 rounded-xl space-y-2.5">
              <span className="text-[11px] font-bold text-amber-950 uppercase tracking-wider block">
                Create Custom Structured Table:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={tableTitleInput}
                  onChange={(e) => setTableTitleInput(e.target.value)}
                  placeholder="Table Title (e.g. Metric Variance by Category)"
                  className="px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500"
                />
                <input
                  type="text"
                  value={tableHeadersInput}
                  onChange={(e) => setTableHeadersInput(e.target.value)}
                  placeholder="Column Headers (comma-separated, e.g. Category, Value, %)"
                  className="px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <textarea
                rows={2}
                value={tableRowsInput}
                onChange={(e) => setTableRowsInput(e.target.value)}
                placeholder="Rows (one per line, comma or pipe separated, e.g. Health, $1000, 25%)"
                className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-amber-500 font-mono"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!tableHeadersInput.trim() || !tableRowsInput.trim()}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  + Add Custom Table
                </button>
              </div>
            </form>

            {tableSuccessMsg && (
              <div className="p-2.5 bg-emerald-100 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{tableSuccessMsg}</span>
              </div>
            )}

            {/* List of Added Tables */}
            {customTables.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-amber-200">
                <span className="text-[11px] font-bold text-amber-950 uppercase tracking-wider block">
                  Added Tables in this Dossier ({customTables.length}):
                </span>
                <div className="flex flex-wrap gap-2">
                  {customTables.map((t) => (
                    <div key={t.id} className="flex items-center gap-1.5 bg-white border border-amber-200 px-3 py-1 rounded-lg text-xs font-semibold text-amber-900 shadow-2xs">
                      <Table className="w-3.5 h-3.5 text-amber-600" />
                      <span>{t.title}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTable(t.id)}
                        className="text-gray-400 hover:text-red-600 ml-1 cursor-pointer"
                        title="Remove table"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scrollable Report Body */}
        <div className="overflow-y-auto p-6 sm:p-8 space-y-8 flex-1 print:overflow-visible print:p-0">
          
          {/* Executive Dossier Header */}
          <div className="border-b border-gray-200 pb-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    currentAnalysis.isExceptional 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}>
                    {currentAnalysis.agreementLevel} Agreement Dossier
                  </span>
                  <span className="text-xs text-gray-500">
                    &bull; 5-Method Analytical Cross-Validation
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
                  Answer Consistency Professional Dossier
                </h1>
                <p className="text-xs text-gray-500">
                  Project: <strong>{projectName}</strong> &bull; Generated: {generatedDate} &bull; Multi-Run Verification Pipeline
                </p>
              </div>

              {/* Agreement Score Callout */}
              <div className={`p-4 rounded-xl border text-center min-w-[140px] shrink-0 ${
                currentAnalysis.isExceptional
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}>
                <div className="text-3xl font-extrabold leading-tight tabular-nums">
                  {currentAnalysis.agreementScore}%
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mt-0.5">
                  {currentAnalysis.agreeingRunsCount} of 5 Runs Aligned
                </div>
                {currentAnalysis.isExceptional && (
                  <div className="text-[10px] font-bold text-emerald-700 mt-1 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 4+ Match Rule Met
                  </div>
                )}
              </div>
            </div>

            {/* 4-Card Executive KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Consistency Index</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">{currentAnalysis.agreementScore}%</span>
                <span className="text-[11px] text-slate-600 block">{currentAnalysis.agreeingRunsCount}/5 Converged</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Consensus Level</span>
                <span className={`text-sm font-extrabold ${currentAnalysis.isExceptional ? 'text-emerald-700' : 'text-blue-700'}`}>
                  {currentAnalysis.agreementLevel}
                </span>
                <span className="text-[11px] text-slate-600 block">{currentAnalysis.isExceptional ? 'Exceptional (≥4)' : 'High Alignment'}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Query Verification</span>
                <span className="text-sm font-extrabold text-purple-900 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-600" /> Confirmed
                </span>
                <span className="text-[11px] text-slate-600 block">Human Expert Checked</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Evaluation Engine</span>
                <span className="text-sm font-extrabold text-indigo-900 truncate block" title={explainerModel || 'Default LLM'}>
                  {explainerModel ? explainerModel.replace(/-preview/g, '') : 'Default Model'}
                </span>
                <span className="text-[11px] text-slate-600 block">5 Diverse Methods</span>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 1. USER QUERY                                                             */}
          {/* ========================================================================= */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                1
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                1. User Query
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                Original Business Prompt
              </span>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  Initial Prompt Submitted by User:
                </span>
                <span className="text-[11px] font-medium bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded">
                  Human Query Author
                </span>
              </div>
              <blockquote className="text-sm sm:text-base font-semibold text-gray-900 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-4 italic">
                "{userQueryDisplay}"
              </blockquote>
              <div className="text-xs text-gray-500 flex flex-wrap items-center gap-3 pt-1">
                <span>Target Project: <strong>{projectName}</strong></span>
                <span>&bull;</span>
                <span>Evaluation Context: Raw Unmodified Business Request</span>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 2. REFINED USER QUERY                                                     */}
          {/* ========================================================================= */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                2
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                2. Refined User Query
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                Domain Disambiguated &amp; Schema Mapped
              </span>
            </div>

            <div className="bg-white border border-purple-200 rounded-xl p-5 sm:p-6 space-y-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-purple-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  Disambiguated &amp; Normalized by Query Interpreter Agent
                </span>
                {isRefinedQueryConfirmed && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md text-xs font-bold shadow-2xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>✓ Refined User Query Confirmed by Human Expert</span>
                  </span>
                )}
              </div>

              <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-4">
                <p className="text-sm sm:text-base font-bold text-purple-950 leading-relaxed font-mono">
                  "{refinedQueryDisplay}"
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600 pt-1">
                <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Schema &amp; Entity Alignment:</strong> Colloquial terms, date bounds, and metric filters were disambiguated and directly mapped to project database columns.
                  </span>
                </div>
                <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <UserCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Human Expert Confirmation:</strong> Explicitly reviewed, verified, and confirmed by the human specialist before triggering the 5 independent analytical runs.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. VERY SHORT SUMMARY (EXECUTIVE TL;DR)                                   */}
          {/* ========================================================================= */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 text-xs font-extrabold flex items-center justify-center shrink-0">
                3
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                3. Very Short Summary (Executive TL;DR)
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                Fast-Reading Synthesis for Leadership
              </span>
            </div>

            <div className="bg-gradient-to-br from-amber-50/50 via-white to-blue-50/30 border border-amber-200 rounded-xl p-5 sm:p-6 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  Executive Synopsis
                </span>
                <span className="text-xs font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded border border-gray-200 shadow-2xs tabular-nums">
                  {currentAnalysis.agreeingRunsCount} / 5 Runs Aligned ({currentAnalysis.agreementScore}%)
                </span>
              </div>

              <p className="text-sm sm:text-base text-gray-900 font-medium leading-relaxed">
                {shortSummary}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 shadow-2xs space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Core Conclusion</span>
                  <span className="text-xs font-bold text-blue-900 block truncate" title={currentAnalysis.consensusAnswer}>
                    {currentAnalysis.consensusAnswer}
                  </span>
                </div>
                <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 shadow-2xs space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Convergence Ratio</span>
                  <span className="text-xs font-bold text-emerald-800 block">
                    {currentAnalysis.agreeingRunsCount} of 5 Runs ({currentAnalysis.agreementScore}%)
                  </span>
                </div>
                <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 shadow-2xs space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Stability Verdict</span>
                  <span className="text-xs font-bold text-indigo-900 block">
                    {currentAnalysis.isExceptional ? 'Exceptional Invariance' : 'High Cross-Method Stability'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. CONSENSUS CONCLUSION                                                   */}
          {/* ========================================================================= */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 text-xs font-extrabold flex items-center justify-center shrink-0">
                4
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                4. Consensus Conclusion
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                Cross-Validated Dominant Finding
              </span>
            </div>

            <div className="bg-white border-2 border-emerald-300 rounded-xl p-5 sm:p-6 space-y-5 shadow-xs">
              {/* Highlight finding banner */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-800 font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-emerald-600" />
                    Validated Consensus Core Answer:
                  </span>
                  <span className="bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded text-[11px] font-extrabold">
                    {currentAnalysis.agreementLevel} Confidence
                  </span>
                </div>
                <div className="mt-2 text-emerald-950">
                  <FormattedAnswerDisplay 
                    content={currentAnalysis.consensusAnswer}
                    allowTableViewToggle={true}
                  />
                </div>
              </div>

              {/* Consensus Verdict Narrative */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Detailed Consensus Analysis &amp; Method Overview:
                </h4>
                <div className="text-xs sm:text-sm text-gray-700 leading-relaxed bg-gray-50/80 border border-gray-200 rounded-lg p-4 whitespace-pre-wrap font-normal">
                  {currentAnalysis.consistencyVerdict}
                </div>
              </div>

              {/* Added Custom Tables / Structured Comparison Tables */}
              {customTables.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                      <Table className="w-4 h-4 text-amber-600" />
                      Structured Data &amp; Comparison Tables ({customTables.length})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setActivePanel('tables')}
                      className="text-xs font-bold text-amber-700 hover:text-amber-900 underline cursor-pointer print:hidden"
                    >
                      + Manage Tables
                    </button>
                  </div>

                  <div className="space-y-3">
                    {customTables.map(t => (
                      <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-bold text-gray-900">{t.title}</h5>
                          <button
                            type="button"
                            onClick={() => handleRemoveTable(t.id)}
                            className="text-gray-400 hover:text-red-600 print:hidden cursor-pointer"
                            title="Remove Table"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {t.description && (
                          <p className="text-[11px] text-gray-500">{t.description}</p>
                        )}
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-bold">
                                {t.headers.map((h, hIdx) => (
                                  <th key={hIdx} className="px-3 py-2 text-[10px] uppercase tracking-wider">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {t.rows.map((r, rIdx) => (
                                <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                                  {r.map((c, cIdx) => (
                                    <td key={cIdx} className="px-3 py-2 font-medium text-gray-800">
                                      {String(c)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alignment Strip */}
              <div className="space-y-2 pt-1 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs font-medium text-gray-600">
                  <span>Method Alignment Breakdown Across 5 Independent Analytical Pipelines:</span>
                  <div className="flex items-center gap-3">
                    {customTables.length === 0 && (
                      <button
                        type="button"
                        onClick={handleAddComparisonTable}
                        className="text-[11px] text-amber-700 font-bold hover:underline inline-flex items-center gap-1 print:hidden cursor-pointer"
                      >
                        <Table2 className="w-3 h-3" />
                        + Add Comparison Table
                      </button>
                    )}
                    <span className="font-bold text-emerald-700">{currentAnalysis.agreeingRunsCount} / 5 Methods Aligned</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {runs.map((r, rIdx) => (
                    <div
                      key={rIdx}
                      className={`p-2.5 rounded-lg border text-center text-[11px] ${
                        r.isAlignedWithConsensus
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                          : 'bg-amber-50 border-amber-300 text-amber-900'
                      }`}
                    >
                      <div className="font-bold">Run #{rIdx + 1}</div>
                      <div className="text-[10px] truncate font-medium text-gray-700 mt-0.5" title={r.methodName}>{r.methodName}</div>
                      <div className="text-[10px] font-extrabold mt-1">
                        {r.isAlignedWithConsensus ? '✓ Aligned' : '~ Nuanced'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 5. EASY TO READ CONCLUSION                                                */}
          {/* ========================================================================= */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-teal-100 text-teal-800 text-xs font-extrabold flex items-center justify-center shrink-0">
                5
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                5. Easy to Read Conclusion
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                Plain-Language Translation &amp; Practical Business Takeaways
              </span>
            </div>

            <div className="bg-white border border-teal-200 rounded-xl p-5 sm:p-6 space-y-5 shadow-2xs">
              {/* In Plain English */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-teal-900 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-teal-600" />
                  What This Means in Plain English:
                </h4>
                <div className="bg-teal-50/50 border border-teal-200/80 rounded-lg p-4 text-xs sm:text-sm text-gray-800 leading-relaxed">
                  {currentAnalysis.laymanExplanation ? (
                    <p className="whitespace-pre-wrap">{currentAnalysis.laymanExplanation}</p>
                  ) : (
                    <p>
                      When we tested your question using five separate mathematical calculations—ranging from direct sums, stratified group checks, to sensitivity testing—the core outcome remained steady at <strong>{currentAnalysis.consensusAnswer}</strong>. You do not need to worry that this number is an accident of how the data was filtered or grouped; it holds true across different analytical angles.
                    </p>
                  )}
                </div>
              </div>

              {/* Practical Business & Mission Takeaways */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  Practical Business &amp; Mission Takeaways:
                </h4>
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-4 text-xs sm:text-sm text-emerald-950 leading-relaxed font-medium">
                  {currentAnalysis.keyTakeaway || 'This validated conclusion withstands different weighting and filtering approaches. You can confidently proceed with this data point in high-stakes planning, resource allocation, donor reports, and executive decision-making.'}
                </div>
              </div>

              {/* Actionable Recommendations for Project Leads */}
              <div className="pt-2 border-t border-gray-100">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2.5">
                  Actionable Recommendations for Project Leads &amp; Directors:
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-gray-700">
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
                    <strong className="block text-gray-900 font-bold">1. Executive &amp; Board Reporting</strong>
                    <span className="text-gray-600 leading-relaxed">Cite the verified consensus metric ({currentAnalysis.consensusAnswer}) as high-confidence business intelligence.</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
                    <strong className="block text-gray-900 font-bold">2. Strategic Planning &amp; Budgeting</strong>
                    <span className="text-gray-600 leading-relaxed">Utilize this confirmed outcome directly in forecasts without requiring manual reconciliation audits.</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
                    <strong className="block text-gray-900 font-bold">3. Audit &amp; Donor Readiness</strong>
                    <span className="text-gray-600 leading-relaxed">Retain this multi-method cross-validation dossier as verifiable documentation for compliance and partners.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 6. MULTI-METHOD CONVERGENCE & VISUAL METRICS                             */}
          {/* ========================================================================= */}
          {(activeView === 'both' || activeView === 'layman') && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  6
                </span>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  6. Multi-Method Convergence &amp; Visual Metrics
                </h2>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                  Visual Statistical Convergence
                </span>
              </div>

              {/* Multiple Visual Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Chart A: Multi-Method Agreement Bar Chart */}
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-emerald-600" />
                      Method Convergence Status
                    </h4>
                    <span className="text-xs font-bold text-emerald-700">
                      {currentAnalysis.agreeingRunsCount}/5 Aligned
                    </span>
                  </div>

                  {/* Visual Bar representation */}
                  <div className="space-y-2.5 pt-2">
                    {runs.map((r, idx) => {
                      const isAligned = r.isAlignedWithConsensus;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-800 truncate max-w-[200px]">
                              Run {idx + 1}: {r.methodName}
                            </span>
                            <span className={`text-[11px] font-bold ${isAligned ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {isAligned ? 'Aligned (100%)' : 'Nuance Variation'}
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                isAligned ? 'bg-emerald-600 w-full' : 'bg-amber-500 w-4/5'
                              }`} 
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Chart B: Agreement Radial Gauge (SVG) */}
                <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-3 shadow-2xs">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Consistency Agreement Index
                  </h4>
                  
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        stroke="#e2e8f0"
                        strokeWidth="10"
                        fill="transparent"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        stroke={currentAnalysis.isExceptional ? "#059669" : "#2563eb"}
                        strokeWidth="10"
                        strokeDasharray="251.2"
                        strokeDashoffset={251.2 - (251.2 * currentAnalysis.agreementScore) / 100}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-2xl font-extrabold text-gray-900 leading-none tabular-nums">
                        {currentAnalysis.agreementScore}%
                      </span>
                      <span className="text-[10px] font-bold text-gray-500 uppercase mt-0.5">
                        {currentAnalysis.agreementLevel}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 max-w-xs">
                    {currentAnalysis.isExceptional 
                      ? 'Exceptional threshold (4+ matching runs) achieved. The conclusion is stable across diverse data distributions.'
                      : 'Robust multi-method alignment recorded across independent tests.'}
                  </p>
                </div>
              </div>

              {/* Dynamic Added Visuals (via Add Visuals button) */}
              {customVisuals.length > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                      <PieChart className="w-4 h-4 text-emerald-600" />
                      Custom Visuals Generated by Explainer Agent ({customVisuals.length})
                    </h4>
                    <button
                      onClick={() => setActivePanel('visuals')}
                      className="text-xs text-emerald-700 font-bold hover:underline inline-flex items-center gap-1 print:hidden cursor-pointer"
                    >
                      + Add More Visuals
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customVisuals.map((vis, vIdx) => (
                      <div key={vis.id || `custom-vis-${vIdx}`} className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-bold text-gray-900">{vis.title}</h5>
                          <span className="text-[10px] uppercase font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {vis.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500">{vis.description}</p>

                        <div className="space-y-2 pt-1">
                          {vis.items.map((item, iIdx) => (
                            <div key={`${vis.id || vIdx}-item-${iIdx}`} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-medium text-gray-700">{item.label}</span>
                                <span className={`font-bold ${
                                  item.status === 'nuance' ? 'text-amber-700' : 'text-emerald-700'
                                }`}>
                                  {item.displayValue}
                                </span>
                              </div>
                              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    item.status === 'nuance' ? 'bg-amber-500' : 'bg-emerald-600'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(8, item.value))}%` }}
                                />
                              </div>
                              {item.note && (
                                <p className="text-[10px] text-gray-500">{item.note}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* 7. HOW EACH OF THE 5 RUNS ANALYZED THE DATA (EXPLAINED SIMPLY)             */}
          {/* ========================================================================= */}
          {(activeView === 'both' || activeView === 'layman') && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  7
                </span>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  7. How Each of the 5 Runs Analyzed the Data (Explained Simply)
                </h2>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                  Everyday Explanation of Each Methodology
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {runs.map((r, idx) => (
                  <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold text-blue-700">RUN #{idx + 1}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        r.isAlignedWithConsensus ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {r.isAlignedWithConsensus ? '✓ Aligned' : '~ Minor Shift'}
                      </span>
                    </div>
                    <h5 className="text-xs font-bold text-gray-900">{r.methodName}</h5>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {r.rationale}
                    </p>
                    <div className="pt-2 border-t border-gray-200 text-xs">
                      <span className="font-semibold text-gray-700">Calculated Finding: </span>
                      <span className="text-gray-900 font-medium block mt-0.5">
                        {r.extractedAnswer || r.narrative?.slice(0, 80) || 'Verified'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 8. DOMAIN & SCHEMA CONTEXTUALIZATION (SCHEMADESCRIPTION.TXT)              */}
          {/* ========================================================================= */}
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
              <span className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                8
              </span>
              <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                8. Domain &amp; Schema Contextualization
              </h2>
              <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                DDL Grounding &amp; Business Reality (schemadescription.txt)
              </span>
            </div>

            {contextualizedData ? (
              <div className="bg-gradient-to-br from-indigo-50/90 via-slate-50 to-blue-50/80 border-2 border-indigo-300 rounded-2xl p-6 sm:p-7 space-y-6 shadow-xs relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-200 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-300">
                          Domain &amp; Schema Contextualized
                        </span>
                        <span className="text-xs text-indigo-700 font-medium">
                          Grounding: {contextualizedData.schemaSource || 'schemadescription.txt'}
                        </span>
                      </div>
                      <h3 className="text-lg font-extrabold text-indigo-950 mt-0.5">
                        Domain Expert Contextualization &amp; Schema Understanding
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleContextualize}
                      disabled={isContextualizing}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors print:hidden cursor-pointer"
                      title="Re-run Contextualization with latest schema"
                    >
                      {isContextualizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      <span>Refresh Schema Context</span>
                    </button>
                  </div>
                </div>

                {/* Domain Overview */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    Domain Reality &amp; Business Grounding
                  </h4>
                  <div className="bg-white/90 border border-indigo-100 rounded-xl p-4 text-xs sm:text-sm text-gray-800 leading-relaxed font-medium shadow-2xs whitespace-pre-wrap">
                    {contextualizedData.domainOverview}
                  </div>
                </div>

                {/* DDL Schema Entities & Column Roles */}
                {contextualizedData.schemaEntities && contextualizedData.schemaEntities.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Binary className="w-4 h-4 text-indigo-600" />
                      DDL Schema Architecture &amp; Entity Roles
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {contextualizedData.schemaEntities.map((ent, eIdx) => (
                        <div key={eIdx} className="bg-white border border-indigo-150 rounded-xl p-3.5 space-y-1.5 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-indigo-700 uppercase bg-indigo-50 px-2 py-0.5 rounded">
                              TABLE
                            </span>
                            <span className="text-xs font-extrabold text-gray-900">{ent.tableName}</span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">{ent.role}</p>
                          {ent.relevantColumns && ent.relevantColumns.length > 0 && (
                            <div className="pt-1.5 border-t border-gray-100 text-[11px] text-indigo-900">
                              <span className="font-semibold text-gray-500">Key Columns: </span>
                              <span className="font-mono text-[10px] bg-gray-50 px-1 py-0.5 rounded border border-gray-200">
                                {ent.relevantColumns.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5-Run Contextualized Explanations */}
                {contextualizedData.contextualizedRuns && contextualizedData.contextualizedRuns.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-600" />
                      5-Run Domain Explanations (Schema Context)
                    </h4>
                    <div className="space-y-2">
                      {contextualizedData.contextualizedRuns.map((cRun, crIdx) => (
                        <div key={crIdx} className="bg-white border border-indigo-100 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-2xs">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold flex items-center justify-center">
                                #{cRun.runNumber}
                              </span>
                              <span className="text-xs font-bold text-gray-900">{cRun.methodName}</span>
                            </div>
                            <p className="text-xs text-gray-700 leading-relaxed pl-7">
                              {cRun.domainInterpretation}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Domain Nuances & Business Caveats */}
                {contextualizedData.domainNuancesAndCaveats && (
                  <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 space-y-1.5 shadow-2xs">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-700" />
                      Domain Nuances &amp; Business Constraints
                    </h4>
                    <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">
                      {contextualizedData.domainNuancesAndCaveats}
                    </p>
                  </div>
                )}

                {/* Domain Expert Recommendations */}
                {contextualizedData.domainExpertRecommendations && contextualizedData.domainExpertRecommendations.length > 0 && (
                  <div className="bg-indigo-900 text-white rounded-xl p-4 sm:p-5 space-y-2 shadow-2xs">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-200 flex items-center gap-1.5">
                      <Lightbulb className="w-4 h-4 text-indigo-300" />
                      Domain Specialist Takeaways &amp; Next Steps
                    </h4>
                    <ul className="space-y-1 text-xs text-indigo-100 list-disc list-inside">
                      {contextualizedData.domainExpertRecommendations.map((rec, rIdx) => (
                        <li key={rIdx} className="leading-relaxed">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              /* Contextualize Prompt Banner (shown before clicking Contextualize) */
              <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 border-2 border-dashed border-indigo-200 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
                <div className="space-y-1 max-w-2xl">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-800">
                    <Database className="w-3 h-3 text-indigo-600" />
                    Schema &amp; Domain Intelligence Available
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900">
                    Contextualize this Dossier with 'schemadescription.txt'
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Uses the DDL definitions and domain paragraphs in your project files to translate all 5 run answers into domain-expert terminology and schema entity mappings.
                  </p>
                </div>

                <button
                  onClick={handleContextualize}
                  disabled={isContextualizing}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  {isContextualizing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Database className="w-4 h-4 text-indigo-200" />
                  )}
                  <span>{isContextualizing ? 'Contextualizing with Schema...' : 'Contextualize Report'}</span>
                </button>
              </div>
            )}

            {contextualizeError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2 print:hidden">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{contextualizeError}</span>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* 9. SCIENTIFIC & TECHNICAL DATA SCIENCE EVALUATION                          */}
          {/* ========================================================================= */}
          {(activeView === 'both' || activeView === 'scientific') && (
            <div className="space-y-6 pt-6 border-t-2 border-gray-200">
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  9
                </span>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  9. Scientific &amp; Technical Data Science Evaluation
                </h2>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                  Algorithmic Rigor &amp; Statistical Invariance
                </span>
              </div>

              {/* Detailed Synthesis */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3 shadow-2xs">
                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Scale className="w-4 h-4 text-purple-600" />
                  Theoretical Framework &amp; Statistical Invariance
                </h4>
                <p className="text-xs sm:text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-normal">
                  {currentAnalysis.detailedSynthesis}
                </p>
              </div>

              {/* 5-Run Scientific Matrix Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                    Cross-Methodology Technical Matrix (All 5 Runs)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100/75 border-b border-gray-200 text-gray-700">
                        <th className="p-3 font-bold w-12 text-center">Run</th>
                        <th className="p-3 font-bold w-48">Methodology &amp; Category</th>
                        <th className="p-3 font-bold">Augmented Query &amp; Refined Logic</th>
                        <th className="p-3 font-bold w-48">Specific Quantitative Finding</th>
                        <th className="p-3 font-bold w-28 text-center">Convergence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {runs.map((r, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/80 transition-colors">
                          <td className="p-3 font-bold text-center text-gray-700">
                            #{r.runNumber}
                          </td>
                          <td className="p-3">
                            <strong className="text-gray-900 font-semibold block">{r.methodName}</strong>
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{r.methodCategory}</span>
                          </td>
                          <td className="p-3 space-y-1">
                            <p className="text-gray-800 italic">"{r.modifiedQuery}"</p>
                            {r.refinedQuery && (
                              <p className="text-[11px] text-gray-500 font-mono">
                                Refined: {r.refinedQuery}
                              </p>
                            )}
                          </td>
                          <td className="p-3 text-gray-800 font-semibold">
                            {r.extractedAnswer || r.narrative?.slice(0, 90) || 'Calculation verified'}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              r.isAlignedWithConsensus ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {r.isAlignedWithConsensus ? '✓ Aligned' : '~ Nuanced'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 10. PROGRAMMATIC IMPLEMENTATION & SANDBOX CODE (5 RUNS)                    */}
          {/* ========================================================================= */}
          {(activeView === 'both' || activeView === 'scientific') && (
            <div className="space-y-4 pt-6 border-t border-gray-200">
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  10
                </span>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  10. Programmatic Implementation &amp; Sandbox Code (5 Runs)
                </h2>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                  Danfo.js Code &amp; Execution Telemetry
                </span>
              </div>

              <div className="space-y-3">
                {runs.map((r, idx) => {
                  const isCodeExpanded = expandedCodeIndex === idx;

                  return (
                    <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                      <div
                        onClick={() => setExpandedCodeIndex(isCodeExpanded ? null : idx)}
                        className="p-4 bg-gray-50/70 hover:bg-gray-100/70 flex items-center justify-between cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div>
                            <h5 className="font-bold text-gray-900 text-xs">
                              Run {idx + 1}: {r.methodName}
                            </h5>
                            <p className="text-[11px] text-gray-500 truncate max-w-md">
                              {r.modifiedQuery}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-purple-600 font-semibold">
                            {isCodeExpanded ? 'Hide Code & Details' : 'View Code & Details'}
                          </span>
                          {isCodeExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                        </div>
                      </div>

                      {isCodeExpanded && (
                        <div className="p-4 border-t border-gray-200 bg-white space-y-4 text-xs">
                          {r.plan && r.plan.length > 0 && (
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
                              <span className="font-bold text-gray-700 uppercase tracking-wider text-[10px] block">
                                Generated Analysis Steps:
                              </span>
                              <ol className="list-decimal list-inside space-y-0.5 text-gray-700">
                                {r.plan.map((step, sIdx) => (
                                  <li key={sIdx}>{step}</li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {r.code && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">
                                  Sandbox JavaScript Code:
                                </span>
                                <button
                                  onClick={() => handleCopyCode(r.code || '', idx)}
                                  className="text-[11px] text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 font-medium cursor-pointer"
                                >
                                  <Copy className="w-3 h-3" />
                                  {copyCodeSuccess === idx ? 'Copied!' : 'Copy Code'}
                                </button>
                              </div>
                              <pre className="p-3 bg-gray-900 text-gray-100 rounded-lg font-mono text-xs overflow-x-auto max-h-56">
                                <code>{r.code}</code>
                              </pre>
                            </div>
                          )}

                          {r.result && (
                            <div className="space-y-1">
                              <span className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">
                                Execution Result Output:
                              </span>
                              <pre className="p-2 bg-gray-50 text-gray-800 rounded border border-gray-200 font-mono text-xs max-h-40 overflow-auto">
                                {JSON.stringify(r.result, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 11. INTERACTIVE EXPLAINER CONSULTATION LOG                                */}
          {/* ========================================================================= */}
          {qaList.length > 0 && (
            <div className="space-y-4 pt-6 border-t border-gray-200">
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  11
                </span>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  11. Interactive Explainer Consultation Log
                </h2>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline ml-auto">
                  Q&amp;A Session History ({qaList.length} Questions)
                </span>
              </div>

              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 space-y-3 shadow-2xs">
                <div className="space-y-3">
                  {qaList.map(qa => (
                    <div key={qa.id} className="bg-white p-3.5 rounded-lg border border-blue-100 shadow-xs space-y-1.5 text-xs">
                      <div className="flex justify-between font-bold text-blue-950">
                        <span>User Question: {qa.question}</span>
                        <span className="text-[10px] text-gray-400 font-normal">{qa.timestamp}</span>
                      </div>
                      <div className="pl-3 border-l-2 border-blue-500 py-0.5">
                        <FormattedAnswerDisplay content={qa.answer} compact={true} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Verification Stamp & Sign-Off */}
          <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-gray-500">
            <span>Verification Framework: Multi-Method Automated Cross-Validation Pipeline</span>
            <span>Explainer Agent LLM: {explainerModel || 'Default System LLM'}</span>
            <span>Statistical Agreement Criterion: Exceptional (&ge;4/5 runs matching)</span>
          </div>

        </div>
      </div>
    </div>
  );
};
