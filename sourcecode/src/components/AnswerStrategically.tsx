import React, { useState, useEffect, useRef } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { agents } from '../lib/agents';
import { DataAgentEngine } from '../lib/DataAgentEngine';
import { localDb } from '../lib/localDb';
import {
  DOSSIER_PERSONAS,
  type DossierPersonaId,
  type DossierPersonaConfig
} from '../lib/dossierPersonas';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot } from 'firebase/firestore';
import {
  type CsvFingerprint,
  type CsvCompatibilityReport,
  type StrategicFavouriteBundle,
  loadProjectCsvsWithFingerprints,
  isExactQueryMatch,
  evaluateCsvCompatibility,
  sanitizeForFirestore,
  replayStrategicStepsWithoutAgent,
  downloadStrategicFavouriteJson,
  serializeStrategicFavouriteToJson,
  extractStepMetrics
} from '../lib/strategicFavourites';
import Papa from 'papaparse';
import { 
  Target, 
  Brain, 
  Sparkles, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check, 
  Star, 
  Download, 
  RotateCcw, 
  FileText, 
  ArrowRight, 
  Database,
  Layers,
  Wand2,
  Sliders,
  CheckSquare,
  HelpCircle,
  RefreshCw,
  Edit3,
  Undo2,
  Compass,
  Eye,
  ArrowUpRight,
  Zap,
  FastForward,
  Pause,
  MousePointerClick,
  Navigation,
  CornerDownRight,
  Timer,
  Scale,
  GraduationCap,
  Award,
  Binary,
  BookOpen,
  MessageSquare,
  Send,
  Tag,
  Smile,
  Lightbulb,
  BarChart2,
  PieChart,
  TrendingUp,
  LayoutGrid,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  Shield,
  Square,
  X,
  Table,
  Search
} from 'lucide-react';
import { FormattedAnswerDisplay, formatMarkdownToHtml } from './FormattedAnswerDisplay';

export interface StrategicVisualItem {
  id: string;
  title: string;
  chartType: string;
  description: string;
  takeaway: string;
  items: Array<{
    label: string;
    value: number;
    formattedValue?: string;
    color?: string;
    sublabel?: string;
  }>;
}

export interface FramedQuestionItem {
  prompt: string;
  title: string;
  methodology: string;
  columns: string[];
  businessValue: string;
}

export interface ColumnInfoItem {
  name: string;
  type: string;
  description: string;
  relevance: string;
  sampleValues?: string;
  recommendedTechniques?: string;
}

export interface StrategicClarityItem {
  id: string;
  type: 'help_understand' | 'frame_next_question' | 'column_info' | 'add_visuals';
  typeLabel: string;
  query: string;
  response: string;
  timestamp: string;
  visuals?: StrategicVisualItem[];
  framedQuestions?: FramedQuestionItem[];
  columnsInfo?: ColumnInfoItem[];
}

export type CustomReportSectionId =
  | 'header_metadata'
  | 'kpi_grid'
  | 'verdict'
  | 'clarity_log'
  | 'visuals'
  | 'recommendations'
  | 'timeline'
  | 'column_bank'
  | 'risks';

export interface CustomReportSectionItem {
  id: CustomReportSectionId;
  label: string;
  shortDesc: string;
  badge?: string;
  iconName: string;
  enabled: boolean;
}

export const DEFAULT_CUSTOM_SECTIONS: CustomReportSectionItem[] = [
  {
    id: 'header_metadata',
    label: 'Header & Audience Comprehension Metadata',
    shortDesc: 'Top badges, confidence score, primary question block, and audience note',
    iconName: 'Target',
    enabled: true
  },
  {
    id: 'kpi_grid',
    label: 'Executive KPI Metrics Summary',
    shortDesc: 'Metrics grid (Confidence, Steps Completed, Framework, Dataset Columns)',
    iconName: 'Award',
    enabled: true
  },
  {
    id: 'verdict',
    label: '1. Strategic Verdict & Easy-to-Understand Takeaways',
    shortDesc: 'Core verdict finding and executive summary tailored to audience',
    iconName: 'CheckCircle2',
    enabled: true
  },
  {
    id: 'clarity_log',
    label: '5. Strategic Clarity & Follow-Up Consultation Log',
    shortDesc: 'Post-execution Q&A, framed future queries, and column inspections',
    iconName: 'MessageSquare',
    enabled: true
  },
  {
    id: 'visuals',
    label: '4. Strategic Visualizations & Empirical Charts',
    shortDesc: 'Visual intelligence charts (Bar, Donut, Trend, KPI Scorecards)',
    iconName: 'PieChart',
    enabled: true
  },
  {
    id: 'recommendations',
    label: '3. Guidance & Recommendations on Next Steps (How to Proceed)',
    shortDesc: 'Actionable guidance with plain-language, technical info & next questions',
    iconName: 'Lightbulb',
    enabled: true
  },
  {
    id: 'timeline',
    label: '2. Complete 5-Step Progressive Experiment Timeline & Decisions',
    shortDesc: 'Step-by-step roadmap: questions, choices proposed, trajectory & results',
    iconName: 'Layers',
    enabled: true
  },
  {
    id: 'column_bank',
    label: '6. Project Dataset Column Reference Bank',
    shortDesc: 'Audited dataset column name tags for follow-up testing',
    iconName: 'Tag',
    enabled: true
  },
  {
    id: 'risks',
    label: '7. Risks, Model Constraints & Governance',
    shortDesc: 'Model operational boundaries, distribution shift risks, governance',
    iconName: 'Shield',
    enabled: true
  }
];

export type TargetAudience = DossierPersonaId;
export type TargetAudienceConfig = DossierPersonaConfig;
export const TARGET_AUDIENCES: TargetAudienceConfig[] = DOSSIER_PERSONAS;

export interface StrategicRecommendationItem {
  id: string;
  title: string;
  easyVersion: string; // "Easy to understand version"
  technicalInfo: string; // "Clear technical info"
  columnNames: string[]; // Specific column names from the dataset
  copyPasteableQuestion: string; // Specific prompt ready for cutting and pasting into future questions
}

export interface SimplifiedChoiceItem {
  id: string;
  simpleTitle: string;
  simpleAnalogy: string;
  whatHappensNext: string;
  bestFor: string;
}

export interface SimplifiedChoiceGateData {
  laymanOverview: string;
  simplifiedChoices: SimplifiedChoiceItem[];
}

export interface StrategicSubQuestion {
  stepNumber: number;
  title: string;
  subQuestion: string;
  objective: string;
  plannedMethod: string;
  expectedOutput: string;
  status: 'pending' | 'interpreting' | 'planning' | 'executing' | 'explaining' | 'completed' | 'error';
  result?: any;
  narrative?: string;
  code?: string;
  metrics?: Record<string, any>;
  forwardChoices?: Array<{
    id: string;
    label: string;
    description: string;
    isRecommended: boolean;
    adjustedNextSubQuestion?: string;
  }>;
  selectedChoiceId?: string;
  selectedChoiceLabel?: string;
  userCustomDirection?: string;
  error?: string;
  // Dynamic refinement tracking
  isReplanned?: boolean;
  replanRationale?: string;
  originalSubQuestion?: string;
  originalTitle?: string;
  originalPlannedMethod?: string;
}

export interface StrategicDossierSynthesis {
  executiveSummary: string;
  strategicVerdict: string;
  confidenceScore: number;
  targetAudience?: TargetAudience;
  progressiveEvidence: Array<{
    stepNumber: number;
    stepTitle: string;
    keyFinding: string;
    strategicImpact: string;
  }>;
  strategicRecommendations: string[];
  richRecommendations?: StrategicRecommendationItem[];
  risksAndCaveats: string;
  implementationRoadmap?: string[];
}

const META_PLANNER_PRESETS = {
  custom: {
    label: 'Custom Multi-Step Discovery',
    prompt: `You are an expert Data Science Meta-Planner.
Deconstruct the user's strategic question into exactly 5 progressive, chained experiments where each step empirically tests a hypothesis and produces data that directly guides the subsequent step.`
  },
  ml: {
    label: 'Text-to-ML Workflow (TensorFlow.js / Danfo.js)',
    prompt: `You are a Principal Machine Learning Engineer and Strategic Meta-Planner.
Break down this Text-to-ML question into exactly 5 progressive empirical experiments:
1. Dataset Scoping & Target Variable Definition (inspect missing values, label balance, distributions)
2. Feature Engineering & Correlation Matrix (identify predictive features, normalize, handle categorical data)
3. Train/Test Partitioning & Baseline Benchmark (split 80/20, establish zero-rule / heuristic accuracy baseline)
4. Model Architecture & Training Experiment (train classification/regression model using TensorFlow.js or Danfo.js, compute loss/accuracy)
5. Model Evaluation, Inference & Strategic Translation (evaluate confusion matrix, feature importances, predict on test cohorts, outline operational decision thresholds)`
  },
  strategy: {
    label: 'Strategic Business Analysis & Optimization',
    prompt: `You are a Principal Management Consultant and Data Science Strategist.
Break down this high-level strategic business question into exactly 5 progressive empirical experiments:
1. Baseline Health & Volume Sizing (audit current KPI performance, transaction volumes, and cohort distribution)
2. Driver Decomposition & Root-Cause Attribution (isolate key friction points, churn factors, or revenue leakage)
3. Opportunity Sizing & Segment Prioritization (evaluate customer cohorts, elasticity, and ROI upside)
4. Scenario Simulation & Trade-Off Modeling (model sensitivity across pricing/cost/operational alternatives)
5. Strategic Action Matrix & Rollout Recommendations (synthesize actionable decision rules, risk controls, and timeline)`
  }
};

type ExplorationModeKey = keyof typeof META_PLANNER_PRESETS;

interface GenieQuestionProposal {
  title: string;
  question: string;
  whyInteresting: string;
}

const EXPLORATION_STYLE_GUIDES: Record<ExplorationModeKey, {
  shortTitle: string;
  subtitle: string;
  badgeText?: string;
  gentleRevealHeadline: string;
  whatItBrings: string[];
}> = {
  custom: {
    shortTitle: 'Custom Multi-Step Discovery',
    subtitle: 'Open-ended detective trail for any curiosity',
    badgeText: 'Default',
    gentleRevealHeadline: 'Adapts all 5 steps freely around your exact question—no rigid template required.',
    whatItBrings: [
      'Scans your dataset first to spot surprising patterns and key columns',
      'Lets each discovery steer what the very next step investigates',
      'Combines clear charts, simple explanations, and practical next steps'
    ]
  },
  ml: {
    shortTitle: 'Predict & Classify (Text-to-ML)',
    subtitle: 'Trains a live model to spot what comes next',
    gentleRevealHeadline: 'Uses past patterns in your rows to predict future outcomes or label hidden risks.',
    whatItBrings: [
      'Finds which data clues are strongest at predicting your target',
      'Splits data fairly and trains a real TensorFlow.js / Danfo.js model',
      'Measures accuracy and reveals which factors mattered most'
    ]
  },
  strategy: {
    shortTitle: 'Compare & Optimize (Strategy)',
    subtitle: 'Finds top groups, weak spots & smart moves',
    gentleRevealHeadline: 'Compares segments head-to-head to uncover where value grows or leaks away.',
    whatItBrings: [
      'Measures group totals, averages, and standout winners vs. laggards',
      'Pinpoints bottlenecks or drop-offs dragging down overall results',
      'Simulates "what-if" improvements to rank the highest-impact actions'
    ]
  }
};

export function StrategicVisualCard({ vis }: { vis: StrategicVisualItem }) {
  const chartType = (vis.chartType || 'bar').toLowerCase();

  return (
    <div className="bg-slate-900 rounded-xl p-4 text-white space-y-3 border border-slate-800 shadow-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h5 className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
          {chartType === 'donut' ? <PieChart className="w-3.5 h-3.5 text-amber-400" /> :
           chartType === 'trend' ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> :
           chartType === 'kpi' ? <LayoutGrid className="w-3.5 h-3.5 text-purple-400" /> :
           <BarChart2 className="w-3.5 h-3.5 text-sky-400" />}
          <span>{vis.title}</span>
        </h5>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-sky-950 text-sky-300 px-2 py-0.5 rounded border border-sky-800">
          {chartType} chart
        </span>
      </div>
      <p className="text-[11px] text-slate-400">{vis.description}</p>

      {/* Donut Chart */}
      {chartType === 'donut' && (() => {
        const total = (vis.items || []).reduce((acc, it) => acc + (Number(it.value) || 0), 0) || 100;
        let cumOffset = 0;
        const circumference = 2 * Math.PI * 65; // ~408.4
        return (
          <div className="flex flex-col sm:flex-row items-center justify-around gap-4 py-2">
            <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 160 160" className="w-36 h-36">
                {(vis.items || []).map((it, idx) => {
                  const val = Number(it.value) || 0;
                  const pct = Math.max(0.5, (val / total) * 100);
                  const dash = (pct / 100) * circumference;
                  const offset = - (cumOffset / 100) * circumference;
                  cumOffset += pct;
                  const color = it.color || ['#38bdf8', '#34d399', '#fbbf24', '#c084fc', '#f43f5e', '#06b6d4'][idx % 6];
                  return (
                    <circle
                      key={idx}
                      cx="80"
                      cy="80"
                      r="65"
                      fill="transparent"
                      stroke={color}
                      strokeWidth="20"
                      strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
                      strokeDashoffset={offset.toFixed(2)}
                      transform="rotate(-90 80 80)"
                      className="transition-all duration-500"
                    />
                  );
                })}
                <circle cx="80" cy="80" r="50" className="fill-slate-900" />
                <text x="80" y="74" textAnchor="middle" className="text-[9px] font-bold fill-slate-400 uppercase tracking-wider">
                  Breakdown
                </text>
                <text x="80" y="93" textAnchor="middle" className="text-[14px] font-extrabold fill-white">
                  100%
                </text>
              </svg>
            </div>
            <div className="flex-1 space-y-2 w-full">
              {(vis.items || []).map((it, idx) => {
                const val = Number(it.value) || 0;
                const pct = Math.round((val / total) * 100);
                const color = it.color || ['#38bdf8', '#34d399', '#fbbf24', '#c084fc', '#f43f5e', '#06b6d4'][idx % 6];
                return (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <span className="w-3 h-3 rounded-xs shrink-0 mt-0.5" style={{ backgroundColor: color }} />
                    <div className="flex-1">
                      <div className="flex justify-between font-semibold text-slate-200">
                        <span>{it.label}</span>
                        <span style={{ color }} className="font-bold">{it.formattedValue || `${pct}%`}</span>
                      </div>
                      {it.sublabel && <span className="text-[10px] text-slate-400 block">{it.sublabel}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Trend Chart */}
      {chartType === 'trend' && (() => {
        const items = vis.items || [];
        const n = items.length;
        const vals = items.map(it => Number(it.value) || 0);
        const minVal = vals.length > 0 ? Math.min(...vals) : 0;
        const maxVal = vals.length > 0 ? Math.max(...vals) : 100;
        const range = (maxVal - minVal) || 1;
        const width = 480;
        const height = 140;
        const padX = 40;
        const padY = 25;
        const plotW = width - 2 * padX;
        const plotH = height - 2 * padY;

        const coords = items.map((it, i) => {
          const x = padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
          const y = padY + plotH - (((Number(it.value) || 0) - minVal) / range) * plotH;
          return { x, y, it };
        });

        const pointsStr = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
        const areaStr = `${coords[0]?.x || padX},${height - padY} ${pointsStr} ${coords[coords.length - 1]?.x || (width - padX)},${height - padY}`;

        return (
          <div className="pt-2 overflow-x-auto">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-lg mx-auto h-auto block">
              <defs>
                <linearGradient id={`trendGrad-ui-${vis.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#334155" strokeWidth="1" />
              <polygon points={areaStr} fill={`url(#trendGrad-ui-${vis.id})`} />
              <polyline points={pointsStr} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {coords.map((c, i) => (
                <g key={i}>
                  <circle cx={c.x} cy={c.y} r="5" fill="#0f172a" stroke={c.it.color || '#38bdf8'} strokeWidth="3" />
                  <text x={c.x} y={c.y - 8} textAnchor="middle" className="text-[10px] font-bold fill-sky-200">
                    {c.it.formattedValue || String(c.it.value)}
                  </text>
                  <text x={c.x} y={height - 8} textAnchor="middle" className="text-[10px] font-medium fill-slate-400">
                    {c.it.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        );
      })()}

      {/* KPI Cards Grid */}
      {chartType === 'kpi' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
          {(vis.items || []).map((it, idx) => {
            const color = it.color || ['#38bdf8', '#34d399', '#fbbf24', '#c084fc'][idx % 4];
            return (
              <div key={idx} className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3 space-y-1" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                  {it.label}
                </span>
                <div className="text-lg font-extrabold" style={{ color }}>
                  {it.formattedValue || String(it.value)}
                </div>
                {it.sublabel && (
                  <span className="text-[10px] text-slate-400 block line-clamp-1">{it.sublabel}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bar Chart (Default) */}
      {(chartType === 'bar' || (!['donut', 'trend', 'kpi'].includes(chartType))) && (
        <div className="space-y-2 pt-1">
          {(vis.items || []).map((it, itIdx) => (
            <div key={itIdx} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">{it.label}</span>
                <span className="font-bold text-white" style={{ color: it.color || '#38bdf8' }}>
                  {it.formattedValue || `${it.value}%`}
                </span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, it.value))}%`,
                    backgroundColor: it.color || '#38bdf8'
                  }}
                />
              </div>
              {it.sublabel && (
                <span className="text-[10px] text-slate-500 block">{it.sublabel}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {vis.takeaway && (
        <div className="p-2.5 bg-emerald-950/60 border border-emerald-800 rounded-lg text-[11px] text-emerald-300">
          <span className="font-bold">💡 Strategic Takeaway: </span>
          <span>{vis.takeaway}</span>
        </div>
      )}
    </div>
  );
}

export interface AnswerStrategicallyProps {
  onFeedToAnswerConsistency?: (feedData: {
    question: string;
    guidance: string;
    source?: 'strategic_dossier';
  }) => void;
  initialLaunchFavourite?: {
    fav: StrategicFavouriteBundle;
    autoRunWithoutAgent?: boolean;
  } | null;
  onClearInitialLaunchFavourite?: () => void;
}

export const AnswerStrategically: React.FC<AnswerStrategicallyProps> = ({
  onFeedToAnswerConsistency,
  initialLaunchFavourite,
  onClearInitialLaunchFavourite
}) => {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const { models } = useSettings();

  // Primary Inputs (Default: Custom Multi-Step Discovery)
  const [strategicQuestion, setStrategicQuestion] = useState('');
  const [presetKey, setPresetKey] = useState<'ml' | 'strategy' | 'custom'>('custom');
  const [metaPlannerPrompt, setMetaPlannerPrompt] = useState(META_PLANNER_PRESETS.custom.prompt);
  const [userGuidance, setUserGuidance] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Data Loading & Dual SHA-256 Fingerprints
  const [datasets, setDatasets] = useState<Record<string, any[]>>({});
  const [csvFingerprints, setCsvFingerprints] = useState<CsvFingerprint[]>([]);
  const [dataLoadStatus, setDataLoadStatus] = useState<{ loading: boolean; rows: number; error?: string }>({
    loading: true,
    rows: 0
  });

  // Multi-step Planning State
  const [isPlanning, setIsPlanning] = useState(false);
  const [metaPlanOverview, setMetaPlanOverview] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<string>('Custom Discovery');
  const [subQuestions, setSubQuestions] = useState<StrategicSubQuestion[]>([]);
  const [isPlanReady, setIsPlanReady] = useState(false);

  // Step Execution & Forward-Path Steering
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [isStepRunning, setIsStepRunning] = useState(false);
  const [stepLogs, setStepLogs] = useState<string[]>([]);
  const [waitingForForwardChoice, setWaitingForForwardChoice] = useState<number | null>(null);
  const [selectedForwardChoiceId, setSelectedForwardChoiceId] = useState<string>('');
  const [customForwardDirection, setCustomForwardDirection] = useState<string>('');
  const [isGeneratingChoices, setIsGeneratingChoices] = useState(false);
  const [simplifiedChoicesMap, setSimplifiedChoicesMap] = useState<Record<number, SimplifiedChoiceGateData>>({});
  const [isSimplifyingStep, setIsSimplifyingStep] = useState<number | null>(null);
  const [showSimpleChoices, setShowSimpleChoices] = useState<boolean>(true);

  // Dynamic Refinement & Re-Planning (Human-in-the-Loop)
  const [isReplanning, setIsReplanning] = useState(false);
  const [replanScope, setReplanScope] = useState<'next_only' | 'all_remaining'>('next_only');
  const [customRefinementInstructions, setCustomRefinementInstructions] = useState('');
  const [showRefinementEditor, setShowRefinementEditor] = useState(false);
  const [autoReplanOnAdvance, setAutoReplanOnAdvance] = useState(true);
  const [replanPreview, setReplanPreview] = useState<{
    targetStepIndex: number;
    replannedNextStep: {
      stepNumber: number;
      title: string;
      subQuestion: string;
      objective: string;
      plannedMethod: string;
      expectedOutput: string;
    };
    replannedFutureSteps?: Array<{
      stepNumber: number;
      title: string;
      subQuestion: string;
      objective: string;
      plannedMethod: string;
      expectedOutput: string;
    }>;
    refinementRationale: string;
  } | null>(null);
  const [isEditingPreviewQuestion, setIsEditingPreviewQuestion] = useState(false);

  // Auto-click & Auto-progress State (Default: checked/enabled)
  const [autoProgress, setAutoProgress] = useState(true);
  const [autoProgressCountdown, setAutoProgressCountdown] = useState<number | null>(null);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const confirmForwardChoiceRef = useRef<((applyDynamicReplan?: boolean) => Promise<void>) | null>(null);

  // Final Dossier Synthesis
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [finalDossier, setFinalDossier] = useState<StrategicDossierSynthesis | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [favSaved, setFavSaved] = useState(false);
  const [isSavingFav, setIsSavingFav] = useState(false);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);
  const [feedSuccess, setFeedSuccess] = useState(false);

  // Target Audience Selection (Default: Extremely Easy to understand for School Student volunteer)
  const [targetAudience, setTargetAudience] = useState<TargetAudience>('school_student');
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copiedColumnName, setCopiedColumnName] = useState<string | null>(null);
  const [showColumnReferenceBank, setShowColumnReferenceBank] = useState(false);

  const currentAudienceConfig = TARGET_AUDIENCES.find(a => a.id === targetAudience) || TARGET_AUDIENCES[0];

  // Strategic Clarity, Follow-Up Questions & Report Studio State
  const [clarityItems, setClarityItems] = useState<StrategicClarityItem[]>([]);
  const [isClarityModalOpen, setIsClarityModalOpen] = useState(false);
  const [activeClarityTab, setActiveClarityTab] = useState<'help_understand' | 'frame_next_question' | 'column_info' | 'add_visuals'>('help_understand');
  const [helpUnderstandInput, setHelpUnderstandInput] = useState('');
  const [frameNextInput, setFrameNextInput] = useState('');
  const [columnInfoInput, setColumnInfoInput] = useState('');
  const [visualsInput, setVisualsInput] = useState('');
  const [selectedChartTypePreference, setSelectedChartTypePreference] = useState<'auto' | 'bar' | 'donut' | 'trend' | 'kpi'>('auto');
  const [isClarityLoading, setIsClarityLoading] = useState(false);
  const [clarityError, setClarityError] = useState<string | null>(null);
  const [claritySuccess, setClaritySuccess] = useState<string | null>(null);

  // Custom HTML Report Configuration & Modal State
  const [isCustomReportModalOpen, setIsCustomReportModalOpen] = useState(false);
  const [customSections, setCustomSections] = useState<CustomReportSectionItem[]>(DEFAULT_CUSTOM_SECTIONS);
  const [customFilename, setCustomFilename] = useState('');
  const [startExpandedInCustomReport, setStartExpandedInCustomReport] = useState(false);
  const [customReportSuccess, setCustomReportSuccess] = useState<string | null>(null);
  const [reportPersona, setReportPersona] = useState<TargetAudience>('school_student');
  const [isPreparingHtmlReport, setIsPreparingHtmlReport] = useState(false);
  const [dossierByPersonaCache, setDossierByPersonaCache] = useState<Partial<Record<TargetAudience, StrategicDossierSynthesis>>>({});

  // Progressive disclosure UI state for non-geek 10th-grader friendly layout
  const [showStepLogsMap, setShowStepLogsMap] = useState<Record<number, boolean>>({});
  const [showTechNextStepsMap, setShowTechNextStepsMap] = useState<Record<string, boolean>>({});
  const [showTechnicalChoiceTerms, setShowTechnicalChoiceTerms] = useState(false);

  // Gentle-reveal Exploration Style & Question Genie state
  const [showStyleReveal, setShowStyleReveal] = useState(false);
  const [isGeneratingGenieQuestions, setIsGeneratingGenieQuestions] = useState(false);
  const [genieError, setGenieError] = useState<string | null>(null);
  const [genieSuggestionsByMode, setGenieSuggestionsByMode] = useState<Record<ExplorationModeKey, GenieQuestionProposal[]>>({
    custom: [],
    ml: [],
    strategy: []
  });

  // Saved Strategic Favourites, Auto-Match & Zero-Agentic Replay State
  const [savedFavourites, setSavedFavourites] = useState<StrategicFavouriteBundle[]>([]);
  const [showSavedFavBrowser, setShowSavedFavBrowser] = useState(false);
  const [favSearchText, setFavSearchText] = useState('');
  const [isSemanticSearchingFavs, setIsSemanticSearchingFavs] = useState(false);
  const [semanticFavScores, setSemanticFavScores] = useState<Record<string, number>>({});
  const [inspectingFavJson, setInspectingFavJson] = useState<StrategicFavouriteBundle | null>(null);
  const [jsonCopySuccess, setJsonCopySuccess] = useState(false);
  const [pendingMatchedFav, setPendingMatchedFav] = useState<{
    fav: StrategicFavouriteBundle;
    matchType: 'exact' | 'similar';
    compatibility: CsvCompatibilityReport;
    score?: number;
  } | null>(null);
  const [replayNotice, setReplayNotice] = useState<{
    type: 'cached' | 'direct_rerun';
    message: string;
    savedTimestamp?: string;
    compatibility?: CsvCompatibilityReport;
  } | null>(null);
  const [isDirectReplaying, setIsDirectReplaying] = useState(false);

  // Helper to extract unique dataset column names
  const getAvailableColumns = (): string[] => {
    const cols = new Set<string>();
    Object.values(datasets).forEach((rows: any[]) => {
      if (rows && rows.length > 0) {
        Object.keys(rows[0] || {}).forEach(k => {
          if (k && !k.startsWith('__')) cols.add(k);
        });
      }
    });
    return Array.from(cols);
  };

  // Fallback generator for Layman Simple Choices
  const generateFallbackSimpleChoices = (
    choices: Array<{ id: string; label: string; description: string; isRecommended?: boolean }>,
    stepNumber: number
  ): SimplifiedChoiceGateData => {
    return {
      laymanOverview: `Think of Step ${stepNumber} like reaching a fork in the road on a science quest. The options below let you steer which way we explore next — in simple, everyday words!`,
      simplifiedChoices: choices.map((c, i) => {
        const text = `${c.label} ${c.description}`.toLowerCase();
        let simpleTitle = c.label;
        let simpleAnalogy = 'Like keeping the main proven recipe in the kitchen.';
        let whatHappensNext = 'We continue forward using the discoveries made so far.';
        let bestFor = 'Recommended if you want a balanced, direct path forward.';

        if (c.isRecommended || i === 0 || text.includes('default') || text.includes('baseline')) {
          simpleTitle = `Keep moving forward on the main track (${c.label})`;
          simpleAnalogy = 'Like sticking with the main recipe that everyone enjoyed so far, without changing too many spices.';
          whatHappensNext = 'The next experiment tests this model directly on test samples.';
          bestFor = 'Best for staying on course with the highest confidence.';
        } else if (text.includes('feature') || text.includes('deepen') || text.includes('cohort') || text.includes('segment')) {
          simpleTitle = `Zoom in on the strongest clues (${c.label})`;
          simpleAnalogy = 'Like a detective focusing specifically on the clearest fingerprint found at the scene.';
          whatHappensNext = 'The next experiment digs deeper into only the top-performing features or user groups.';
          bestFor = 'Best if you want to find the exact root cause or maximum performance.';
        } else if (text.includes('conservative') || text.includes('boundary') || text.includes('risk') || text.includes('regulariz')) {
          simpleTitle = `Play it safe & prevent surprises (${c.label})`;
          simpleAnalogy = 'Like putting training wheels or safety rails on a bicycle so you never fall over on bumps.';
          whatHappensNext = 'The next experiment applies strict safeguards and guards against weird extreme values.';
          bestFor = 'Best when preventing errors or handling noisy unpredictability is priority #1.';
        } else {
          simpleTitle = `Explore alternative angle: ${c.label}`;
          simpleAnalogy = 'Like trying an alternate scenic trail to see if there is an even faster shortcut.';
          whatHappensNext = 'The next experiment pivots slightly to test this alternative approach.';
          bestFor = 'Best if you are curious to explore variations beyond the default path.';
        }

        return {
          id: c.id,
          simpleTitle,
          simpleAnalogy,
          whatHappensNext,
          bestFor
        };
      })
    };
  };

  // Handler for 'Explain in Simple Intuitive Easy to understand way'
  const handleExplainInSimpleWay = async (stepIndex: number) => {
    const subQ = subQuestions[stepIndex];
    if (!subQ || !subQ.forwardChoices || subQ.forwardChoices.length === 0) return;

    // If already generated for this step, toggle visibility
    if (simplifiedChoicesMap[subQ.stepNumber]) {
      setShowSimpleChoices(prev => !prev);
      return;
    }

    // Set fallback immediately so user gets instant intuitive explanations
    const immediateFallback = generateFallbackSimpleChoices(subQ.forwardChoices, subQ.stepNumber);
    setSimplifiedChoicesMap(prev => ({
      ...prev,
      [subQ.stepNumber]: immediateFallback
    }));
    setShowSimpleChoices(true);

    setIsSimplifyingStep(subQ.stepNumber);
    try {
      const res = await agents.simplifyChoicesForLayman(
        subQ.stepNumber,
        subQ.title,
        subQ.narrative || subQ.subQuestion,
        subQ.forwardChoices,
        models.planner || models.explainer
      );

      if (res && res.simplifiedChoices && res.simplifiedChoices.length > 0) {
        setSimplifiedChoicesMap(prev => ({
          ...prev,
          [subQ.stepNumber]: {
            laymanOverview: res.laymanOverview || immediateFallback.laymanOverview,
            simplifiedChoices: res.simplifiedChoices
          }
        }));
      }
    } catch (err) {
      console.warn('AI Simplification returned error, using intuitive fallback:', err);
    } finally {
      setIsSimplifyingStep(null);
    }
  };

  // Load project CSV datasets and compute dual SHA-256 fingerprints
  useEffect(() => {
    const loadData = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) {
        setDatasets({});
        setCsvFingerprints([]);
        setDataLoadStatus({ loading: false, rows: 0, error: 'No data files found in project.' });
        return;
      }
      const csvFiles = currentProject.dataFiles.filter(f => f.name.toLowerCase().endsWith('.csv'));
      if (csvFiles.length === 0) {
        setDatasets({});
        setCsvFingerprints([]);
        setDataLoadStatus({ loading: false, rows: 0, error: 'No CSV files available.' });
        return;
      }

      setDataLoadStatus({ loading: true, rows: 0 });
      try {
        const { datasets: loaded, fingerprints, totalRows } = await loadProjectCsvsWithFingerprints(currentProject);

        if (Object.keys(loaded).length > 0) {
          setDatasets(loaded);
          setCsvFingerprints(fingerprints);
          setDataLoadStatus({ loading: false, rows: totalRows });
        } else {
          setDatasets({});
          setCsvFingerprints([]);
          setDataLoadStatus({ loading: false, rows: 0, error: 'No valid rows found in CSV files.' });
        }
      } catch (err: any) {
        console.error('Error loading CSV files in AnswerStrategically:', err);
        setDataLoadStatus({ loading: false, rows: 0, error: err.message || 'Failed to load data.' });
      }
    };

    loadData();
  }, [currentProject]);

  // Subscribe to Saved Strategic Favourites in Firestore for this project/user
  useEffect(() => {
    if (!user || !currentProject) {
      setSavedFavourites([]);
      return;
    }

    const q = query(
      collection(db, 'favourites'),
      where('projectId', '==', currentProject.projectId),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: StrategicFavouriteBundle[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (
            data.favouriteType === 'strategic_dossier' ||
            (Array.isArray(data.strategicSteps) && data.strategicSteps.length > 0)
          ) {
            list.push({ id: docSnap.id, ...data } as StrategicFavouriteBundle);
          }
        });
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSavedFavourites(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'favourites');
      }
    );

    return () => unsubscribe();
  }, [user, currentProject]);

  // Load project schema description
  const getSchemaDescription = async (): Promise<string> => {
    let schema = currentProject?.schemaDescription || '';
    if (!schema && currentProject?.projectId) {
      try {
        const f = await localDb.files.where({ projectId: currentProject.projectId, name: 'schemadescription.txt' }).first();
        if (f && f.content) {
          schema = f.content instanceof Blob ? await f.content.text() : String(f.content);
        }
      } catch (err) {
        console.warn('Could not read schemadescription.txt:', err);
      }
    }
    return schema || 'Standard tabular CSV dataset with relational columns.';
  };

  // Build instant dataset-aware starter proposals when Genie hasn't been clicked yet or as a resilient fallback
  const buildModeStarterProposals = (mode: ExplorationModeKey): GenieQuestionProposal[] => {
    const cols = getAvailableColumns();
    const c1 = cols[0] || 'key metric';
    const c2 = cols[1] || 'category';
    const c3 = cols[2] || 'activity';

    if (mode === 'ml') {
      return [
        {
          title: 'Predict who might leave soon',
          question: cols.length >= 2
            ? `Build a prediction model using ${c1}, ${c2}, and ${c3} to spot who is most likely to drop off next.`
            : 'Build a prediction model using activity, transaction history, and recency to spot who might leave soon.',
          whyInteresting: 'Shows which early warning signals predict drop-offs before they happen.'
        },
        {
          title: 'Forecast the next 30 days',
          question: cols.length >= 1
            ? `Train a forecasting model on ${c1} and related clues to predict what the next 30 days look like.`
            : 'Train a regression model to forecast next 30 days volume and highlight unexpected spikes.',
          whyInteresting: 'Gives you a forward-looking estimate instead of only looking at the past.'
        }
      ];
    }

    if (mode === 'strategy') {
      return [
        {
          title: 'Compare top vs. struggling groups',
          question: cols.length >= 2
            ? `Compare groups across ${c2} and ${c1} to find which segment performs best and where we are losing momentum.`
            : 'Compare customer groups to find which ones contribute the most value and which segments need attention.',
          whyInteresting: 'Pinpoints your strongest winners and biggest quick-win improvements.'
        },
        {
          title: 'Find hidden bottlenecks',
          question: cols.length >= 3
            ? `Analyze ${c1}, ${c2}, and ${c3} to discover what slows results down and test what change would help most.`
            : 'Find the biggest friction points across cohorts and recommend high-impact next actions.',
          whyInteresting: 'Turns raw numbers into clear trade-offs and smart next moves.'
        }
      ];
    }

    return [
      {
        title: 'Spot surprising patterns & outliers',
        question: cols.length >= 2
          ? `Explore ${c1}, ${c2}, and ${c3} step by step to uncover the most surprising patterns and what drives them.`
          : 'Explore our dataset step by step to uncover the biggest hidden patterns, surprises, and key drivers.',
        whyInteresting: 'Great starting trail when you want the data to show you what matters most.'
      },
      {
        title: 'Discover what separates top results',
        question: cols.length >= 2
          ? `Compare the highest and lowest performers across ${c1} and ${c2} to see what truly makes the difference.`
          : 'Find out what separates the top-performing records from everyone else in simple terms.',
        whyInteresting: 'Reveals clear, easy-to-explain differences hiding inside everyday rows.'
      }
    ];
  };

  const handleSelectPreset = (key: 'ml' | 'strategy' | 'custom') => {
    setPresetKey(key);
    setMetaPlannerPrompt(META_PLANNER_PRESETS[key].prompt);
    setShowStyleReveal(true);
    setGenieError(null);
  };

  // Interactive Genie ("Do More"): Proposes 3 fresh, interesting questions grounded in loaded dataset columns & rows
  const handleGenieProposeQuestions = async (modeOverride?: ExplorationModeKey) => {
    const mode = modeOverride || presetKey;
    setIsGeneratingGenieQuestions(true);
    setGenieError(null);
    setShowStyleReveal(true);

    try {
      const cols = getAvailableColumns();
      const firstTableRows = Object.values(datasets).find(r => Array.isArray(r) && r.length > 0) || [];
      const schema = await getSchemaDescription();
      const existingForMode = genieSuggestionsByMode[mode] || [];
      const previousQuestions = [
        ...existingForMode.map(p => p.question),
        ...(strategicQuestion.trim() ? [strategicQuestion.trim()] : [])
      ];

      const res = await agents.proposeStrategicQuestions(
        {
          mode,
          modeLabel: EXPLORATION_STYLE_GUIDES[mode].shortTitle,
          schema,
          availableColumns: cols,
          sampleRows: firstTableRows.slice(0, 3),
          audience: currentAudienceConfig.shortLabel,
          previousQuestions
        },
        models.planner || models.explainer
      );

      const proposals: GenieQuestionProposal[] = Array.isArray(res?.proposals) && res.proposals.length > 0
        ? res.proposals.filter((p: any) => p && p.question)
        : buildModeStarterProposals(mode);

      setGenieSuggestionsByMode(prev => ({
        ...prev,
        [mode]: proposals
      }));
    } catch (err: any) {
      console.warn('Question Genie fallback triggered:', err);
      setGenieSuggestionsByMode(prev => ({
        ...prev,
        [mode]: buildModeStarterProposals(mode)
      }));
      setGenieError('Used smart built-in ideas (live Genie had a hiccup — feel free to try again!).');
    } finally {
      setIsGeneratingGenieQuestions(false);
    }
  };

  // Hydrate saved favourite directly from cache (when both Column Names SHA and Data SHA match)
  const hydrateSavedFavouriteAsResult = (
    fav: StrategicFavouriteBundle,
    compatibility?: CsvCompatibilityReport
  ) => {
    const modeKey = (fav.explorationMode === 'ml' || fav.explorationMode === 'strategy' || fav.explorationMode === 'custom')
      ? fav.explorationMode
      : 'custom';
    setPresetKey(modeKey);
    setStrategicQuestion(fav.userQuery);
    setMetaPlanOverview(fav.metaPlanOverview || 'Loaded from saved strategic favourite.');
    setQuestionType(META_PLANNER_PRESETS[modeKey]?.label || 'Saved Strategic Playbook');
    setWaitingForForwardChoice(null);
    setActiveStepIndex(null);
    setPendingMatchedFav(null);

    const hydratedSteps: StrategicSubQuestion[] = (fav.strategicSteps || []).map((s, idx) => ({
      stepNumber: s.stepNumber || idx + 1,
      title: s.title,
      subQuestion: s.subQuestion,
      objective: 'Verified saved step',
      plannedMethod: s.plannedMethod,
      expectedOutput: 'Saved empirical finding',
      status: 'completed',
      code: s.code,
      result: s.result,
      metrics: s.metrics,
      narrative: s.narrative
    }));

    setSubQuestions(hydratedSteps);
    setIsPlanReady(true);

    const personaKey = (['school_student', 'college_graduate', 'ngo_leader', 'data_scientist'].includes(fav.audiencePersona)
      ? fav.audiencePersona
      : targetAudience) as TargetAudience;
    setTargetAudience(personaKey);
    setReportPersona(personaKey);

    const snap = fav.dossierSnapshot || {
      strategicVerdict: fav.narrative || 'Saved Strategic Answer',
      executiveSummary: fav.narrative || '',
      confidenceScore: 90,
      strategicRecommendations: [],
      risksAndCaveats: ''
    };

    setFinalDossier({
      executiveSummary: snap.executiveSummary || '',
      strategicVerdict: snap.strategicVerdict || '',
      confidenceScore: snap.confidenceScore ?? 85,
      targetAudience: personaKey,
      progressiveEvidence: snap.progressiveEvidence || hydratedSteps.map(s => ({
        stepNumber: s.stepNumber,
        stepTitle: s.title,
        keyFinding: s.narrative || 'Completed step',
        strategicImpact: 'Verified against identical CSV data'
      })),
      strategicRecommendations: snap.strategicRecommendations || [],
      risksAndCaveats: snap.risksAndCaveats || '',
      implementationRoadmap: snap.implementationRoadmap || []
    });

    setReplayNotice({
      type: 'cached',
      message: 'Exact query and both CSV SHA-256 hashes (Column Names SHA & Data SHA) match — loaded saved steps and answer immediately without re-running.',
      savedTimestamp: fav.timestamp,
      compatibility
    });
  };

  // Directly re-run saved step JavaScript code on current CSV datasets WITHOUT calling any Agentic workflow
  const runSavedFavouriteDirectlyWithoutAgent = async (
    fav: StrategicFavouriteBundle,
    compatibility?: CsvCompatibilityReport
  ) => {
    if (Object.keys(datasets).length === 0) {
      alert('Datasets are still loading or unavailable. Please wait a moment and try again.');
      return;
    }

    const modeKey = (fav.explorationMode === 'ml' || fav.explorationMode === 'strategy' || fav.explorationMode === 'custom')
      ? fav.explorationMode
      : 'custom';
    setPresetKey(modeKey);
    setStrategicQuestion(fav.userQuery);
    setMetaPlanOverview(fav.metaPlanOverview || 'Direct code replay without Agentic workflow.');
    setQuestionType(`${META_PLANNER_PRESETS[modeKey]?.label || 'Saved Playbook'} (Direct Replay)`);
    setPendingMatchedFav(null);
    setWaitingForForwardChoice(null);
    setFinalDossier(null);
    setIsDirectReplaying(true);

    const initialSteps: StrategicSubQuestion[] = (fav.strategicSteps || []).map((s, idx) => ({
      stepNumber: s.stepNumber || idx + 1,
      title: s.title,
      subQuestion: s.subQuestion,
      objective: 'Direct replay of saved code',
      plannedMethod: s.plannedMethod,
      expectedOutput: 'Fresh metric output on updated CSV rows',
      status: 'pending',
      code: s.code,
      metrics: s.metrics
    }));

    setSubQuestions(initialSteps);
    setIsPlanReady(true);

    try {
      const replaySummary = await replayStrategicStepsWithoutAgent(
        fav.strategicSteps || [],
        datasets,
        (stepNum, status, output) => {
          setActiveStepIndex(stepNum - 1);
          setSubQuestions(prev =>
            prev.map(step => {
              if (step.stepNumber !== stepNum) return step;
              if (status === 'running') {
                return { ...step, status: 'executing', error: undefined };
              }
              if (status === 'completed' && output) {
                const deltaParts = output.metricChanges
                  .slice(0, 4)
                  .map(c => `${c.key}: ${c.currentValue} (was ${c.previousValue}${c.deltaText ? `, ${c.deltaText}` : ''})`);
                const stepNarrative = deltaParts.length > 0
                  ? `Re-ran saved code directly on updated CSV rows (${output.durationMs}ms). Updated metrics: ${deltaParts.join(' · ')}.`
                  : `Re-ran saved code directly on updated CSV rows in ${output.durationMs}ms without Agentic calls.`;
                return {
                  ...step,
                  status: 'completed',
                  result: output.result,
                  metrics: output.metrics,
                  narrative: stepNarrative,
                  error: undefined
                };
              }
              return {
                ...step,
                status: 'error',
                error: output?.error || 'Step code failed during direct replay'
              };
            })
          );
        }
      );

      setActiveStepIndex(null);

      // Build deterministic fresh dossier summary without calling AI agents
      const oldSnap = fav.dossierSnapshot;
      const personaKey = (['school_student', 'college_graduate', 'ngo_leader', 'data_scientist'].includes(fav.audiencePersona)
        ? fav.audiencePersona
        : targetAudience) as TargetAudience;
      setTargetAudience(personaKey);
      setReportPersona(personaKey);

      const deltaRowText = compatibility && compatibility.totalRowDelta !== 0
        ? `${compatibility.totalRowDelta > 0 ? '+' : ''}${compatibility.totalRowDelta.toLocaleString()} rows (${compatibility.totalCurrentRows.toLocaleString()} total rows)`
        : `${dataLoadStatus.rows.toLocaleString()} rows`;

      const evidenceRows = replaySummary.steps.map((s) => {
        const summaryMetrics = s.metricChanges
          .slice(0, 3)
          .map(m => `${m.key}: ${m.currentValue}${m.deltaText ? ` (${m.deltaText})` : ''}`)
          .join(' · ');
        return {
          stepNumber: s.stepNumber,
          stepTitle: s.title,
          keyFinding: s.status === 'completed'
            ? (summaryMetrics || `Completed directly in ${s.durationMs}ms`)
            : `Step errored on new data: ${s.error}`,
          strategicImpact: s.status === 'completed'
            ? `Direct code replay (${deltaRowText}) — no Agentic workflow used`
            : 'Click Re-run with AI if new row values require code adaptation'
        };
      });

      setFinalDossier({
        strategicVerdict: oldSnap?.strategicVerdict
          ? `[Updated Data Replay · ${deltaRowText}] ${oldSnap.strategicVerdict}`
          : `Direct Code Replay Completed Across ${replaySummary.steps.filter(s => s.status === 'completed').length} / ${replaySummary.steps.length} Steps`,
        executiveSummary: `Executed the saved JavaScript code directly on ${deltaRowText} in ${(replaySummary.totalDurationMs / 1000).toFixed(2)}s without invoking the Agentic workflow (Column Names SHA matched).\n\nOriginal baseline context:\n${oldSnap?.executiveSummary || fav.narrative || ''}`,
        confidenceScore: replaySummary.allSucceeded ? (oldSnap?.confidenceScore ?? 90) : 70,
        targetAudience: personaKey,
        progressiveEvidence: evidenceRows,
        strategicRecommendations: oldSnap?.strategicRecommendations || [],
        implementationRoadmap: oldSnap?.implementationRoadmap || [],
        risksAndCaveats: replaySummary.allSucceeded
          ? `All ${replaySummary.steps.length} saved steps ran deterministically on updated CSV data (${deltaRowText}). You can optionally click "Refresh Narrative with AI" below to rewrite prose summaries around the newest figures.`
          : `Step ${replaySummary.failedStepNumber} encountered an error during direct code replay (${replaySummary.errorMessage}). Review the step output or run a fresh AI plan.`
      });

      setReplayNotice({
        type: 'direct_rerun',
        message: `Column Names SHA matched (${deltaRowText}) — re-ran all saved step code directly in ${(replaySummary.totalDurationMs / 1000).toFixed(2)}s without the Agentic workflow.`,
        savedTimestamp: fav.timestamp,
        compatibility
      });
    } finally {
      setIsDirectReplaying(false);
    }
  };

  // Search saved strategic favourites with AI Similarity
  const handleSearchSavedFavsWithAi = async () => {
    const q = favSearchText.trim() || strategicQuestion.trim();
    if (!q || savedFavourites.length === 0) return;
    setIsSemanticSearchingFavs(true);
    try {
      const res = await agents.similaritySearch(
        q,
        savedFavourites,
        models.planner || models.strategyCreator
      );
      const scores: Record<string, number> = {};
      (res?.matches || []).forEach((m: any) => {
        if (m?.id) scores[m.id] = Number(m.score ?? 0.8);
      });
      setSemanticFavScores(scores);
    } catch (err) {
      console.warn('Semantic favourite search failed:', err);
    } finally {
      setIsSemanticSearchingFavs(false);
    }
  };

  // Step 1: "Ask a question" / Meta-Planner decomposes Strategic Question into 5 progressive experiments
  const handleAskQuestion = async (customQuestion?: string, bypassMatchCheck: boolean = false) => {
    let questionToPlan = (customQuestion || strategicQuestion).trim();
    if (!questionToPlan) {
      const cols = getAvailableColumns();
      questionToPlan = cols.length > 0
        ? `How do ${cols.slice(0, 3).join(', ')} impact overall performance and retention trends, and what strategic actions should we prioritize?`
        : 'What key data drivers explain trends and customer retention in our dataset, and how should we take action?';
      setStrategicQuestion(questionToPlan);
    }
    if (!currentProject) return;

    setPendingMatchedFav(null);
    setReplayNotice(null);

    // Pre-check Saved Favourites for exact or semantically similar queries
    if (!bypassMatchCheck && savedFavourites.length > 0) {
      const exactFav = savedFavourites.find(
        (f) => isExactQueryMatch(questionToPlan, f.userQuery) && (f.strategicSteps?.length || 0) > 0
      );

      if (exactFav) {
        const compat = evaluateCsvCompatibility(exactFav.csvFingerprints, csvFingerprints);
        if (compat.status === 'identical_data') {
          hydrateSavedFavouriteAsResult(exactFav, compat);
          return;
        }
        if (compat.status === 'columns_intact_data_changed') {
          // Exact same query + matching Column Names SHA -> safe to re-run saved code as-is without Agentic workflow!
          await runSavedFavouriteDirectlyWithoutAgent(exactFav, compat);
          return;
        }
        // Column Names SHA changed, missing file, or no saved hashes -> ask user cleanly
        setPendingMatchedFav({
          fav: exactFav,
          matchType: 'exact',
          compatibility: compat,
          score: 1
        });
        return;
      }

      // Check semantic similarity across saved strategic favourites
      setIsPlanning(true);
      try {
        const simRes = await agents.similaritySearch(
          questionToPlan,
          savedFavourites,
          models.planner || models.strategyCreator
        );
        const topMatch = (simRes?.matches || []).find((m: any) => Number(m?.score ?? 0) >= 0.72);
        const matchedFav = topMatch
          ? savedFavourites.find((f) => f.id === topMatch.id && (f.strategicSteps?.length || 0) > 0)
          : undefined;
        if (matchedFav) {
          const compat = evaluateCsvCompatibility(matchedFav.csvFingerprints, csvFingerprints);
          setPendingMatchedFav({
            fav: matchedFav,
            matchType: 'similar',
            compatibility: compat,
            score: Number(topMatch.score ?? 0.8)
          });
          setIsPlanning(false);
          return;
        }
      } catch (simErr) {
        console.warn('Pre-plan similarity check skipped:', simErr);
      }
    }

    setIsPlanning(true);
    setIsPlanReady(false);
    setFinalDossier(null);
    setWaitingForForwardChoice(null);
    setActiveStepIndex(null);

    try {
      const schema = await getSchemaDescription();
      const tailoredPrompt = `${metaPlannerPrompt}\n\nTARGET AUDIENCE REQUIREMENT:\n${currentAudienceConfig.instructionPrompt}\nFormulate sub-question titles and objectives so they are intuitive and clear for this audience.`;

      const planRes = await agents.planStrategicSubQuestions(
        questionToPlan,
        schema,
        tailoredPrompt,
        userGuidance,
        models.planner
      );

      setMetaPlanOverview(planRes.metaPlanOverview || '5 progressive experiments designed to resolve the strategic inquiry.');
      setQuestionType(
        planRes.questionType ||
        (presetKey === 'ml' ? 'Text-to-ML' : presetKey === 'custom' ? 'Custom Multi-Step Discovery' : 'Strategic Analysis')
      );

      const initialSubQuestions: StrategicSubQuestion[] = (planRes.subQuestions || []).slice(0, 5).map((q: any, idx: number) => ({
        stepNumber: q.stepNumber || idx + 1,
        title: q.title || `Experiment ${idx + 1}`,
        subQuestion: q.subQuestion || `Analyze empirical dimension ${idx + 1}`,
        objective: q.objective || 'Establish foundational data insight',
        plannedMethod: q.plannedMethod || 'Empirical Statistical Analysis',
        expectedOutput: q.expectedOutput || 'Key data metric and summary',
        status: 'pending'
      }));

      // Ensure exactly 5 sub-questions
      while (initialSubQuestions.length < 5) {
        const idx = initialSubQuestions.length + 1;
        initialSubQuestions.push({
          stepNumber: idx,
          title: `Progressive Experiment ${idx}`,
          subQuestion: `Evaluate strategic metric for phase ${idx}`,
          objective: 'Incremental validation',
          plannedMethod: 'Data Science / ML Analysis',
          expectedOutput: 'Empirical decision finding',
          status: 'pending'
        });
      }

      setSubQuestions(initialSubQuestions);
      setIsPlanReady(true);
    } catch (err: any) {
      console.error('Error planning strategic sub-questions:', err);
      alert('Failed to plan sub-questions: ' + err.message);
    } finally {
      setIsPlanning(false);
    }
  };

  // Launch favourite passed from Saved Queries Runner tab
  useEffect(() => {
    if (!initialLaunchFavourite || dataLoadStatus.loading) return;
    const { fav, autoRunWithoutAgent } = initialLaunchFavourite;
    const compat = evaluateCsvCompatibility(fav.csvFingerprints, csvFingerprints);
    if (autoRunWithoutAgent) {
      if (compat.status === 'identical_data') {
        hydrateSavedFavouriteAsResult(fav, compat);
      } else {
        runSavedFavouriteDirectlyWithoutAgent(fav, compat);
      }
    } else {
      hydrateSavedFavouriteAsResult(fav, compat);
    }
    if (onClearInitialLaunchFavourite) {
      onClearInitialLaunchFavourite();
    }
  }, [initialLaunchFavourite, dataLoadStatus.loading]);

  const handlePlanSubQuestions = async () => {
    await handleAskQuestion();
  };

  // Step 2: Execute a single sub-question experiment using DataAgentEngine in Web Worker
  const runSingleSubQuestion = async (stepIndex: number, currentSubQuestionsList: StrategicSubQuestion[]) => {
    const step = currentSubQuestionsList[stepIndex];
    if (!step || !currentProject) return;

    setActiveStepIndex(stepIndex);
    setIsStepRunning(true);
    setStepLogs([]);

    const schema = await getSchemaDescription();
    const engine = new DataAgentEngine();

    // Update status to interpreting
    setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? { ...s, status: 'interpreting' } : s));

    try {
      // 1. Interpreter
      const interp = await agents.interpretQuery(step.subQuestion, schema, models.queryInterpreter);
      const refinedQuery = interp.refinedQuery || step.subQuestion;

      // 2. Planner for this specific experiment
      setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? { ...s, status: 'planning' } : s));
      const planRes = await agents.planAnalysis(
        refinedQuery, 
        schema, 
        presetKey === 'ml'
          ? 'Text to ML modeling experiment'
          : presetKey === 'custom'
          ? 'Custom Multi-Step Discovery'
          : 'Strategic Data Analysis', 
        models.planner
      );
      const planSteps = planRes.steps || [
        'Inspect dataset columns and types',
        'Extract and preprocess features / target metrics',
        'Execute data science calculation / model experiment',
        'Summarize key outcome'
      ];

      // 3. Code Generation & Sandbox Execution
      setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? { ...s, status: 'executing' } : s));
      let generatedCode = '';
      let executionResult: any = null;
      let errorTelemetry: string | undefined = undefined;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const codeRes = await agents.generateCode(
            refinedQuery,
            schema,
            planSteps,
            errorTelemetry,
            undefined,
            models.codeGenerator
          );
          generatedCode = codeRes.code;

          executionResult = await engine.runAnalysis(
            generatedCode, 
            datasets, 
            (log) => setStepLogs(prev => [...prev.slice(-15), log])
          );
          break;
        } catch (execErr: any) {
          if (attempt === 2) throw execErr;
          errorTelemetry = `Execution error: ${execErr.message}. Ensure Danfo.js (dfd) and TensorFlow.js (tf) API calls are valid.`;
        }
      }

      // 4. Explainer Agent (Tailored to Target Audience)
      setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? { ...s, status: 'explaining' } : s));
      const narrativeRes = await agents.explainResults(
        refinedQuery, 
        executionResult, 
        models.explainer, 
        undefined, 
        currentAudienceConfig.instructionPrompt
      );
      const narrativeText = narrativeRes.text || 'Step experiment completed successfully.';

      // Extract metrics if available
      let extractedMetrics: Record<string, any> = {};
      if (executionResult && typeof executionResult === 'object') {
        if (executionResult.summary) extractedMetrics.summary = executionResult.summary;
        if (executionResult.accuracy) extractedMetrics.accuracy = executionResult.accuracy;
        if (executionResult.metrics) extractedMetrics = { ...extractedMetrics, ...executionResult.metrics };
      }

      // Update completed step
      const completedStep: StrategicSubQuestion = {
        ...step,
        status: 'completed',
        result: executionResult,
        narrative: narrativeText,
        code: generatedCode,
        metrics: extractedMetrics
      };

      const updatedList = currentSubQuestionsList.map((s, idx) => idx === stepIndex ? completedStep : s);
      setSubQuestions(updatedList);

      // Now generate Forward-Path choices if there is a next step
      const nextIndex = stepIndex + 1;
      const nextStep = nextIndex < updatedList.length ? updatedList[nextIndex] : null;

      setIsGeneratingChoices(true);
      const cumulativeContext = updatedList
        .slice(0, stepIndex + 1)
        .map(s => `Step ${s.stepNumber} (${s.title}): ${s.narrative?.slice(0, 150)} [Chosen: ${s.selectedChoiceLabel || 'Baseline'}]`)
        .join('\n');

      const choiceRes = await agents.generateForwardPathChoices(
        {
          stepNumber: step.stepNumber,
          title: step.title,
          subQuestion: step.subQuestion,
          resultSummary: narrativeText,
          extractedMetrics
        },
        nextStep,
        cumulativeContext,
        models.planner
      );

      const generatedChoices = choiceRes.choices && choiceRes.choices.length > 0
        ? choiceRes.choices
        : [
            {
              id: 'choice-1',
              label: 'Proceed with default trajectory',
              description: 'Continue to the next planned experiment with findings from this step.',
              isRecommended: true
            },
            {
              id: 'choice-2',
              label: 'Deepen feature / segment focus',
              description: 'Focus exclusively on the top-performing cohort or feature set discovered.',
              isRecommended: false
            },
            {
              id: 'choice-3',
              label: 'Apply conservative boundary limits',
              description: 'Constrain parameters to mitigate downside risks or outliers.',
              isRecommended: false
            }
          ];

      setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? {
        ...s,
        forwardChoices: generatedChoices
      } : s));

      // Pre-select recommended choice
      const rec = generatedChoices.find((c: any) => c.isRecommended) || generatedChoices[0];
      setSelectedForwardChoiceId(rec?.id || 'choice-1');
      setCustomForwardDirection('');
      setWaitingForForwardChoice(stepIndex);

      // Pre-generate intuitive layman explanation for choices
      const immediateSimp = generateFallbackSimpleChoices(generatedChoices, step.stepNumber);
      setSimplifiedChoicesMap(prev => ({
        ...prev,
        [step.stepNumber]: immediateSimp
      }));

      // Trigger background AI simplification
      agents.simplifyChoicesForLayman(
        step.stepNumber,
        step.title,
        narrativeText || step.subQuestion,
        generatedChoices,
        models.planner || models.explainer
      ).then(res => {
        if (res && res.simplifiedChoices && res.simplifiedChoices.length > 0) {
          setSimplifiedChoicesMap(prev => ({
            ...prev,
            [step.stepNumber]: {
              laymanOverview: res.laymanOverview || immediateSimp.laymanOverview,
              simplifiedChoices: res.simplifiedChoices
            }
          }));
        }
      }).catch(e => console.warn('Background choice simplification error:', e));
    } catch (err: any) {
      console.error(`Sub-question ${stepIndex + 1} execution failed:`, err);
      setSubQuestions(prev => prev.map((s, idx) => idx === stepIndex ? {
        ...s,
        status: 'error',
        error: err.message || 'Execution error in Web Worker'
      } : s));
    } finally {
      setIsStepRunning(false);
      setIsGeneratingChoices(false);
    }
  };

  // Dynamically re-plan next sub-question based on human steering decision
  const handleTriggerDynamicReplan = async (targetCurrentStepIdx?: number) => {
    const currentIdx = targetCurrentStepIdx !== undefined ? targetCurrentStepIdx : waitingForForwardChoice;
    if (currentIdx === null) return;
    const currentStep = subQuestions[currentIdx];
    if (!currentStep) return;

    const nextIdx = currentIdx + 1;
    if (nextIdx >= subQuestions.length) return; // No next step

    const nextStep = subQuestions[nextIdx];
    const chosenOption = (currentStep.forwardChoices || []).find(c => c.id === selectedForwardChoiceId);
    const chosenLabel = customForwardDirection.trim() 
      ? `Custom Steering: ${customForwardDirection.trim()}` 
      : (chosenOption ? chosenOption.label : 'Recommended trajectory');

    const futureSteps = subQuestions.slice(nextIdx + 1).map(s => ({
      stepNumber: s.stepNumber,
      title: s.title,
      subQuestion: s.subQuestion,
      objective: s.objective,
      plannedMethod: s.plannedMethod,
      expectedOutput: s.expectedOutput
    }));

    const completedHistory = subQuestions.slice(0, currentIdx + 1).map(s => ({
      stepNumber: s.stepNumber,
      title: s.title,
      subQuestion: s.subQuestion,
      resultSummary: s.narrative || 'Experiment completed successfully',
      selectedChoiceLabel: s.stepNumber === currentStep.stepNumber ? chosenLabel : s.selectedChoiceLabel,
      userCustomDirection: s.stepNumber === currentStep.stepNumber ? (customForwardDirection.trim() || undefined) : s.userCustomDirection
    }));

    setIsReplanning(true);
    try {
      const schema = await getSchemaDescription();
      const replanRes = await agents.replanStrategicSubQuestion(
        strategicQuestion,
        schema,
        completedHistory,
        {
          stepNumber: nextStep.stepNumber,
          title: nextStep.title,
          subQuestion: nextStep.subQuestion,
          objective: nextStep.objective,
          plannedMethod: nextStep.plannedMethod,
          expectedOutput: nextStep.expectedOutput
        },
        futureSteps,
        {
          choiceLabel: chosenLabel,
          choiceDescription: chosenOption?.description,
          customGuidance: customForwardDirection.trim() || undefined
        },
        replanScope,
        customRefinementInstructions.trim() || undefined,
        models.planner
      );

      if (replanRes.replannedNextStep) {
        setReplanPreview({
          targetStepIndex: nextIdx,
          replannedNextStep: replanRes.replannedNextStep,
          replannedFutureSteps: replanRes.replannedFutureSteps,
          refinementRationale: replanRes.refinementRationale || `Dynamically re-formulated Step ${nextStep.stepNumber} to incorporate steering: "${chosenLabel}".`
        });
        setIsEditingPreviewQuestion(false);
      } else {
        alert('Could not generate dynamic re-plan. Please retry.');
      }
    } catch (err: any) {
      console.error('Error triggering dynamic re-plan:', err);
      alert('Dynamic re-planning failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsReplanning(false);
    }
  };

  // Commit the re-plan preview into active subQuestions state
  const handleAcceptReplanPreview = () => {
    if (!replanPreview) return;
    const { targetStepIndex, replannedNextStep, replannedFutureSteps, refinementRationale } = replanPreview;

    setSubQuestions(prev => prev.map((s, idx) => {
      if (idx === targetStepIndex) {
        return {
          ...s,
          originalTitle: s.originalTitle || s.title,
          originalSubQuestion: s.originalSubQuestion || s.subQuestion,
          originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
          title: replannedNextStep.title || s.title,
          subQuestion: replannedNextStep.subQuestion || s.subQuestion,
          objective: replannedNextStep.objective || s.objective,
          plannedMethod: replannedNextStep.plannedMethod || s.plannedMethod,
          expectedOutput: replannedNextStep.expectedOutput || s.expectedOutput,
          isReplanned: true,
          replanRationale: refinementRationale
        };
      }
      if (replannedFutureSteps && idx > targetStepIndex) {
        const matchingFuture = replannedFutureSteps.find((f: any) => f.stepNumber === s.stepNumber);
        if (matchingFuture) {
          return {
            ...s,
            originalTitle: s.originalTitle || s.title,
            originalSubQuestion: s.originalSubQuestion || s.subQuestion,
            originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
            title: matchingFuture.title || s.title,
            subQuestion: matchingFuture.subQuestion || s.subQuestion,
            objective: matchingFuture.objective || s.objective,
            plannedMethod: matchingFuture.plannedMethod || s.plannedMethod,
            expectedOutput: matchingFuture.expectedOutput || s.expectedOutput,
            isReplanned: true,
            replanRationale: `Cascade-re-planned in alignment with Step ${replannedNextStep.stepNumber}`
          };
        }
      }
      return s;
    }));

    setReplanPreview(null);
  };

  const handleDiscardReplanPreview = () => {
    setReplanPreview(null);
    setIsEditingPreviewQuestion(false);
  };

  // Revert a re-planned step to its original pre-plan
  const handleRevertStep = (stepIdx: number) => {
    setSubQuestions(prev => prev.map((s, idx) => {
      if (idx === stepIdx && s.isReplanned) {
        return {
          ...s,
          title: s.originalTitle || s.title,
          subQuestion: s.originalSubQuestion || s.subQuestion,
          plannedMethod: s.originalPlannedMethod || s.plannedMethod,
          isReplanned: false,
          replanRationale: undefined
        };
      }
      return s;
    }));
  };

  // Human-in-the-Loop confirms forward choice to adjust the subsequent sub-question
  const handleConfirmForwardChoice = async (applyDynamicReplan?: boolean) => {
    if (waitingForForwardChoice === null) return;
    const currentIdx = waitingForForwardChoice;
    const currentStep = subQuestions[currentIdx];
    if (!currentStep) return;

    const chosenOption = (currentStep.forwardChoices || []).find(c => c.id === selectedForwardChoiceId);
    const chosenLabel = customForwardDirection.trim() 
      ? `Custom: ${customForwardDirection.trim()}` 
      : (chosenOption ? chosenOption.label : 'Proceeded with recommendation');

    const nextIdx = currentIdx + 1;
    let listToAdvance = [...subQuestions];

    // If there is a next step, check if we should apply dynamic re-planning
    if (nextIdx < subQuestions.length) {
      if (replanPreview && replanPreview.targetStepIndex === nextIdx) {
        // 1. Commit active replan preview
        const { replannedNextStep, replannedFutureSteps, refinementRationale } = replanPreview;
        listToAdvance = listToAdvance.map((s, idx) => {
          if (idx === nextIdx) {
            return {
              ...s,
              originalTitle: s.originalTitle || s.title,
              originalSubQuestion: s.originalSubQuestion || s.subQuestion,
              originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
              title: replannedNextStep.title || s.title,
              subQuestion: replannedNextStep.subQuestion || s.subQuestion,
              objective: replannedNextStep.objective || s.objective,
              plannedMethod: replannedNextStep.plannedMethod || s.plannedMethod,
              expectedOutput: replannedNextStep.expectedOutput || s.expectedOutput,
              isReplanned: true,
              replanRationale: refinementRationale
            };
          }
          if (replannedFutureSteps && idx > nextIdx) {
            const matchingFuture = replannedFutureSteps.find((f: any) => f.stepNumber === s.stepNumber);
            if (matchingFuture) {
              return {
                ...s,
                originalTitle: s.originalTitle || s.title,
                originalSubQuestion: s.originalSubQuestion || s.subQuestion,
                originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
                title: matchingFuture.title || s.title,
                subQuestion: matchingFuture.subQuestion || s.subQuestion,
                objective: matchingFuture.objective || s.objective,
                plannedMethod: matchingFuture.plannedMethod || s.plannedMethod,
                expectedOutput: matchingFuture.expectedOutput || s.expectedOutput,
                isReplanned: true,
                replanRationale: `Cascade-re-planned in alignment with Step ${replannedNextStep.stepNumber}`
              };
            }
          }
          return s;
        });
      } else if (applyDynamicReplan ?? autoReplanOnAdvance) {
        // 2. Perform on-the-fly dynamic re-planning
        setIsReplanning(true);
        try {
          const schema = await getSchemaDescription();
          const nextStep = subQuestions[nextIdx];
          const futureSteps = subQuestions.slice(nextIdx + 1).map(s => ({
            stepNumber: s.stepNumber,
            title: s.title,
            subQuestion: s.subQuestion,
            objective: s.objective,
            plannedMethod: s.plannedMethod,
            expectedOutput: s.expectedOutput
          }));
          const completedHistory = subQuestions.slice(0, currentIdx + 1).map(s => ({
            stepNumber: s.stepNumber,
            title: s.title,
            subQuestion: s.subQuestion,
            resultSummary: s.narrative || 'Experiment completed successfully',
            selectedChoiceLabel: s.stepNumber === currentStep.stepNumber ? chosenLabel : s.selectedChoiceLabel,
            userCustomDirection: s.stepNumber === currentStep.stepNumber ? (customForwardDirection.trim() || undefined) : s.userCustomDirection
          }));

          const replanRes = await agents.replanStrategicSubQuestion(
            strategicQuestion,
            schema,
            completedHistory,
            {
              stepNumber: nextStep.stepNumber,
              title: nextStep.title,
              subQuestion: nextStep.subQuestion,
              objective: nextStep.objective,
              plannedMethod: nextStep.plannedMethod,
              expectedOutput: nextStep.expectedOutput
            },
            futureSteps,
            {
              choiceLabel: chosenLabel,
              choiceDescription: chosenOption?.description,
              customGuidance: customForwardDirection.trim() || undefined
            },
            replanScope,
            customRefinementInstructions.trim() || undefined,
            models.planner
          );

          if (replanRes.replannedNextStep) {
            listToAdvance = listToAdvance.map((s, idx) => {
              if (idx === nextIdx) {
                return {
                  ...s,
                  originalTitle: s.originalTitle || s.title,
                  originalSubQuestion: s.originalSubQuestion || s.subQuestion,
                  originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
                  title: replanRes.replannedNextStep.title || s.title,
                  subQuestion: replanRes.replannedNextStep.subQuestion || s.subQuestion,
                  objective: replanRes.replannedNextStep.objective || s.objective,
                  plannedMethod: replanRes.replannedNextStep.plannedMethod || s.plannedMethod,
                  expectedOutput: replanRes.replannedNextStep.expectedOutput || s.expectedOutput,
                  isReplanned: true,
                  replanRationale: replanRes.refinementRationale || `Dynamically re-formulated to follow: ${chosenLabel}`
                };
              }
              if (replanRes.replannedFutureSteps && idx > nextIdx) {
                const match = replanRes.replannedFutureSteps.find((f: any) => f.stepNumber === s.stepNumber);
                if (match) {
                  return {
                    ...s,
                    originalTitle: s.originalTitle || s.title,
                    originalSubQuestion: s.originalSubQuestion || s.subQuestion,
                    originalPlannedMethod: s.originalPlannedMethod || s.plannedMethod,
                    title: match.title || s.title,
                    subQuestion: match.subQuestion || s.subQuestion,
                    objective: match.objective || s.objective,
                    plannedMethod: match.plannedMethod || s.plannedMethod,
                    expectedOutput: match.expectedOutput || s.expectedOutput,
                    isReplanned: true,
                    replanRationale: `Cascade-re-planned in alignment with Step ${replanRes.replannedNextStep.stepNumber}`
                  };
                }
              }
              return s;
            });
          }
        } catch (replanErr) {
          console.warn('Dynamic re-planning encountered an issue, falling back to trajectory prompt:', replanErr);
        } finally {
          setIsReplanning(false);
        }
      } else {
        // 3. Fallback standard adjustment without dynamic agent re-planning
        let updatedNextSubQuestionText = subQuestions[nextIdx]?.subQuestion;
        if (customForwardDirection.trim()) {
          updatedNextSubQuestionText = `${subQuestions[nextIdx].subQuestion} [Adjusted with user guidance: ${customForwardDirection.trim()}]`;
        } else if (chosenOption?.adjustedNextSubQuestion) {
          updatedNextSubQuestionText = chosenOption.adjustedNextSubQuestion;
        }
        if (updatedNextSubQuestionText) {
          listToAdvance = listToAdvance.map((s, idx) => idx === nextIdx ? { ...s, subQuestion: updatedNextSubQuestionText } : s);
        }
      }
    }

    // Set decision tracking on current step
    listToAdvance = listToAdvance.map((s, idx) => {
      if (idx === currentIdx) {
        return {
          ...s,
          selectedChoiceId: selectedForwardChoiceId,
          selectedChoiceLabel: chosenLabel,
          userCustomDirection: customForwardDirection.trim() || undefined
        };
      }
      return s;
    });

    setSubQuestions(listToAdvance);
    setWaitingForForwardChoice(null);
    setReplanPreview(null);
    setCustomRefinementInstructions('');

    // Advance
    if (nextIdx < listToAdvance.length) {
      await runSingleSubQuestion(nextIdx, listToAdvance);
    } else {
      await handleSynthesizeMasterDossier(listToAdvance);
    }
  };

  // Sync ref for auto-click
  useEffect(() => {
    confirmForwardChoiceRef.current = handleConfirmForwardChoice;
  });

  // Auto-click and Auto-progress timer for Interactive Choice Gate
  useEffect(() => {
    if (
      waitingForForwardChoice === null ||
      !autoProgress ||
      isAutoPaused ||
      customForwardDirection.trim().length > 0 ||
      customRefinementInstructions.trim().length > 0
    ) {
      setAutoProgressCountdown(null);
      return;
    }

    // Initialize 3 second countdown for smooth user visibility
    setAutoProgressCountdown(3);

    const interval = window.setInterval(() => {
      setAutoProgressCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(interval);
          if (confirmForwardChoiceRef.current) {
            confirmForwardChoiceRef.current(autoReplanOnAdvance);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    waitingForForwardChoice, 
    autoProgress, 
    isAutoPaused, 
    autoReplanOnAdvance,
    customForwardDirection,
    customRefinementInstructions
  ]);

  // Synthesize Strategic Master Dossier
  const handleSynthesizeMasterDossier = async (
    stepsListOverride?: StrategicSubQuestion[],
    personaOverride?: TargetAudience
  ) => {
    const listToSynthesize = stepsListOverride || subQuestions;
    const completed = listToSynthesize.filter(s => s.status === 'completed');
    if (completed.length === 0 || !currentProject) return;

    const activeAudienceId = personaOverride || targetAudience;
    const activeAudienceConfig =
      TARGET_AUDIENCES.find(a => a.id === activeAudienceId) || TARGET_AUDIENCES[0];
    if (personaOverride) {
      setTargetAudience(personaOverride);
    }

    setIsSynthesizing(true);
    try {
      const schema = await getSchemaDescription();
      const availableCols = getAvailableColumns();
      const dossierRes = await agents.synthesizeStrategicDossier(
        strategicQuestion,
        schema,
        completed,
        models.evaluator,
        undefined,
        activeAudienceConfig.instructionPrompt,
        availableCols
      );

      // Extract or construct rich recommendations
      let richRecs: StrategicRecommendationItem[] = [];
      if (dossierRes.richRecommendations && Array.isArray(dossierRes.richRecommendations) && dossierRes.richRecommendations.length > 0) {
        richRecs = dossierRes.richRecommendations.map((r: any, idx: number) => ({
          id: r.id || `rec-${idx + 1}`,
          title: r.title || `Strategic Recommendation ${idx + 1}`,
          easyVersion: r.easyVersion || r.title || 'Focus on the strongest empirical pattern discovered in the data.',
          technicalInfo: r.technicalInfo || 'Apply feature engineering and statistical validation in the sandbox.',
          columnNames: Array.isArray(r.columnNames) && r.columnNames.length > 0 ? r.columnNames : availableCols.slice(idx * 2, idx * 2 + 2),
          copyPasteableQuestion: r.copyPasteableQuestion || `How does ${availableCols.slice(0, 2).join(' and ') || 'the key features'} impact outcomes across customer cohorts?`
        }));
      } else {
        const rawRecs = dossierRes.strategicRecommendations || [
          'Deploy high-impact feature set identified in Step 2 to production pipeline',
          'Implement proactive monitoring triggers based on sensitivity thresholds in Step 4',
          'Execute targeted retention rollout for high-risk cohorts identified in Step 5'
        ];
        richRecs = rawRecs.map((recText: string, idx: number) => {
          const col1 = availableCols[idx % (availableCols.length || 1)] || 'target_variable';
          const col2 = availableCols[(idx + 1) % (availableCols.length || 1)] || 'primary_feature';
          const col3 = availableCols[(idx + 2) % (availableCols.length || 1)] || 'cohort_group';
          return {
            id: `rec-${idx + 1}`,
            title: recText.split('.')[0] || `Recommendation ${idx + 1}`,
            easyVersion: activeAudienceId === 'school_student'
              ? `In simple words: Use clues from '${col1}' and '${col2}' to help our NGO spot who needs extra support first.`
              : activeAudienceId === 'college_graduate'
              ? `In plain terms: Group records using '${col1}' and '${col2}' so NGO volunteers can focus outreach where it helps most.`
              : activeAudienceId === 'ngo_leader'
              ? `Program priority: Allocate field resources using '${col1}' and '${col2}' to maximize beneficiary impact and track measurable outcomes.`
              : `Empirical action: Implement threshold gating on '${col1}' conditioned on '${col2}' and '${col3}' with cross-validated loss optimization.`,
            technicalInfo: `Filter dataset on '${col1}', compute descriptive distribution metrics against '${col2}', and evaluate predictive significance with an 80/20 train/test split.`,
            columnNames: [col1, col2, col3].filter(Boolean),
            copyPasteableQuestion: `Evaluate how '${col1}' and '${col2}' interact with '${col3}' to predict outcomes, and determine the optimal operational threshold.`
          };
        });
      }

      const synthesisData: StrategicDossierSynthesis = {
        executiveSummary: dossierRes.executiveSummary || 'Completed multi-step strategic experimentation roadmap with empirical data backing.',
        strategicVerdict: dossierRes.strategicVerdict || 'The progressive analysis confirms significant strategic opportunity.',
        confidenceScore: dossierRes.confidenceScore || 94,
        targetAudience: activeAudienceId,
        progressiveEvidence: dossierRes.progressiveEvidence || completed.map(s => ({
          stepNumber: s.stepNumber,
          stepTitle: s.title,
          keyFinding: s.narrative?.slice(0, 140) || 'Empirically tested',
          strategicImpact: s.selectedChoiceLabel || 'Baseline trajectory confirmed'
        })),
        strategicRecommendations: dossierRes.strategicRecommendations || richRecs.map(r => r.title),
        richRecommendations: richRecs,
        risksAndCaveats: dossierRes.risksAndCaveats || 'Model performance is subject to ongoing distribution shifts in incoming transaction streams.',
        implementationRoadmap: dossierRes.implementationRoadmap || [
          'Phase 1: Feature pipeline integration & canary rollout',
          'Phase 2: Full deployment & operational dashboard sync'
        ]
      };

      setFinalDossier(synthesisData);
      setDossierByPersonaCache(prev => ({
        ...prev,
        [activeAudienceId]: synthesisData
      }));
      setReportPersona(activeAudienceId);
    } catch (err: any) {
      console.error('Failed to synthesize strategic dossier:', err);
      alert('Failed to synthesize master dossier: ' + err.message);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // 1. "Help me understand" specific questions about the dossier & steps
  const handleHelpUnderstand = async (queryOverride?: string) => {
    const q = (queryOverride || helpUnderstandInput).trim();
    if (!q || !finalDossier) return;
    setIsClarityLoading(true);
    setClarityError(null);
    try {
      const completed = subQuestions.filter(s => s.status === 'completed');
      const schema = await getSchemaDescription();
      const res = await agents.answerStrategicQuestion(
        q,
        {
          strategicQuestion,
          audience: currentAudienceConfig.label,
          steps: completed,
          dossier: finalDossier,
          schema
        },
        models.explainer
      );

      const newItem: StrategicClarityItem = {
        id: `clarity-help-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'help_understand',
        typeLabel: 'Help Me Understand',
        query: q,
        response: res.answer || 'Explanation generated based on empirical findings.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setClarityItems(prev => [newItem, ...prev]);
      setHelpUnderstandInput('');
      setClaritySuccess('Explanation added to consultation record!');
      setTimeout(() => setClaritySuccess(null), 3000);
    } catch (err: any) {
      console.error('Error answering strategic question:', err);
      setClarityError(err.message || 'Failed to generate explanation. Please try again.');
    } finally {
      setIsClarityLoading(false);
    }
  };

  // 2. "How to frame my next question about" specific business topic
  const handleFrameNextQuestion = async (topicOverride?: string) => {
    const topic = (topicOverride || frameNextInput).trim();
    if (!topic || !finalDossier) return;
    setIsClarityLoading(true);
    setClarityError(null);
    try {
      const completed = subQuestions.filter(s => s.status === 'completed');
      const availableCols = getAvailableColumns();
      const schema = await getSchemaDescription();
      const res = await agents.frameNextStrategicQuestion(
        topic,
        {
          strategicQuestion,
          audience: currentAudienceConfig.label,
          steps: completed,
          dossier: finalDossier,
          schema,
          availableColumns: availableCols
        },
        models.strategyCreator || models.planner
      );

      const newItem: StrategicClarityItem = {
        id: `clarity-frame-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'frame_next_question',
        typeLabel: 'Frame Next Question',
        query: topic,
        response: res.overview || 'Formulated next targeted questions based on dataset schema.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        framedQuestions: res.framedQuestions || []
      };
      setClarityItems(prev => [newItem, ...prev]);
      setFrameNextInput('');
      setClaritySuccess('Formulated next questions added to consultation record!');
      setTimeout(() => setClaritySuccess(null), 3000);
    } catch (err: any) {
      console.error('Error framing next question:', err);
      setClarityError(err.message || 'Failed to frame next question.');
    } finally {
      setIsClarityLoading(false);
    }
  };

  // 3. "Give me specific info column names"
  const handleGetColumnInfo = async (queryOverride?: string) => {
    const q = (queryOverride || columnInfoInput).trim();
    if (!finalDossier) return;
    setIsClarityLoading(true);
    setClarityError(null);
    try {
      const availableCols = getAvailableColumns();
      const schema = await getSchemaDescription();
      const res = await agents.getSpecificColumnInfo(
        q || 'Identify key columns relevant to the strategic findings and forward testing',
        {
          schema,
          availableColumns: availableCols,
          strategicQuestion,
          findings: finalDossier.strategicVerdict
        },
        models.queryInterpreter
      );

      const newItem: StrategicClarityItem = {
        id: `clarity-cols-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'column_info',
        typeLabel: 'Specific Info Column Names',
        query: q || 'All Key Dataset Columns',
        response: res.summary || 'Column ecosystem analysis complete.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        columnsInfo: res.columnsInfo || []
      };
      setClarityItems(prev => [newItem, ...prev]);
      setColumnInfoInput('');
      setClaritySuccess('Specific column information added to consultation record!');
      setTimeout(() => setClaritySuccess(null), 3000);
    } catch (err: any) {
      console.error('Error getting column info:', err);
      setClarityError(err.message || 'Failed to retrieve column info.');
    } finally {
      setIsClarityLoading(false);
    }
  };

  // 4. "Add visuals" (Supports Bar, Donut, Trend, and KPI Scorecard charts)
  const handleAddVisuals = async (promptOverride?: string, typeOverride?: 'auto' | 'bar' | 'donut' | 'trend' | 'kpi') => {
    const p = (promptOverride || visualsInput).trim();
    if (!p || !finalDossier) return;
    setIsClarityLoading(true);
    setClarityError(null);
    try {
      const completed = subQuestions.filter(s => s.status === 'completed');
      const availableCols = getAvailableColumns();
      const preferredType = typeOverride || selectedChartTypePreference;
      const res = await agents.generateStrategicVisuals(
        p,
        {
          strategicQuestion,
          audience: currentAudienceConfig.label,
          steps: completed,
          dossier: finalDossier,
          availableColumns: availableCols,
          preferredType
        },
        models.explainer
      );

      const newItem: StrategicClarityItem = {
        id: `clarity-vis-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'add_visuals',
        typeLabel: 'Strategic Visuals & Charts',
        query: p,
        response: `Generated ${res.visuals?.length || 0} visual chart(s) illustrating the strategic findings.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        visuals: res.visuals || []
      };
      setClarityItems(prev => [newItem, ...prev]);
      setVisualsInput('');
      setClaritySuccess('Visual chart(s) added to report and consultation record!');
      setTimeout(() => setClaritySuccess(null), 3000);
    } catch (err: any) {
      console.error('Error generating visuals:', err);
      setClarityError(err.message || 'Failed to generate visuals.');
    } finally {
      setIsClarityLoading(false);
    }
  };

  // Download Comprehensive Tailored HTML Dossier Report (Including Consultations, Visuals & Selected Persona)
  const handleDownloadStrategicReport = async (
    sectionsOverride?: Array<{ id: string; enabled: boolean }>,
    filenameOverride?: string,
    personaOverride?: TargetAudience
  ) => {
    if (!finalDossier) return;

    const completed = subQuestions.filter(s => s.status === 'completed');
    const availableCols = getAvailableColumns();
    const allVisuals = clarityItems.flatMap(c => c.visuals || []);
    const safeHtml = (str: string) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const chosenPersona: TargetAudience =
      personaOverride || reportPersona || finalDossier.targetAudience || targetAudience;
    const chosenAudienceConfig =
      TARGET_AUDIENCES.find(a => a.id === chosenPersona) || currentAudienceConfig;

    // Resolve or tailor dossier text for the selected HTML report persona
    let dossierForReport: StrategicDossierSynthesis = finalDossier;
    const currentDossierPersona = finalDossier.targetAudience || targetAudience;
    if (chosenPersona !== currentDossierPersona) {
      if (dossierByPersonaCache[chosenPersona]) {
        dossierForReport = dossierByPersonaCache[chosenPersona]!;
      } else {
        setIsPreparingHtmlReport(true);
        try {
          const schema = await getSchemaDescription();
          const dossierRes = await agents.synthesizeStrategicDossier(
            strategicQuestion,
            schema,
            completed,
            models.evaluator,
            undefined,
            chosenAudienceConfig.instructionPrompt,
            availableCols
          );
          const tailoredSynthesis: StrategicDossierSynthesis = {
            executiveSummary: dossierRes.executiveSummary || finalDossier.executiveSummary,
            strategicVerdict: dossierRes.strategicVerdict || finalDossier.strategicVerdict,
            confidenceScore: dossierRes.confidenceScore || finalDossier.confidenceScore,
            targetAudience: chosenPersona,
            progressiveEvidence: dossierRes.progressiveEvidence || finalDossier.progressiveEvidence,
            strategicRecommendations: dossierRes.strategicRecommendations || finalDossier.strategicRecommendations,
            richRecommendations: (Array.isArray(dossierRes.richRecommendations) && dossierRes.richRecommendations.length > 0)
              ? dossierRes.richRecommendations.map((r: any, idx: number) => ({
                  id: r.id || `rec-${idx + 1}`,
                  title: r.title || `Recommendation ${idx + 1}`,
                  easyVersion: r.easyVersion || r.title || '',
                  technicalInfo: r.technicalInfo || '',
                  columnNames: Array.isArray(r.columnNames) ? r.columnNames : availableCols.slice(0, 2),
                  copyPasteableQuestion: r.copyPasteableQuestion || ''
                }))
              : finalDossier.richRecommendations,
            risksAndCaveats: dossierRes.risksAndCaveats || finalDossier.risksAndCaveats,
            implementationRoadmap: dossierRes.implementationRoadmap || finalDossier.implementationRoadmap
          };
          dossierForReport = tailoredSynthesis;
          setDossierByPersonaCache(prev => ({
            ...prev,
            [chosenPersona]: tailoredSynthesis
          }));
        } catch (err) {
          console.warn('Could not re-tailor HTML dossier for persona, using existing dossier content:', err);
        } finally {
          setIsPreparingHtmlReport(false);
        }
      }
    }

    const activeSections = sectionsOverride && sectionsOverride.length > 0
      ? sectionsOverride
      : DEFAULT_CUSTOM_SECTIONS;
    const detailsOpenAttr = sectionsOverride && startExpandedInCustomReport ? ' open' : '';

    // Multi-type visual renderer for downloaded HTML report (Bar, Donut, Trend, KPI Scorecards)
    const renderHtmlVisualCard = (vis: StrategicVisualItem) => {
      const chartType = (vis.chartType || 'bar').toLowerCase();
      let chartHtml = '';

      if (chartType === 'donut') {
        const total = (vis.items || []).reduce((acc, it) => acc + (Number(it.value) || 0), 0) || 100;
        let cumOffset = 0;
        const circumference = 2 * Math.PI * 70; // ~439.82
        
        const svgCircles = (vis.items || []).map((it, idx) => {
          const val = Number(it.value) || 0;
          const pct = Math.max(0.5, (val / total) * 100);
          const dash = (pct / 100) * circumference;
          const offset = - (cumOffset / 100) * circumference;
          cumOffset += pct;
          const color = it.color || ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'][idx % 6];
          return `<circle cx="110" cy="110" r="70" fill="transparent" stroke="${color}" stroke-width="26" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 110 110)"/>`;
        }).join('');

        const legendRows = (vis.items || []).map((it, idx) => {
          const val = Number(it.value) || 0;
          const pct = Math.round((val / total) * 100);
          const color = it.color || ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'][idx % 6];
          return `
            <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; margin-bottom: 8px;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${color}; margin-top: 3px; flex-shrink: 0;"></span>
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; font-weight: 700; color: #1e293b;">
                  <span>${safeHtml(it.label)}</span>
                  <span style="color: ${color}; font-weight: 800;">${safeHtml(it.formattedValue || `${pct}%`)}</span>
                </div>
                ${it.sublabel ? `<span style="font-size: 11px; color: #64748b; display: block;">${safeHtml(it.sublabel)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');

        chartHtml = `
          <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-around; gap: 20px; padding: 14px 0;">
            <div style="position: relative; width: 180px; height: 180px; flex-shrink: 0;">
              <svg viewBox="0 0 220 220" width="180" height="180" style="display: block;">
                ${svgCircles}
                <circle cx="110" cy="110" r="54" fill="#ffffff" />
                <text x="110" y="105" text-anchor="middle" font-size="10.5" font-weight="800" fill="#64748b" letter-spacing="0.05em">DISTRIBUTION</text>
                <text x="110" y="125" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">100%</text>
              </svg>
            </div>
            <div style="flex: 1; min-width: 220px;">
              ${legendRows}
            </div>
          </div>
        `;
      } else if (chartType === 'trend') {
        const items = vis.items || [];
        const n = items.length;
        const vals = items.map(it => Number(it.value) || 0);
        const minVal = vals.length > 0 ? Math.min(...vals) : 0;
        const maxVal = vals.length > 0 ? Math.max(...vals) : 100;
        const range = (maxVal - minVal) || 1;
        const width = 520;
        const height = 150;
        const padX = 45;
        const padY = 30;
        const plotW = width - 2 * padX;
        const plotH = height - 2 * padY;

        const coords = items.map((it, i) => {
          const x = padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
          const y = padY + plotH - (((Number(it.value) || 0) - minVal) / range) * plotH;
          return { x, y, it };
        });

        const pointsStr = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
        const areaStr = `${coords[0]?.x.toFixed(1) || padX},${height - padY} ${pointsStr} ${coords[coords.length - 1]?.x.toFixed(1) || (width - padX)},${height - padY}`;

        const dotsAndLabels = coords.map(c => `
          <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5" fill="#ffffff" stroke="${c.it.color || '#2563eb'}" stroke-width="3" />
          <text x="${c.x.toFixed(1)}" y="${(c.y - 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="800" fill="${c.it.color || '#1e293b'}">${safeHtml(c.it.formattedValue || String(c.it.value))}</text>
          <text x="${c.x.toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#64748b">${safeHtml(c.it.label)}</text>
        `).join('');

        chartHtml = `
          <div style="padding: 10px 0; overflow-x: auto;">
            <svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: 600px; height: auto; display: block; margin: 0 auto;">
              <defs>
                <linearGradient id="trendGrad-${vis.id}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
                </linearGradient>
              </defs>
              <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#e2e8f0" stroke-width="1.5" />
              <polygon points="${areaStr}" fill="url(#trendGrad-${vis.id})" />
              <polyline points="${pointsStr}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              ${dotsAndLabels}
            </svg>
          </div>
        `;
      } else if (chartType === 'kpi') {
        chartHtml = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 14px;">
            ${(vis.items || []).map((it, idx) => {
              const color = it.color || ['#2563eb', '#059669', '#d97706', '#7c3aed'][idx % 4];
              return `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid ${color}; border-radius: 8px; padding: 12px 14px;">
                  <div style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em;">${safeHtml(it.label)}</div>
                  <div style="font-size: 22px; font-weight: 800; color: ${color}; margin: 4px 0;">${safeHtml(it.formattedValue || String(it.value))}</div>
                  ${it.sublabel ? `<div style="font-size: 11px; color: #475569;">${safeHtml(it.sublabel)}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        // Bar Chart (default)
        chartHtml = `
          <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
            ${(vis.items || []).map(it => `
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span style="font-weight: 700; color: #1e293b;">${safeHtml(it.label)}</span>
                  <span style="font-weight: 800; color: ${it.color || '#2563eb'};">${safeHtml(it.formattedValue || String(it.value))}</span>
                </div>
                <div style="height: 10px; background: #e2e8f0; border-radius: 9999px; overflow: hidden; border: 1px solid #cbd5e1;">
                  <div style="height: 100%; width: ${Math.min(100, Math.max(0, it.value))}%; background: ${it.color || '#2563eb'}; border-radius: 9999px;"></div>
                </div>
                ${it.sublabel ? `<span style="font-size: 11px; color: #64748b; margin-top: 2px; display: block;">${safeHtml(it.sublabel)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        `;
      }

      return `
        <div class="chart-card">
          <div class="chart-header">
            <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${safeHtml(vis.title)}</div>
            <span style="font-size: 10.5px; font-weight: 800; text-transform: uppercase; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 2px 8px; border-radius: 4px;">
              ${safeHtml(vis.chartType)} Chart
            </span>
          </div>
          <p style="font-size: 12.5px; color: #475569; margin: 0 0 14px 0;">${safeHtml(vis.description)}</p>
          ${chartHtml}
          ${vis.takeaway ? `
            <div style="padding: 10px 14px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; font-size: 12px; color: #14532d;">
              <strong>💡 Strategic Takeaway:</strong> ${safeHtml(vis.takeaway)}
            </div>
          ` : ''}
        </div>
      `;
    };

    const sectionHtmlMap: Record<string, string> = {
      header_metadata: `
    <!-- Header -->
    <div class="header">
      <div class="badge-bar">
        <span class="badge">Strategic Master Dossier</span>
        <span class="badge badge-audience">Persona: ${safeHtml(chosenAudienceConfig.label)}</span>
        <span class="badge badge-success">Confidence: ${dossierForReport.confidenceScore}%</span>
        ${clarityItems.length > 0 ? `<span class="badge badge-consult">${clarityItems.length} Post-Execution Inquiries Documented</span>` : ''}
      </div>
      <div class="question-block">
        <div class="question-label">
          <span>🎯</span>
          <span>Core Strategic Question</span>
        </div>
        <h1 class="report-question">${safeHtml(strategicQuestion)}</h1>
      </div>
      <div class="subtitle">
        Project: <strong>${safeHtml(currentProject?.name || 'Data Intelligence Workspace')}</strong> &middot; Generated on ${new Date().toLocaleDateString()} &middot; Multi-Step Progressive Analytics
      </div>
    </div>

    <!-- Audience Persona Note -->
    <div class="audience-note">
      <strong>Tailored Audience Persona:</strong> ${safeHtml(chosenAudienceConfig.label)}<br/>
      ${safeHtml(chosenAudienceConfig.description)}
    </div>`,
      kpi_grid: `
    <!-- KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-val">${dossierForReport.confidenceScore}%</div>
        <div class="kpi-lbl">Strategic Confidence</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${completed.length} / 5</div>
        <div class="kpi-lbl">Empirical Steps Completed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${safeHtml(questionType)}</div>
        <div class="kpi-lbl">Framework Mode</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${availableCols.length}</div>
        <div class="kpi-lbl">Dataset Columns Audited</div>
      </div>
      ${clarityItems.length > 0 ? `
      <div class="kpi-card">
        <div class="kpi-val">${clarityItems.length}</div>
        <div class="kpi-lbl">Follow-up Clarifications</div>
      </div>
      ` : ''}
      ${allVisuals.length > 0 ? `
      <div class="kpi-card">
        <div class="kpi-val">${allVisuals.length}</div>
        <div class="kpi-lbl">Visual Charts Added</div>
      </div>
      ` : ''}
    </div>`,
      verdict: `
    <!-- 1. STRATEGIC VERDICT & EASY-TO-UNDERSTAND TAKEAWAYS -->
    <div class="verdict-box">
      <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #047857; margin-bottom: 4px;">
        1. Strategic Verdict &amp; Easy-to-Understand Takeaways (${safeHtml(chosenAudienceConfig.shortLabel)})
      </div>
      <div class="verdict-title">${safeHtml(dossierForReport.strategicVerdict)}</div>
      <div class="verdict-text">
        ${safeHtml(dossierForReport.executiveSummary).replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')}
      </div>
    </div>`,
      clarity_log: `
    <!-- 5. STRATEGIC CLARITY & FOLLOW-UP CONSULTATION LOG -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #0284c7;">5</span>
          <span>5. Strategic Clarity &amp; Follow-Up Consultation Log</span>
          <span class="badge badge-consult" style="margin-left: 6px;">${clarityItems.length} Inquiries</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">
          Post-execution follow-up consultations answering specific questions, framing subsequent analytical queries, auditing column metadata, and clarifying empirical results.
        </p>

        ${clarityItems.length === 0 ? `
          <div style="padding: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; font-size: 13px; color: #64748b; font-style: italic;">
            No follow-up questions were asked prior to export. You can use the 'Tailored Dossier Studio &amp; Strategic Clarification' interactive buttons ('Explain Simply', 'What to Ask Next', 'Data Columns', 'Make a Chart') to document additional findings before exporting.
          </div>
        ` : clarityItems.map((item, qIdx) => `
          <div class="inquiry-card">
            <div class="inquiry-header">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: #4f46e5; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">
                  Inquiry #${clarityItems.length - qIdx}
                </span>
                <span style="background: #e0f2fe; color: #0369a1; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #bae6fd;">
                  ${safeHtml(item.typeLabel)}
                </span>
              </div>
              <span style="font-size: 11px; color: #64748b;">🕒 ${safeHtml(item.timestamp)}</span>
            </div>

            <div>
              <strong style="font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; display: block; margin-bottom: 2px;">
                User Inquiry:
              </strong>
              <div class="inquiry-query">
                "${safeHtml(item.query)}"
              </div>
            </div>

            <div class="inquiry-response">
              <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #059669; margin-bottom: 6px;">
                Strategic Intelligence Response:
              </div>
              <div style="color: #1e293b; line-height: 1.6;">
                ${formatMarkdownToHtml(item.response)}
              </div>
            </div>

            ${item.framedQuestions && item.framedQuestions.length > 0 ? `
              <div style="margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #4338ca; margin-bottom: 8px;">
                  📋 Formulated Next Questions Ready to Run:
                </div>
                ${item.framedQuestions.map((fq, fqIdx) => `
                  <div style="background: #f8fafc; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #312e81; margin-bottom: 4px;">
                      <span>Option ${fqIdx + 1}: ${safeHtml(fq.title)}</span>
                      <span style="font-size: 10px; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${safeHtml(fq.methodology)}</span>
                    </div>
                    <div class="prompt-box" style="margin: 6px 0;">${safeHtml(fq.prompt)}</div>
                    <div style="font-size: 11.5px; color: #475569; margin-top: 4px;"><strong style="color: #1e293b;">Business Discovery:</strong> ${safeHtml(fq.businessValue)}</div>
                    ${fq.columns && fq.columns.length > 0 ? `
                      <div style="margin-top: 6px;">
                        <span style="font-size: 10.5px; color: #64748b; margin-right: 4px; font-weight: 700;">Target Columns:</span>
                        ${fq.columns.map(c => `<span class="pill" style="font-size: 10px;">${safeHtml(c)}</span>`).join('')}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${item.columnsInfo && item.columnsInfo.length > 0 ? `
              <div style="margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 10px; overflow-x: auto;">
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #7e22ce; margin-bottom: 8px;">
                  🏷️ Specific Column Recommendations &amp; Audited Metadata:
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <thead>
                    <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569;">
                      <th style="padding: 8px 10px;">Column Name</th>
                      <th style="padding: 8px 10px;">Type</th>
                      <th style="padding: 8px 10px;">Business Definition</th>
                      <th style="padding: 8px 10px;">Relevance &amp; Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${item.columnsInfo.map((col, cIdx) => `
                      <tr style="border-bottom: 1px solid #f1f5f9; background: ${cIdx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 10px; font-family: monospace; font-weight: 700; color: #2563eb;">${safeHtml(col.name)}</td>
                        <td style="padding: 8px 10px; color: #be185d; font-size: 11px; font-weight: 600;">${safeHtml(col.type)}</td>
                        <td style="padding: 8px 10px; color: #1e293b;">${safeHtml(col.description)}</td>
                        <td style="padding: 8px 10px; color: #047857; font-weight: 500;">${safeHtml(col.relevance)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </details>`,
      visuals: `
    <!-- 4. STRATEGIC VISUALIZATIONS & EMPIRICAL CHARTS -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #d97706;">4</span>
          <span>4. Strategic Visualizations &amp; Empirical Charts (${allVisuals.length} Visualized)</span>
          <span class="badge" style="background: #fef3c7; color: #92400e; border-color: #fde68a; margin-left: 6px;">${allVisuals.length} Visuals</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">
          Visual intelligence charts generated post-execution to illustrate empirical step metrics, distribution variances, and strategic performance.
        </p>

        ${allVisuals.length === 0 ? `
          <div style="padding: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; font-size: 13px; color: #64748b; font-style: italic;">
            No custom visual charts were requested prior to export. You can use the 'Make a Chart' tab in the Tailored Dossier Studio to generate interactive metric charts (Bar, Donut, Trend, KPI).
          </div>
        ` : allVisuals.map(vis => renderHtmlVisualCard(vis)).join('')}
      </div>
    </details>`,
      recommendations: `
    <!-- 3. GUIDANCE & RECOMMENDATIONS ON NEXT STEPS -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #2563eb;">3</span>
          <span>3. Guidance &amp; Recommendations on Next Steps (How to Proceed)</span>
          <span class="badge" style="background: #dbeafe; color: #1e40af; border-color: #bfdbfe; margin-left: 6px;">${(dossierForReport.richRecommendations || []).length} Actions</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">
          Tailored recommendations for <strong>${safeHtml(chosenAudienceConfig.shortLabel)}</strong> explaining what to do next, including both a plain-language version and specific column names ready for future questions.
        </p>

        ${(dossierForReport.richRecommendations || []).map((rec, rIdx) => `
          <div class="rec-card">
            <div class="rec-title">
              <span style="color: #2563eb;">#${rIdx + 1}</span> ${safeHtml(rec.title)}
            </div>

            <div class="rec-easy">
              <strong style="display:block; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; color: #047857; margin-bottom: 4px;">
                💡 Easy to Understand Version (${safeHtml(chosenAudienceConfig.shortLabel)}):
              </strong>
              ${safeHtml(rec.easyVersion)}
            </div>

            <div class="rec-tech">
              <strong style="display:block; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; color: #1d4ed8; margin-bottom: 4px;">
                ⚙️ Clear Technical Info &amp; Methodology:
              </strong>
              ${safeHtml(rec.technicalInfo)}
            </div>

            <div style="margin: 12px 0;">
              <strong style="font-size: 11px; text-transform: uppercase; color: #475569; display: block; margin-bottom: 6px; letter-spacing: 0.04em;">
                🏷️ Specific Column Names for Analysis:
              </strong>
              <div>
                ${rec.columnNames.map(col => `<span class="pill">${safeHtml(col)}</span>`).join('')}
              </div>
            </div>

            <div style="margin-top: 14px;">
              <strong style="font-size: 11px; text-transform: uppercase; color: #1e40af; display: block; margin-bottom: 4px;">
                📋 Ready-to-Use Future Question Prompt (Cut and Paste into Future Questions):
              </strong>
              <div class="prompt-box">
                ${safeHtml(rec.copyPasteableQuestion)}
              </div>
            </div>
          </div>
        `).join('')}

        ${dossierForReport.implementationRoadmap && dossierForReport.implementationRoadmap.length > 0 ? `
          <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 14px 16px; margin-top: 14px;">
            <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #3730a3; margin-bottom: 8px;">
              Implementation Roadmap
            </div>
            <ol style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #1e293b; line-height: 1.6;">
              ${dossierForReport.implementationRoadmap.map(phase => `<li>${safeHtml(phase)}</li>`).join('')}
            </ol>
          </div>
        ` : ''}
      </div>
    </details>`,
      timeline: `
    <!-- 2. COMPLETE 5-STEP PROGRESSIVE EXPERIMENT TIMELINE & DECISIONS -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #4f46e5;">2</span>
          <span>2. Complete 5-Step Progressive Experiment Timeline &amp; Decisions</span>
          <span class="badge" style="background: #e0e7ff; color: #3730a3; border-color: #c7d2fe; margin-left: 6px;">${completed.length} Steps</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">
          Shows the exact question asked in each step, the choices proposed by the AI, the steering path chosen, and the empirical results.
        </p>

        ${completed.map(s => `
          <div class="step-card">
            <div class="step-header">
              <div class="step-title">
                <span class="step-num">Step #${s.stepNumber}</span> ${safeHtml(s.title)}
              </div>
              <span style="font-size: 11px; font-family: monospace; color: #64748b; background: #ffffff; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0;">${safeHtml(s.plannedMethod)}</span>
            </div>

            <div style="margin-bottom: 12px;">
              <strong style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">Sub-Question Investigated:</strong>
              <div style="font-size: 13.5px; font-weight: 700; color: #0f172a; margin-top: 3px;">
                ${safeHtml(s.subQuestion)}
              </div>
            </div>

            <div class="grid-2">
              <div class="sub-box">
                <div class="sub-lbl">Proposed Forward Choices (With Simple Intuitive Explanations)</div>
                <div style="color: #334155; line-height: 1.5;">
                  ${s.forwardChoices && s.forwardChoices.length > 0 
                    ? s.forwardChoices.map((c, cIdx) => {
                        const simp = simplifiedChoicesMap[s.stepNumber]?.simplifiedChoices?.find(sc => sc.id === c.id) 
                          || simplifiedChoicesMap[s.stepNumber]?.simplifiedChoices?.[cIdx];
                        return `
                          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
                            &bull; <strong>${safeHtml(c.label)}</strong>: <span style="color:#64748b;">${safeHtml(c.description)}</span>
                            ${simp ? `
                              <div style="margin-top: 4px; font-size: 11.5px; color: #92400e; background: #fef3c7; padding: 4px 8px; border-radius: 4px; border: 1px solid #fde68a;">
                                <strong>💡 In Plain Words:</strong> ${safeHtml(simp.simpleTitle)} &mdash; <em>${safeHtml(simp.simpleAnalogy)}</em>
                              </div>
                            ` : ''}
                          </div>
                        `;
                      }).join('') 
                    : 'Standard baseline forward trajectories'}
                </div>
              </div>

              <div class="sub-box">
                <div class="sub-lbl">Choice Made &amp; Trajectory Taken</div>
                <div style="margin-top: 4px;">
                  <span class="choice-badge">&rarr; ${safeHtml(s.selectedChoiceLabel || 'Baseline Trajectory Confirmed')}</span>
                  ${s.isReplanned ? `<span class="replan-badge">&#x2728; Dynamically Re-Planned</span><div style="font-size: 11.5px; color: #86198f; margin-top: 6px;">Rationale: ${safeHtml(s.replanRationale || '')}</div>` : ''}
                </div>
              </div>
            </div>

            <div style="margin-top: 14px; padding: 12px; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div class="sub-lbl" style="color: #047857;">Empirical Results &amp; Answers</div>
              <div style="font-size: 13px; color: #1e293b; line-height: 1.6; margin-top: 4px;">
                ${safeHtml(s.narrative || 'Experiment executed and validated successfully in sandbox.')}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </details>`,
      column_bank: `
    <!-- 6. PROJECT DATASET COLUMN REFERENCE BANK -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #475569;">6</span>
          <span>6. Project Dataset Column Reference Bank (${availableCols.length} Columns)</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="font-size: 12.5px; color: #64748b; margin: 0 0 12px 0;">
          Columns detected in your uploaded dataset. You can cut and paste any of these column names into subsequent questions:
        </p>
        <div>
          ${availableCols.map(col => `<span class="pill">${safeHtml(col)}</span>`).join('')}
        </div>
      </div>
    </details>`,
      risks: `
    <!-- 7. RISKS, MODEL CONSTRAINTS & GOVERNANCE -->
    <details class="collapsible-section"${detailsOpenAttr}>
      <summary>
        <div class="summary-left">
          <span class="summary-num" style="background: #64748b;">7</span>
          <span>7. Risks, Model Constraints &amp; Governance</span>
        </div>
        <div class="summary-right">
          <span>Click to Expand</span>
          <span class="summary-chevron">▼</span>
        </div>
      </summary>
      <div class="collapsible-body">
        <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.65;">
          ${safeHtml(dossierForReport.risksAndCaveats)}
        </p>
      </div>
    </details>`
    };

    const renderedSectionsHtml = activeSections
      .filter(s => s.enabled)
      .map(s => sectionHtmlMap[s.id] || '')
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Strategic Action Report (${safeHtml(chosenAudienceConfig.shortLabel)}) — ${safeHtml(strategicQuestion)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --primary: #2563eb;
      --slate-900: #0f172a;
      --slate-800: #1e293b;
      --slate-700: #334155;
      --slate-600: #475569;
      --slate-500: #64748b;
      --slate-200: #e2e8f0;
      --slate-100: #f1f5f9;
      --slate-50: #f8fafc;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      margin: 0;
      padding: 32px 16px;
      line-height: 1.6;
    }
    .container {
      max-width: 980px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      padding: 36px 40px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05);
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 22px;
      margin-bottom: 24px;
    }
    .badge-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #e0e7ff;
      color: #3730a3;
      border: 1px solid #c7d2fe;
    }
    .badge-audience { background: #f3e8ff; color: #6b21a8; border-color: #d8b4fe; }
    .badge-success { background: #d1fae5; color: #065f46; border-color: #a7f3d0; }
    .badge-consult { background: #e0f2fe; color: #0369a1; border-color: #bae6fd; }
    .question-block {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #2563eb;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 14px 0 10px 0;
    }
    .question-label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    h1.report-question {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
      color: #0f172a;
      line-height: 1.45;
    }
    .subtitle { color: #475569; font-size: 13px; margin-top: 4px; }
    .audience-note {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 12.5px;
      color: #334155;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 20px 0 28px 0;
    }
    .kpi-card {
      background: #f8fafc;
      padding: 16px 18px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    .kpi-val { font-size: 24px; font-weight: 800; color: #0f172a; }
    .kpi-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 4px; letter-spacing: 0.04em; }
    .verdict-box {
      border-left: 5px solid #059669;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left-width: 5px;
      border-radius: 12px;
      padding: 22px;
      margin-bottom: 24px;
    }
    .verdict-title { font-size: 18px; font-weight: 800; color: #166534; margin: 0 0 10px 0; }
    .verdict-text { font-size: 13.5px; color: #1e293b; line-height: 1.65; }
    details.collapsible-section {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #ffffff;
      margin-bottom: 20px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    details.collapsible-section summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: #f8fafc;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid transparent;
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      transition: background 0.15s ease;
    }
    details.collapsible-section summary:hover {
      background: #f1f5f9;
    }
    details.collapsible-section[open] summary {
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
    }
    details.collapsible-section summary::-webkit-details-marker {
      display: none;
    }
    .summary-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .summary-num {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      color: #ffffff;
    }
    .summary-right {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #64748b;
      font-weight: 600;
    }
    .summary-chevron {
      font-size: 10px;
      color: #64748b;
      transition: transform 0.2s ease;
      display: inline-block;
    }
    details.collapsible-section[open] .summary-chevron {
      transform: rotate(180deg);
    }
    .collapsible-body {
      padding: 20px;
      background: #ffffff;
    }
    .step-card {
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .step-title { font-size: 14.5px; font-weight: 700; color: #0f172a; }
    .step-num { background: #4f46e5; color: #ffffff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
    @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
    .sub-box { background: #ffffff; border-radius: 8px; padding: 12px; border: 1px solid #e2e8f0; font-size: 12.5px; color: #334155; }
    .sub-lbl { font-size: 10.5px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 4px; letter-spacing: 0.04em; }
    .choice-badge { display: inline-block; padding: 3px 8px; background: #e0e7ff; color: #3730a3; border-radius: 6px; font-size: 11px; font-weight: 700; border: 1px solid #c7d2fe; }
    .replan-badge { display: inline-block; padding: 2px 8px; background: #fae8ff; color: #86198f; border-radius: 6px; font-size: 10px; font-weight: 800; margin-left: 6px; }
    .rec-card { background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin-bottom: 18px; }
    .rec-title { font-size: 15px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .rec-easy { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; color: #14532d; font-size: 13px; line-height: 1.6; }
    .rec-tech { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; color: #1e3a8a; font-size: 12.5px; line-height: 1.5; }
    .prompt-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #38bdf8; word-break: break-word; user-select: all; margin-top: 6px; }
    .pill { display: inline-block; background: #e2e8f0; color: #1e293b; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-family: monospace; font-weight: 700; margin-right: 6px; margin-bottom: 4px; border: 1px solid #cbd5e1; }
    .inquiry-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .inquiry-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px; }
    .inquiry-query { font-size: 14px; font-weight: 700; color: #0f172a; margin: 4px 0 10px 0; }
    .inquiry-response { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 13px; color: #1e293b; line-height: 1.6; margin-bottom: 10px; }
    .chart-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    ${renderedSectionsHtml}

    <!-- Sign-off Footer -->
    <div class="footer">
      Generated by <strong>Answer Strategically</strong> &bull; Answer Consistency Engine &bull; Tailored for ${safeHtml(chosenAudienceConfig.label)}
      ${clarityItems.length > 0 ? ` &bull; Includes ${clarityItems.length} Post-Execution Clarifications` : ''}
    </div>
  </div>
</body>
</html>`;

    const cleanFileName = filenameOverride && filenameOverride.trim()
      ? (filenameOverride.trim().toLowerCase().endsWith('.html') ? filenameOverride.trim() : `${filenameOverride.trim()}.html`)
      : `Strategic_Dossier_${chosenPersona}_${Date.now()}.html`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Feed Guidance and Findings to Answer Consistency Tab
  const handleFeedToAnswerConsistency = () => {
    const completed = subQuestions.filter(s => s.status === 'completed');
    const availableCols = getAvailableColumns();
    const stepSummaries = completed.map(s => 
      `• Step ${s.stepNumber} [${s.title}]: Method: ${s.plannedMethod} | Empirical Finding: ${s.narrative || 'Validated'} | Forward Trajectory: ${s.selectedChoiceLabel || 'Baseline Proceed'}${s.isReplanned ? ' (Dynamically Re-planned)' : ''}`
    ).join('\n');

    const recsFormatted = (finalDossier?.richRecommendations || []).map((r, i) => 
      `${i + 1}. ${r.title}
   - Easy-to-Understand: ${r.easyVersion}
   - Technical Method: ${r.technicalInfo}
   - Specific Columns: ${r.columnNames.join(', ')}
   - Suggested Next Question: "${r.copyPasteableQuestion}"`
    ).join('\n\n');

    const guidance = `Empirical Findings & Strategic Roadmap from Answer Strategically:
Strategic Question: "${strategicQuestion}"
Target Audience: ${currentAudienceConfig.label}
Strategic Verdict: ${finalDossier?.strategicVerdict || 'Completed 5-step empirical roadmap.'}
Confidence Score: ${finalDossier?.confidenceScore ?? 94}%

Empirical Findings Across 5 Progressive Experiments:
${stepSummaries}

Specific Dataset Columns Available for Testing:
${availableCols.slice(0, 20).join(', ')}

Actionable Guidance & Next Steps:
${recsFormatted || (finalDossier?.strategicRecommendations ? finalDossier.strategicRecommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') : '1. Deploy verified parameters to production.')}

Model Constraints & Risk Boundaries:
${finalDossier?.risksAndCaveats || 'Model performance subject to distribution shift.'}

Instructions for Answer Consistency:
Evaluate whether this strategic finding and predictive model outcome is statistically invariant and consistent across 5 independent analytical/ML methods using the project dataset.`;

    if (onFeedToAnswerConsistency) {
      onFeedToAnswerConsistency({
        question: strategicQuestion,
        guidance,
        source: 'strategic_dossier'
      });
      setFeedSuccess(true);
      setTimeout(() => setFeedSuccess(false), 3000);
    }
  };

  // Copy Executive Summary
  const handleCopySummary = async () => {
    if (!finalDossier) return;
    const text = `STRATEGIC MASTER DOSSIER SUMMARY
Question: ${strategicQuestion}
Verdict: ${finalDossier.strategicVerdict}
Confidence: ${finalDossier.confidenceScore}%

Executive Summary:
${finalDossier.executiveSummary}

Key Recommendations:
${finalDossier.strategicRecommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}
`;
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {}
  };

  // Build structured Strategic Favourite JSON bundle (Query, Steps, Code, Answer, Dual CSV SHA-256)
  const buildCurrentStrategicFavouriteBundle = (): StrategicFavouriteBundle | null => {
    if (!currentProject || !user || !finalDossier) return null;
    const codeList = subQuestions.map(s => s.code || '').filter(Boolean);
    const planList = subQuestions.map(s => `Step ${s.stepNumber} (${s.title}): ${s.subQuestion}`);
    const personaId = finalDossier.targetAudience || targetAudience;

    return {
      schemaVersion: '1.0',
      favouriteType: 'strategic_dossier',
      projectId: currentProject.projectId,
      userId: user.uid,
      timestamp: new Date().toISOString(),
      userQuery: strategicQuestion,
      refinedUserQuery: `[Answer Strategically - ${EXPLORATION_STYLE_GUIDES[presetKey].shortTitle}] ${strategicQuestion}`,
      explorationMode: presetKey,
      audiencePersona: personaId,
      metaPlanOverview: metaPlanOverview || '',
      csvFingerprints: sanitizeForFirestore(csvFingerprints),
      strategicSteps: subQuestions.map(s =>
        sanitizeForFirestore({
          stepNumber: s.stepNumber,
          title: s.title,
          subQuestion: s.subQuestion,
          plannedMethod: s.plannedMethod,
          code: s.code || '',
          status: s.status,
          narrative: s.narrative || '',
          metrics: s.metrics || extractStepMetrics(s.result),
          result: s.result ?? null
        })
      ),
      dossierSnapshot: sanitizeForFirestore({
        strategicVerdict: finalDossier.strategicVerdict,
        executiveSummary: finalDossier.executiveSummary,
        confidenceScore: finalDossier.confidenceScore,
        strategicRecommendations: finalDossier.strategicRecommendations || [],
        risksAndCaveats: finalDossier.risksAndCaveats || '',
        implementationRoadmap: finalDossier.implementationRoadmap || [],
        progressiveEvidence: finalDossier.progressiveEvidence || []
      }),
      narrative: `Strategic Verdict: ${finalDossier.strategicVerdict}\n\n${finalDossier.executiveSummary}\n\nRecommendations:\n${(finalDossier.strategicRecommendations || []).join('\n')}`,
      analysisPlan: planList,
      generatedCode: codeList,
      analysisResult: JSON.stringify({
        confidenceScore: finalDossier.confidenceScore,
        strategicVerdict: finalDossier.strategicVerdict,
        csvFingerprints: csvFingerprints.map(f => ({
          fileName: f.fileName,
          columnsSha256: f.columnsSha256,
          dataSha256: f.dataSha256,
          rowCount: f.rowCount
        })),
        subQuestions: subQuestions.map(s => ({
          stepNumber: s.stepNumber,
          title: s.title,
          decision: s.selectedChoiceLabel,
          finding: s.narrative?.slice(0, 120)
        }))
      }),
      feedback: 'Strategic Dossier'
    };
  };

  // Save full Strategic Favourite JSON bundle (including dual CSV SHAs) to Firestore
  const handleSaveToFavourites = async () => {
    const bundle = buildCurrentStrategicFavouriteBundle();
    if (!bundle) return;
    setIsSavingFav(true);
    try {
      await addDoc(collection(db, 'favourites'), sanitizeForFirestore(bundle));
      setFavSaved(true);
      setTimeout(() => setFavSaved(false), 3500);
    } catch (err: any) {
      console.error('Error saving to favourites:', err);
      handleFirestoreError(err, OperationType.CREATE, 'favourites');
      alert('Failed to save to Favourites: ' + (err.message || 'Permission denied'));
    } finally {
      setIsSavingFav(false);
    }
  };

  const handleDownloadCurrentJson = () => {
    const bundle = buildCurrentStrategicFavouriteBundle();
    if (!bundle) return;
    downloadStrategicFavouriteJson(bundle);
  };

  // Render Strategic Clarity & Follow-Up Questions Studio
  const renderClarityStudioContent = (isInsideModal: boolean = false) => {
    const allVisuals = clarityItems.flatMap(c => c.visuals || []);
    const availableCols = getAvailableColumns();

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tailored Dossier Studio &amp; Strategic Clarification</span>
              {clarityItems.length > 0 && (
                <span className="text-xs font-normal text-slate-500 tabular-nums">
                  · {clarityItems.length} {clarityItems.length === 1 ? 'note saved' : 'notes saved'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Ask for simpler explanations, get ideas for what to check next, peek at column names, or add charts to your Strategic Master Dossier before downloading.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isPreparingHtmlReport}
              onClick={() => handleDownloadStrategicReport(undefined, undefined, reportPersona)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              title="Download your full Strategic Master Dossier as HTML for the selected persona"
            >
              {isPreparingHtmlReport ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing HTML...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Tailored Dossier (HTML)</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomFilename(`Strategic_Dossier_${reportPersona}_${(strategicQuestion || 'Report').slice(0, 24).replace(/[^a-zA-Z0-9]/g, '_')}.html`);
                setIsCustomReportModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              title="Pick persona, dossier sections, sequence, and filename for your HTML report"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>Custom Dossier</span>
            </button>
          </div>
        </div>

        {/* HTML Report Audience Persona Selector */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="text-xs">
            <span className="font-semibold text-slate-900">HTML Report Persona:</span>{' '}
            <span className="text-slate-600">
              {(TARGET_AUDIENCES.find(a => a.id === reportPersona) || currentAudienceConfig).description}
            </span>
          </div>
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-white rounded-lg border border-slate-200 shrink-0">
            {TARGET_AUDIENCES.map((aud) => (
              <button
                key={aud.id}
                type="button"
                onClick={() => setReportPersona(aud.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  reportPersona === aud.id
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
                title={aud.description}
              >
                {aud.shortLabel}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Plain-English Interactive Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => setActiveClarityTab('help_understand')}
            className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex flex-col gap-1 ${
              activeClarityTab === 'help_understand'
                ? 'bg-emerald-50/80 border-emerald-400 text-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <HelpCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Explain Something</span>
            </div>
            <span className="text-[11px] text-slate-500 line-clamp-1">
              Ask about any step or number
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveClarityTab('frame_next_question')}
            className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex flex-col gap-1 ${
              activeClarityTab === 'frame_next_question'
                ? 'bg-indigo-50/80 border-indigo-400 text-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>What to Ask Next</span>
            </div>
            <span className="text-[11px] text-slate-500 line-clamp-1">
              Get ready-to-use follow-up questions
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveClarityTab('column_info')}
            className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex flex-col gap-1 ${
              activeClarityTab === 'column_info'
                ? 'bg-slate-100 border-slate-400 text-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <Tag className="w-4 h-4 text-slate-600 shrink-0" />
              <span>Data Columns</span>
            </div>
            <span className="text-[11px] text-slate-500 line-clamp-1">
              See what each column means
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveClarityTab('add_visuals')}
            className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex flex-col gap-1 ${
              activeClarityTab === 'add_visuals'
                ? 'bg-amber-50/80 border-amber-400 text-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <BarChart2 className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Make a Chart</span>
            </div>
            <span className="text-[11px] text-slate-500 line-clamp-1">
              Turn findings into easy charts
            </span>
          </button>
        </div>

        {/* Input Panel based on active tab */}
        <div className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-white space-y-3">
          {activeClarityTab === 'help_understand' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-semibold text-slate-900">
                  What part would you like explained more simply?
                </label>
                <span className="text-xs text-slate-500">Reading level: {currentAudienceConfig.shortLabel}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={2}
                  value={helpUnderstandInput}
                  onChange={(e) => setHelpUnderstandInput(e.target.value)}
                  placeholder="e.g. Why did Step 3 find a big drop? What does the confidence score actually mean?"
                  className="flex-1 p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
                  disabled={isClarityLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleHelpUnderstand();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleHelpUnderstand()}
                  disabled={isClarityLoading || !helpUnderstandInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer sm:self-stretch whitespace-nowrap"
                >
                  {isClarityLoading ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>Explain Simply</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">Try asking:</span>
                {[
                  "Why was the main factor in Step 2 so important?",
                  "What could make this answer less accurate?",
                  "Explain the final score like I'm new to this"
                ].map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setHelpUnderstandInput(sq);
                      handleHelpUnderstand(sq);
                    }}
                    disabled={isClarityLoading}
                    className="px-2.5 py-1 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeClarityTab === 'frame_next_question' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-semibold text-slate-900">
                  What topic do you want to explore next?
                </label>
                <span className="text-xs text-slate-500">Creates ready-to-run follow-up questions</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={2}
                  value={frameNextInput}
                  onChange={(e) => setFrameNextInput(e.target.value)}
                  placeholder="e.g. Which group of users leaves fastest? How do prices affect sales next month?"
                  className="flex-1 p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                  disabled={isClarityLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleFrameNextQuestion();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleFrameNextQuestion()}
                  disabled={isClarityLoading || !frameNextInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer sm:self-stretch whitespace-nowrap"
                >
                  {isClarityLoading ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>Suggest Questions</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">Ideas:</span>
                {[
                  "How to keep more people from leaving",
                  "Which groups bring the most value",
                  "What happens in the next 30 days"
                ].map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setFrameNextInput(sq);
                      handleFrameNextQuestion(sq);
                    }}
                    disabled={isClarityLoading}
                    className="px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-800 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeClarityTab === 'column_info' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-semibold text-slate-900">
                  Which data columns do you want explained?
                </label>
                <span className="text-xs text-slate-500 tabular-nums">{availableCols.length} columns found in your files</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={columnInfoInput}
                  onChange={(e) => setColumnInfoInput(e.target.value)}
                  placeholder="e.g. price, dates, user activity — or leave blank to see the top columns"
                  className="flex-1 px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  disabled={isClarityLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleGetColumnInfo();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleGetColumnInfo()}
                  disabled={isClarityLoading}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  {isClarityLoading ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  <span>Look Up Columns</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">Quick lookups:</span>
                {[
                  "Most important columns for predictions",
                  "Money, prices, and totals",
                  "Dates, IDs, and user groups"
                ].map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setColumnInfoInput(sq);
                      handleGetColumnInfo(sq);
                    }}
                    disabled={isClarityLoading}
                    className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeClarityTab === 'add_visuals' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-semibold text-slate-900">
                  Describe the chart you want to add to your report
                </label>
                <span className="text-xs text-slate-500">Pick a style or let us choose</span>
              </div>

              {/* Visual Format Selector */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-slate-600 mr-1">Chart style:</span>
                {[
                  { id: 'auto', label: 'Best Fit', icon: Wand2 },
                  { id: 'bar', label: 'Bar Chart', icon: BarChart2 },
                  { id: 'donut', label: 'Pie / Donut', icon: PieChart },
                  { id: 'trend', label: 'Line Trend', icon: TrendingUp },
                  { id: 'kpi', label: 'Score Cards', icon: LayoutGrid }
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedChartTypePreference(t.id as any)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                      selectedChartTypePreference === t.id
                        ? 'bg-amber-600 text-white border-amber-600 font-semibold'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={2}
                  value={visualsInput}
                  onChange={(e) => setVisualsInput(e.target.value)}
                  placeholder="e.g. Show a bar chart comparing Step 1 to Step 5 scores, or a pie chart of the biggest factors"
                  className="flex-1 p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none"
                  disabled={isClarityLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleAddVisuals();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleAddVisuals()}
                  disabled={isClarityLoading || !visualsInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer sm:self-stretch whitespace-nowrap"
                >
                  {isClarityLoading ? <RotateCcw className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
                  <span>Create Chart</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">One-click charts:</span>
                {[
                  { label: "Step Scores (Bar)", prompt: "Bar chart comparing performance metrics across the 5 steps", type: 'bar' },
                  { label: "Top Factors (Donut)", prompt: "Donut chart showing proportional breakdown of key factors influencing the outcome", type: 'donut' },
                  { label: "Progress Over Steps (Line)", prompt: "Trend line showing metric trajectory and milestone convergence from Step 1 to Step 5", type: 'trend' },
                  { label: "Summary Scorecard", prompt: "Multi-metric executive scorecard grid with confidence, primary outcome, stability, and risk", type: 'kpi' }
                ].map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setVisualsInput(sq.prompt);
                      setSelectedChartTypePreference(sq.type as any);
                      handleAddVisuals(sq.prompt, sq.type as any);
                    }}
                    disabled={isClarityLoading}
                    className="px-2.5 py-1 bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-900 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    {sq.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {claritySuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg flex items-center gap-2 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{claritySuccess}</span>
            </div>
          )}

          {clarityError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-900 rounded-lg flex items-center gap-2 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{clarityError}</span>
            </div>
          )}
        </div>

        {/* Saved Follow-Up Notes & Visuals */}
        {clarityItems.length > 0 && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 tabular-nums">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                <span>Saved Questions &amp; Charts ({clarityItems.length})</span>
              </h4>
              <button
                type="button"
                onClick={() => setClarityItems([])}
                className="text-xs text-slate-500 hover:text-rose-600 font-medium transition-colors cursor-pointer"
              >
                Clear All
              </button>
            </div>

            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {clarityItems.map((item, idx) => (
                <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 tabular-nums">#{clarityItems.length - idx}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700">{item.typeLabel}</span>
                    </div>
                    <span className="tabular-nums">{item.timestamp}</span>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-900">"{item.query}"</p>
                  </div>

                  {item.response && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <FormattedAnswerDisplay content={item.response} compact={true} />
                    </div>
                  )}

                  {item.framedQuestions && item.framedQuestions.length > 0 && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <span className="text-xs font-semibold text-slate-800 block">
                        Ready-to-Use Follow-Up Questions
                      </span>
                      {item.framedQuestions.map((fq, fqIdx) => (
                        <div key={fqIdx} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-semibold text-slate-900">{fq.title}</span>
                            <span className="text-[11px] text-slate-500 font-mono">{fq.methodology}</span>
                          </div>
                          <div className="p-2.5 bg-slate-900 rounded-lg text-sky-200 font-mono text-xs select-all">
                            {fq.prompt}
                          </div>
                          <p className="text-xs text-slate-600">
                            <span className="font-medium text-slate-800">Why ask this:</span> {fq.businessValue}
                          </p>
                          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                            {fq.columns && fq.columns.length > 0 && (
                              <span className="text-[11px] text-slate-500 font-mono">
                                Columns: {fq.columns.join(', ')}
                              </span>
                            )}
                            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                              <button
                                type="button"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(fq.prompt);
                                  setCopiedPromptId(`fq-${idx}-${fqIdx}`);
                                  setTimeout(() => setCopiedPromptId(null), 2500);
                                }}
                                className="text-xs px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                {copiedPromptId === `fq-${idx}-${fqIdx}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedPromptId === `fq-${idx}-${fqIdx}` ? 'Copied' : 'Copy'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setStrategicQuestion(fq.prompt);
                                  if (isInsideModal) setIsClarityModalOpen(false);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-xs px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <ArrowRight className="w-3 h-3" />
                                <span>Ask This Next</span>
                              </button>
                              {onFeedToAnswerConsistency && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onFeedToAnswerConsistency({
                                      question: fq.prompt,
                                      guidance: `Framed Strategic Question from Answer Strategically:
Title: ${fq.title}
Methodology: ${fq.methodology}
Target Columns: ${fq.columns.join(', ')}
Business Value: ${fq.businessValue}

Instructions for Answer Consistency:
Evaluate whether this strategic prompt ("${fq.prompt}") produces statistically invariant results across 5 independent analytical methods.`,
                                      source: 'strategic_dossier'
                                    });
                                  }}
                                  className="text-xs px-2.5 py-1 bg-white hover:bg-slate-100 text-indigo-700 border border-indigo-200 font-medium rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Scale className="w-3 h-3" />
                                  <span>Double-Check Consistency</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {item.columnsInfo && item.columnsInfo.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <span className="text-xs font-semibold text-slate-800 block">
                        Column Guide
                      </span>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-full text-left text-xs bg-white">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                            <tr>
                              <th className="p-2.5">Column Name</th>
                              <th className="p-2.5">Type</th>
                              <th className="p-2.5">What It Means</th>
                              <th className="p-2.5">How to Use It</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {item.columnsInfo.map((col, cIdx) => (
                              <tr key={cIdx} className="hover:bg-slate-50/60">
                                <td className="p-2.5 font-mono font-semibold text-indigo-700">
                                  <div className="flex items-center gap-1.5">
                                    <span>{col.name}</span>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await navigator.clipboard.writeText(col.name);
                                        setCopiedColumnName(col.name);
                                        setTimeout(() => setCopiedColumnName(null), 2000);
                                      }}
                                      className="p-0.5 text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      title="Copy column name"
                                    >
                                      {copiedColumnName === col.name ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                    </button>
                                  </div>
                                </td>
                                <td className="p-2.5 text-slate-600">{col.type}</td>
                                <td className="p-2.5 text-slate-800">{col.description}</td>
                                <td className="p-2.5 text-emerald-800">{col.relevance}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {item.visuals && item.visuals.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <span className="text-xs font-semibold text-slate-800 block">
                        Charts Added to Your Report
                      </span>
                      {item.visuals.map((vis) => (
                        <StrategicVisualCard key={vis.id} vis={vis} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Export Bar */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-900">Ready to Save Your Report?</div>
            <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
              Includes your 5-step findings, easy takeaways
              {clarityItems.length > 0 ? `, ${clarityItems.length} follow-up notes, and ${allVisuals.length} charts.` : '.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleDownloadStrategicReport()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Download Full Report (HTML)</span>
          </button>
        </div>
      </div>
    );
  };

  const completedStepsCount = subQuestions.filter(s => s.status === 'completed').length;
  const currentPhaseStep = finalDossier ? 4 : isStepRunning || waitingForForwardChoice !== null || completedStepsCount > 0 ? 3 : isPlanReady ? 2 : 1;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Main Setup Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        {/* Title + Data Summary */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Explore Step by Step
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Ask a big question about your data. We will break it into 5 simple steps, check the numbers, and explain what to do next.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowSavedFavBrowser(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                showSavedFavBrowser
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-semibold'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              title="Search saved strategic queries and re-run them on current CSVs"
            >
              <Star className={`w-3.5 h-3.5 ${savedFavourites.length > 0 ? 'text-amber-500 fill-amber-400' : 'text-slate-400'}`} />
              <span>Saved Favourites ({savedFavourites.length})</span>
              {showSavedFavBrowser ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-600 tabular-nums">
              <Database className="w-4 h-4 text-slate-400" />
              {dataLoadStatus.loading ? (
                <span className="text-amber-700 font-medium">Loading files...</span>
              ) : dataLoadStatus.error ? (
                <span className="text-rose-600 font-medium">{dataLoadStatus.error}</span>
              ) : (
                <span>
                  <strong className="font-semibold text-slate-900">{Object.keys(datasets).length}</strong> files · <strong className="font-semibold text-slate-900">{dataLoadStatus.rows.toLocaleString()}</strong> rows ready
                  {csvFingerprints.length > 0 && (
                    <>
                      {' · '}
                      <span className="font-mono text-[11px] text-slate-500" title={`Column Names SHA-256: ${csvFingerprints[0].columnsSha256}`}>
                        Col SHA {csvFingerprints[0].columnsSha256.slice(0, 8)}
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Searchable Saved Strategic Favourites Browser */}
        {showSavedFavBrowser && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Search Saved Strategic Favourites</h3>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Saved queries capture code, 5 steps, answer, and dual CSV SHA-256 fingerprints. If Column Names SHA matches, code re-runs directly without AI wait.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={favSearchText}
                    onChange={(e) => setFavSearchText(e.target.value)}
                    placeholder="Filter saved queries..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSearchSavedFavsWithAi}
                  disabled={isSemanticSearchingFavs || savedFavourites.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-slate-700 hover:text-indigo-800 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {isSemanticSearchingFavs ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-600" />}
                  <span>AI Match</span>
                </button>
              </div>
            </div>

            {savedFavourites.length === 0 ? (
              <p className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg p-3">
                No saved strategic favourites yet. Run an analysis and click <strong>Save to Favourites</strong> in the dossier header.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {savedFavourites
                  .filter((fav) => {
                    if (!favSearchText.trim()) return true;
                    const needle = favSearchText.toLowerCase();
                    return (
                      fav.userQuery.toLowerCase().includes(needle) ||
                      (fav.dossierSnapshot?.strategicVerdict || '').toLowerCase().includes(needle) ||
                      Boolean(fav.id && semanticFavScores[fav.id])
                    );
                  })
                  .sort((a, b) => {
                    const sa = (a.id && semanticFavScores[a.id]) || 0;
                    const sb = (b.id && semanticFavScores[b.id]) || 0;
                    return sb - sa;
                  })
                  .map((fav) => {
                    const compat = evaluateCsvCompatibility(fav.csvFingerprints, csvFingerprints);
                    const simScore = fav.id ? semanticFavScores[fav.id] : undefined;
                    const colShaShort = fav.csvFingerprints?.[0]?.columnsSha256?.slice(0, 8) || 'none';
                    const dataShaShort = fav.csvFingerprints?.[0]?.dataSha256?.slice(0, 8) || 'none';

                    return (
                      <div
                        key={fav.id || fav.timestamp}
                        className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate" title={fav.userQuery}>
                            {fav.userQuery}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                            <span>{new Date(fav.timestamp).toLocaleDateString()}</span>
                            <span aria-hidden="true">·</span>
                            <span>{fav.strategicSteps?.length || 0} steps</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">Col SHA {colShaShort}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">Data SHA {dataShaShort}</span>
                            {simScore && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-indigo-700 font-semibold">{Math.round(simScore * 100)}% match</span>
                              </>
                            )}
                          </div>
                          <p className={`text-[11px] font-medium flex items-center gap-1 ${
                            compat.status === 'identical_data' || compat.status === 'columns_intact_data_changed'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}>
                            {compat.status === 'identical_data' || compat.status === 'columns_intact_data_changed' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{compat.headline}</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {compat.canDirectRunWithoutAgent ? (
                            <button
                              type="button"
                              disabled={isDirectReplaying}
                              onClick={() => {
                                if (compat.status === 'identical_data') {
                                  hydrateSavedFavouriteAsResult(fav, compat);
                                } else {
                                  runSavedFavouriteDirectlyWithoutAgent(fav, compat);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              <Play className="w-3 h-3" />
                              <span>{compat.status === 'identical_data' ? 'Load Cached' : 'Re-run Code (No AI)'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setStrategicQuestion(fav.userQuery);
                                setPendingMatchedFav({ fav, matchType: 'exact', compatibility: compat });
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <AlertCircle className="w-3 h-3" />
                              <span>Check Changes</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setInspectingFavJson(fav)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <FileText className="w-3 h-3 text-slate-500" />
                            <span>JSON</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadStrategicFavouriteJson(fav)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap"
                            title="Download portable JSON bundle"
                          >
                            <Download className="w-3 h-3 text-slate-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Clean 4-Step Progress Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { num: 1, label: 'Ask Question' },
            { num: 2, label: '5-Step Plan' },
            { num: 3, label: 'Run & Steer' },
            { num: 4, label: 'Master Dossier' }
          ].map((step) => {
            const isDone = currentPhaseStep > step.num || (step.num === 4 && !!finalDossier);
            const isCurrent = currentPhaseStep === step.num && !isDone;
            return (
              <div
                key={step.num}
                className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                  isDone
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : isCurrent
                    ? 'bg-indigo-50/80 border-indigo-300 text-indigo-950 font-semibold'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                <span className={`w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums ${
                  isDone
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {isDone ? '✓' : step.num}
                </span>
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Reading Level & Auto-Advance Strip */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
          {/* Reading Level / Audience Persona Segmented Control */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700 block">Audience persona for explanations &amp; dossier</span>
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
              {TARGET_AUDIENCES.map((aud) => (
                <button
                  key={aud.id}
                  type="button"
                  onClick={() => setTargetAudience(aud.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    targetAudience === aud.id
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title={aud.description}
                >
                  {aud.shortLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Simple Auto-Progress Switch */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoProgress}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoProgress(val);
                  if (!val) {
                    setAutoProgressCountdown(null);
                    setIsAutoPaused(false);
                  }
                }}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
              />
              <span className="font-medium text-slate-800">Auto-advance between steps</span>
            </label>

            {autoProgress && waitingForForwardChoice !== null && autoProgressCountdown !== null && (
              <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-900 font-medium px-2.5 py-1 rounded-lg border border-amber-200 text-xs tabular-nums">
                <Timer className="w-3.5 h-3.5 text-amber-600" />
                <span>Next step in {autoProgressCountdown}s</span>
                <button
                  type="button"
                  onClick={() => setIsAutoPaused(!isAutoPaused)}
                  className="underline font-semibold text-amber-900 hover:text-slate-900 cursor-pointer"
                >
                  {isAutoPaused ? 'Resume' : 'Pause'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Exploration Style Picker with Gentle Reveal + Question Genie */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-700">
              Choose how you want to explore <span className="text-slate-400 font-normal">(click any style to see what it unlocks)</span>
            </span>
            <button
              type="button"
              onClick={() => setShowStyleReveal(prev => !prev)}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <span>{showStyleReveal ? 'Hide guide' : 'Show guide'}</span>
              {showStyleReveal ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {(['custom', 'ml', 'strategy'] as ExplorationModeKey[]).map((key) => {
              const guide = EXPLORATION_STYLE_GUIDES[key];
              const isSelected = presetKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setShowStyleReveal(prev => !prev);
                    } else {
                      handleSelectPreset(key);
                    }
                  }}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                    isSelected
                      ? 'bg-indigo-50/70 border-indigo-300 ring-1 ring-indigo-200'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {key === 'custom' ? <Compass className="w-4 h-4" /> :
                         key === 'ml' ? <Brain className="w-4 h-4" /> :
                         <Scale className="w-4 h-4" />}
                      </span>
                      <span className={`text-xs font-semibold truncate ${isSelected ? 'text-indigo-950' : 'text-slate-900'}`}>
                        {guide.shortTitle}
                      </span>
                    </div>
                    {guide.badgeText && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                        {guide.badgeText}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-snug pl-9">
                    {guide.subtitle}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Gentle Reveal Panel: Explains active style + Genie "Do More" Question Proposer */}
          {showStyleReveal && (() => {
            const activeGuide = EXPLORATION_STYLE_GUIDES[presetKey];
            const genieList = genieSuggestionsByMode[presetKey] || [];
            const starterList = buildModeStarterProposals(presetKey);
            const activeProposals = genieList.length > 0 ? genieList : starterList;
            const hasGenieIdeas = genieList.length > 0;

            return (
              <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-4 transition-all">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>What clicking &ldquo;{activeGuide.shortTitle}&rdquo; brings you</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {activeGuide.gentleRevealHeadline}
                    </p>
                    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
                      {activeGuide.whatItBrings.map((point, idx) => (
                        <li
                          key={idx}
                          className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-start gap-2"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="leading-snug">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Question Genie & Proposed Questions */}
                <div className="border-t border-slate-200/80 pt-3.5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <span className="text-xs font-semibold text-slate-900 block">
                        {hasGenieIdeas ? 'Genie ideas tailored to your data' : 'Starter ideas to try right away'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {hasGenieIdeas
                          ? 'Click any idea to fill your question box, or ask the Genie to do more.'
                          : 'Click an idea below, or let the Genie inspect your columns and propose custom questions.'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleGenieProposeQuestions()}
                      disabled={isGeneratingGenieQuestions}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {isGeneratingGenieQuestions ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          <span>Genie is thinking...</span>
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-3.5 h-3.5" />
                          <span>{hasGenieIdeas ? 'Do More — Propose Fresh Questions' : 'Ask Genie: Propose Interesting Questions'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {genieError && (
                    <p className="text-[11px] text-amber-700">{genieError}</p>
                  )}

                  <div className={`grid grid-cols-1 ${activeProposals.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-2.5`}>
                    {activeProposals.map((item, idx) => (
                      <div
                        key={`${presetKey}-${idx}-${item.title}`}
                        className="bg-white border border-slate-200 hover:border-indigo-300 rounded-lg p-3 flex flex-col justify-between gap-2.5 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900 leading-snug">
                              {item.title}
                            </span>
                            {hasGenieIdeas && (
                              <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">
                            &ldquo;{item.question}&rdquo;
                          </p>
                          <p className="text-[11px] text-slate-500 leading-snug">
                            Why it&apos;s cool: {item.whyInteresting}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => setStrategicQuestion(item.question)}
                            className="text-[11px] font-medium text-slate-700 hover:text-indigo-700 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-md px-2.5 py-1 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Use question
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStrategicQuestion(item.question);
                              handleAskQuestion(item.question);
                            }}
                            disabled={isPlanning}
                            className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            <span>Plan 5 Steps</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Question Input */}
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-900">
            What would you like to find out?
          </label>
          <textarea
            value={strategicQuestion}
            onChange={(e) => {
              setStrategicQuestion(e.target.value);
              if (pendingMatchedFav) setPendingMatchedFav(null);
            }}
            placeholder="Type your own question, or click one of the Genie ideas above..."
            rows={3}
            className="w-full text-sm text-slate-900 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 outline-none"
          />
        </div>

        {/* Auto-Match & Dual CSV SHA-256 Recommendation Banner */}
        {pendingMatchedFav && (
          <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {pendingMatchedFav.compatibility.canDirectRunWithoutAgent ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>
                    {pendingMatchedFav.matchType === 'exact'
                      ? 'Matching Saved Query Found'
                      : `Similar Saved Query Found (${Math.round((pendingMatchedFav.score || 0.8) * 100)}% match)`}
                  </span>
                </div>
                <p className="text-xs text-slate-700">
                  Saved query: <strong className="text-slate-900">&ldquo;{pendingMatchedFav.fav.userQuery}&rdquo;</strong>
                </p>
                <p className={`text-xs font-medium ${
                  pendingMatchedFav.compatibility.canDirectRunWithoutAgent ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                  {pendingMatchedFav.compatibility.headline} — {pendingMatchedFav.compatibility.detail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingMatchedFav(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pendingMatchedFav.compatibility.fileDiffs.length > 0 && (
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                <table className="w-full text-left text-[11px] tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-1.5 px-3 font-semibold">CSV File</th>
                      <th className="py-1.5 px-3 font-semibold">Column Names SHA</th>
                      <th className="py-1.5 px-3 font-semibold">Data / Rows SHA</th>
                      <th className="py-1.5 px-3 font-semibold text-right">Rows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingMatchedFav.compatibility.fileDiffs.map((fd) => (
                      <tr key={fd.fileName}>
                        <td className="py-1.5 px-3 font-medium text-slate-900">{fd.fileName}</td>
                        <td className="py-1.5 px-3">
                          <span className={`font-mono ${fd.columnsShaMatch ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}`}>
                            {fd.columnsShaMatch ? 'Match' : 'Changed'} ({fd.savedColumnsSha256.slice(0, 8)})
                          </span>
                          {!fd.columnsShaMatch && (fd.addedColumns.length > 0 || fd.removedColumns.length > 0) && (
                            <span className="block text-[10px] text-rose-600">
                              {fd.addedColumns.length > 0 ? `+${fd.addedColumns.join(', ')} ` : ''}
                              {fd.removedColumns.length > 0 ? `-${fd.removedColumns.join(', ')}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-slate-600">
                          {fd.dataShaMatch ? 'Unchanged' : 'Updated'} ({(fd.currentDataSha256 || fd.savedDataSha256).slice(0, 8)})
                        </td>
                        <td className="py-1.5 px-3 text-right text-slate-700">
                          {fd.currentRows !== undefined ? fd.currentRows.toLocaleString() : 'Missing'}
                          {fd.rowDelta !== undefined && fd.rowDelta !== 0 && (
                            <span className="text-indigo-700 font-semibold ml-1">
                              ({fd.rowDelta > 0 ? '+' : ''}{fd.rowDelta.toLocaleString()})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {pendingMatchedFav.compatibility.canDirectRunWithoutAgent && (
                <button
                  type="button"
                  disabled={isDirectReplaying}
                  onClick={() => {
                    const { fav, compatibility } = pendingMatchedFav;
                    if (compatibility.status === 'identical_data') {
                      hydrateSavedFavouriteAsResult(fav, compatibility);
                    } else {
                      runSavedFavouriteDirectlyWithoutAgent(fav, compatibility);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {pendingMatchedFav.compatibility.status === 'identical_data'
                      ? 'Load Saved Answer Now (Recommended)'
                      : 'Re-run Saved Code Without AI (Recommended)'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => hydrateSavedFavouriteAsResult(pendingMatchedFav.fav, pendingMatchedFav.compatibility)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <span>View Saved Snapshot</span>
              </button>

              <button
                type="button"
                onClick={() => handleAskQuestion(strategicQuestion, true)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  !pendingMatchedFav.compatibility.canDirectRunWithoutAgent
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-white hover:bg-slate-100 border border-slate-200 text-slate-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {!pendingMatchedFav.compatibility.canDirectRunWithoutAgent
                    ? 'Run Fresh 5-Step AI Plan (Recommended)'
                    : 'Run Brand-New AI Analysis Instead'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Advanced Prompt & Hints Options */}
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showPromptEditor ? 'Hide Advanced Prompt & Hint Options' : 'Advanced Prompt & Hint Options'}</span>
            {showPromptEditor ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showPromptEditor && (
            <div className="mt-3 space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Planner instructions for &ldquo;{EXPLORATION_STYLE_GUIDES[presetKey].shortTitle}&rdquo;
                </label>
                <textarea
                  value={metaPlannerPrompt}
                  onChange={(e) => setMetaPlannerPrompt(e.target.value)}
                  rows={4}
                  className="w-full text-xs font-mono bg-white rounded-lg border-slate-200 p-2.5 border focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Extra method hints (optional)
                </label>
                <input
                  type="text"
                  value={userGuidance}
                  onChange={(e) => setUserGuidance(e.target.value)}
                  placeholder="e.g. Use TensorFlow.js Sequential model, 80/20 train/test split, and calculate AUC-ROC"
                  className="w-full text-xs bg-white rounded-lg border-slate-200 p-2 border focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Primary Action Bar */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              Tailored for <strong className="font-medium text-slate-800">{currentAudienceConfig.shortLabel}</strong>
            </span>

            <div className="flex flex-wrap items-center gap-2.5 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => handlePlanSubQuestions()}
                disabled={isPlanning || !strategicQuestion.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title="Create the 5-step plan without running Step 1 yet"
              >
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>Plan Only</span>
              </button>

              <button
                type="button"
                onClick={() => handleAskQuestion()}
                disabled={isPlanning}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                title="Plan 5 simple steps and start checking your data"
              >
                {isPlanning ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin" />
                    <span>Building 5-Step Plan...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Plan 5 Steps</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Step Plan & Progress Cards */}
      {isPlanReady && subQuestions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Your 5-Step Plan
              </h3>
              <p className="text-xs text-slate-600 mt-1">{metaPlanOverview}</p>
            </div>

            {subQuestions.every(s => s.status === 'pending') && (
              <button
                type="button"
                onClick={() => runSingleSubQuestion(0, subQuestions)}
                disabled={isStepRunning || activeStepIndex !== null}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start Step 1</span>
              </button>
            )}
          </div>

          {/* Step Cards (1 to 5) */}
          <div className="space-y-3.5">
            {subQuestions.map((subQ, idx) => {
              const isActive = activeStepIndex === idx && isStepRunning;
              const isCompleted = subQ.status === 'completed';
              const isError = subQ.status === 'error';
              const isWaitingChoice = waitingForForwardChoice === idx;
              const stepLogOpen = !!showStepLogsMap[idx];
              const stepSimplified = simplifiedChoicesMap[subQ.stepNumber];

              return (
                <div
                  key={subQ.stepNumber}
                  className={`rounded-xl border p-5 transition-colors ${
                    isWaitingChoice
                      ? 'border-indigo-300 bg-indigo-50/20'
                      : isActive
                      ? 'border-indigo-300 bg-slate-50/60'
                      : isCompleted
                      ? 'border-emerald-200 bg-white'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`font-semibold tabular-nums ${
                          isCompleted
                            ? 'text-emerald-700'
                            : isActive
                            ? 'text-indigo-700'
                            : 'text-slate-500'
                        }`}>
                          Step {subQ.stepNumber}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <h4 className="text-sm font-semibold text-slate-900">{subQ.title}</h4>
                        {subQ.isReplanned && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-xs text-indigo-700 font-medium">Adjusted from your choice</span>
                          </>
                        )}
                      </div>

                      <p className="text-sm text-slate-800">
                        {subQ.subQuestion}
                      </p>

                      {subQ.isReplanned && subQ.replanRationale && (
                        <div className="text-xs text-slate-600 flex items-start justify-between gap-2 pt-0.5">
                          <span>
                            <strong className="font-medium text-slate-800">Why this step changed:</strong> {subQ.replanRationale}
                          </span>
                          {subQ.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleRevertStep(idx)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 underline font-medium shrink-0 cursor-pointer"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Status / Step Action */}
                    <div className="shrink-0 flex items-center gap-2">
                      {isCompleted && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Done</span>
                        </span>
                      )}
                      {isActive && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-indigo-700 font-semibold">
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          <span>Checking...</span>
                        </span>
                      )}
                      {isError && (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-700 font-semibold">
                          <AlertCircle className="w-4 h-4" />
                          <span>Error</span>
                        </span>
                      )}
                      {subQ.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => runSingleSubQuestion(idx, subQuestions)}
                          disabled={isStepRunning}
                          className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Run Step
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Completed Finding */}
                  {isCompleted && subQ.narrative && (
                    <div className="mt-3.5 pt-3.5 border-t border-slate-100 space-y-2.5">
                      <div className="text-sm text-slate-800 bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 leading-relaxed">
                        <span className="text-xs font-semibold text-slate-700 block mb-1">What we found:</span>
                        {subQ.narrative}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        {subQ.selectedChoiceLabel ? (
                          <span>
                            Next choice picked: <strong className="font-medium text-slate-800">{subQ.selectedChoiceLabel}</strong>
                          </span>
                        ) : <span />}

                        {subQ.code && (
                          <button
                            type="button"
                            onClick={() => setExpandedStepIndex(expandedStepIndex === idx ? null : idx)}
                            className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1 cursor-pointer"
                          >
                            <span>{expandedStepIndex === idx ? 'Hide Technical Code & Method' : 'Show Technical Code & Method'}</span>
                            {expandedStepIndex === idx ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>

                      {expandedStepIndex === idx && subQ.code && (
                        <div className="space-y-1.5 text-xs">
                          <div className="text-slate-600">
                            Method: <span className="font-mono text-slate-800">{subQ.plannedMethod}</span> · Goal: {subQ.objective}
                          </div>
                          <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-[11px] font-mono">
                            {subQ.code}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active Step Progress & Optional Technical Log */}
                  {isActive && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Reading your data and checking the numbers for Step {subQ.stepNumber}...</span>
                        {stepLogs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowStepLogsMap(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                          >
                            {stepLogOpen ? 'Hide live log' : 'Show live log'}
                          </button>
                        )}
                      </div>
                      {stepLogOpen && stepLogs.length > 0 && (
                        <div className="bg-slate-900 text-emerald-300 p-2.5 rounded-lg font-mono text-[11px] space-y-0.5">
                          {stepLogs.map((log, lIdx) => (
                            <div key={lIdx} className="truncate">{log}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Plain-Language Forward Choice Gate */}
                  {isWaitingChoice && subQ.forwardChoices && (
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h5 className="text-sm font-bold text-slate-900">
                            Step {subQ.stepNumber} Done — Pick What to Check Next
                          </h5>
                          <p className="text-xs text-slate-600 mt-0.5">
                            {stepSimplified?.laymanOverview || `Choose the direction that sounds most useful for Step ${subQ.stepNumber + 1}.`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleExplainInSimpleWay(idx)}
                            disabled={isSimplifyingStep === subQ.stepNumber}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 transition-colors cursor-pointer"
                          >
                            {isSimplifyingStep === subQ.stepNumber ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                                <span>Simplifying...</span>
                              </>
                            ) : (
                              <>
                                <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                                <span>{stepSimplified ? 'Refresh Plain Examples' : 'Explain Options Simply'}</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowTechnicalChoiceTerms(!showTechnicalChoiceTerms)}
                            className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                          >
                            {showTechnicalChoiceTerms ? 'Hide technical labels' : 'Show technical labels'}
                          </button>
                        </div>
                      </div>

                      {/* Choice Radio Cards */}
                      <div className="space-y-2.5">
                        {subQ.forwardChoices.map((choice, cIdx) => {
                          const simp = stepSimplified?.simplifiedChoices?.find(sc => sc.id === choice.id)
                            || stepSimplified?.simplifiedChoices?.[cIdx];
                          const isSelected = selectedForwardChoiceId === choice.id;

                          return (
                            <label
                              key={choice.id}
                              className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-indigo-50/50 border-indigo-400'
                                  : 'bg-white border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`forward-choice-${subQ.stepNumber}`}
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedForwardChoiceId(choice.id);
                                  if (replanPreview) setReplanPreview(null);
                                }}
                                className="mt-1 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <div className="space-y-1.5 w-full">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-slate-900">
                                    {simp ? simp.simpleTitle : choice.label}
                                  </span>
                                  <div className="flex items-center gap-2 text-xs">
                                    {choice.isRecommended && (
                                      <span className="text-emerald-700 font-semibold">Recommended</span>
                                    )}
                                    {isSelected && (
                                      <span className="text-indigo-700 font-semibold">Selected</span>
                                    )}
                                  </div>
                                </div>

                                {simp ? (
                                  <div className="space-y-1 text-xs text-slate-700 leading-relaxed">
                                    <p>
                                      <strong className="font-medium text-slate-900">Think of it like:</strong> {simp.simpleAnalogy}
                                    </p>
                                    <div className="flex flex-col sm:flex-row sm:gap-4 text-slate-600">
                                      <span><strong className="font-medium text-slate-800">What happens next:</strong> {simp.whatHappensNext}</span>
                                      <span><strong className="font-medium text-slate-800">Best if:</strong> {simp.bestFor}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-600 leading-relaxed">{choice.description}</p>
                                )}

                                {showTechnicalChoiceTerms && simp && (
                                  <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                                    Technical label: <span className="font-medium text-slate-700">{choice.label}</span> — {choice.description}
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {/* Optional Custom Direction */}
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Or tell us something specific to focus on (optional)
                        </label>
                        <input
                          type="text"
                          value={customForwardDirection}
                          onChange={(e) => {
                            setCustomForwardDirection(e.target.value);
                            if (replanPreview) setReplanPreview(null);
                          }}
                          placeholder="e.g. Only look at people who made more than 3 purchases"
                          className="w-full text-xs rounded-lg border-slate-200 p-2.5 border focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>

                      {/* Collapsed Advanced Re-Planning Drawer */}
                      {subQ.stepNumber < subQuestions.length && (
                        <div className="border-t border-slate-100 pt-3 space-y-3">
                          <button
                            type="button"
                            onClick={() => setShowRefinementEditor(!showRefinementEditor)}
                            className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>{showRefinementEditor ? 'Hide Advanced: Customize Next Step Plan' : 'Advanced: Customize Next Step Plan'}</span>
                            {showRefinementEditor ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>

                          {showRefinementEditor && (
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-slate-700">Adjust:</span>
                                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                                    <button
                                      type="button"
                                      onClick={() => setReplanScope('next_only')}
                                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                                        replanScope === 'next_only'
                                          ? 'bg-indigo-600 text-white'
                                          : 'text-slate-600 hover:text-slate-900'
                                      }`}
                                    >
                                      Step {subQ.stepNumber + 1} Only
                                    </button>
                                    {subQ.stepNumber < 4 && (
                                      <button
                                        type="button"
                                        onClick={() => setReplanScope('all_remaining')}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                                          replanScope === 'all_remaining'
                                            ? 'bg-indigo-600 text-white'
                                            : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                      >
                                        Steps {subQ.stepNumber + 1} to 5
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleTriggerDynamicReplan(idx)}
                                  disabled={isReplanning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                                >
                                  {isReplanning ? (
                                    <>
                                      <RotateCcw className="w-3 h-3 animate-spin" />
                                      <span>Updating Plan...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Wand2 className="w-3 h-3" />
                                      <span>Preview Updated Step {subQ.stepNumber + 1}</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              <div>
                                <label className="block font-medium text-slate-700 mb-1">
                                  Extra instructions for updating the next step (optional)
                                </label>
                                <textarea
                                  value={customRefinementInstructions}
                                  onChange={(e) => setCustomRefinementInstructions(e.target.value)}
                                  rows={2}
                                  placeholder="e.g. Focus on accuracy across small groups"
                                  className="w-full text-xs font-mono rounded-lg border-slate-200 p-2 border bg-white"
                                />
                              </div>

                              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={autoReplanOnAdvance}
                                  onChange={(e) => setAutoReplanOnAdvance(e.target.checked)}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <span>Automatically adjust Step {subQ.stepNumber + 1} using my choice above</span>
                              </label>
                            </div>
                          )}

                          {/* Preview Diff Card (shown whenever generated) */}
                          {replanPreview && replanPreview.targetStepIndex === idx + 1 && (
                            <div className="bg-white p-4 rounded-xl border border-indigo-300 space-y-3">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <span className="text-xs font-semibold text-slate-900">
                                  Preview: Updated Step {replanPreview.replannedNextStep.stepNumber}
                                </span>
                                <button
                                  type="button"
                                  onClick={handleDiscardReplanPreview}
                                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                                >
                                  Discard
                                </button>
                              </div>

                              <div className="text-xs bg-indigo-50/60 p-2.5 rounded-lg text-slate-800">
                                <strong className="font-semibold">Why this changed:</strong> {replanPreview.refinementRationale}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                                  <span className="text-[11px] font-semibold text-slate-500 block">Original Step {subQuestions[idx + 1]?.stepNumber}</span>
                                  <div className="font-medium text-slate-700 line-through">{subQuestions[idx + 1]?.title}</div>
                                  <p className="text-slate-500">{subQuestions[idx + 1]?.subQuestion}</p>
                                </div>

                                <div className="p-3 bg-indigo-50/40 rounded-lg border border-indigo-200 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-indigo-700">New Step {replanPreview.replannedNextStep.stepNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => setIsEditingPreviewQuestion(!isEditingPreviewQuestion)}
                                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                                    >
                                      {isEditingPreviewQuestion ? 'Done' : 'Edit'}
                                    </button>
                                  </div>
                                  <div className="font-semibold text-slate-900">{replanPreview.replannedNextStep.title}</div>
                                  {isEditingPreviewQuestion ? (
                                    <textarea
                                      value={replanPreview.replannedNextStep.subQuestion}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setReplanPreview(prev => prev ? {
                                          ...prev,
                                          replannedNextStep: { ...prev.replannedNextStep, subQuestion: val }
                                        } : null);
                                      }}
                                      rows={2}
                                      className="w-full text-xs rounded border-indigo-300 p-2 border bg-white"
                                    />
                                  ) : (
                                    <p className="text-slate-800">{replanPreview.replannedNextStep.subQuestion}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleTriggerDynamicReplan(idx)}
                                  disabled={isReplanning}
                                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium cursor-pointer"
                                >
                                  Try Another
                                </button>
                                <button
                                  type="button"
                                  onClick={handleAcceptReplanPreview}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Use This Plan</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Gate Action Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          {autoProgress && autoProgressCountdown !== null ? (
                            <div className="flex items-center gap-2 tabular-nums">
                              <Timer className="w-3.5 h-3.5 text-amber-600" />
                              <span>Moving on in <strong>{autoProgressCountdown}s</strong></span>
                              <button
                                type="button"
                                onClick={() => setIsAutoPaused(!isAutoPaused)}
                                className="underline font-medium text-slate-800 cursor-pointer"
                              >
                                {isAutoPaused ? 'Resume' : 'Pause'}
                              </button>
                            </div>
                          ) : (
                            <span>
                              {subQ.stepNumber < subQuestions.length
                                ? `Ready for Step ${subQ.stepNumber + 1}`
                                : 'All 5 steps finished — ready to summarize'}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                          {subQ.stepNumber < subQuestions.length && (
                            <button
                              type="button"
                              onClick={() => handleConfirmForwardChoice(false)}
                              disabled={isStepRunning || isReplanning}
                              className="px-3 py-2 text-xs text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 font-medium rounded-lg transition-colors cursor-pointer"
                            >
                              Keep Original Plan
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleConfirmForwardChoice(true)}
                            disabled={isStepRunning || isReplanning}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {isReplanning ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                                <span>Preparing Step {subQ.stepNumber + 1}...</span>
                              </>
                            ) : (
                              <>
                                <span>
                                  {subQ.stepNumber < subQuestions.length
                                    ? (autoProgress && autoProgressCountdown !== null
                                        ? `Next: Run Step ${subQ.stepNumber + 1} (${autoProgressCountdown}s)`
                                        : `Next: Run Step ${subQ.stepNumber + 1}`)
                                    : (autoProgress && autoProgressCountdown !== null
                                        ? `Synthesize Master Dossier (${autoProgressCountdown}s)`
                                        : 'Synthesize Master Dossier')}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Strategic Master Dossier Trigger Banner when >=2 steps completed */}
          {completedStepsCount >= 2 && !finalDossier && (
            <div className="flex flex-col gap-3.5 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-semibold text-slate-900 block tabular-nums">
                    {completedStepsCount === 5
                      ? 'All 5 steps are done — ready for your Strategic Master Dossier!'
                      : `${completedStepsCount} of 5 steps finished`}
                  </span>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Pick who will read this Dossier, then synthesize progressive evidence, recommendations, and an actionable roadmap.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleSynthesizeMasterDossier()}
                  disabled={isSynthesizing}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                >
                  {isSynthesizing ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      <span>Building Master Dossier...</span>
                    </>
                  ) : (
                    <>
                      <Award className="w-4 h-4" />
                      <span>Synthesize Master Dossier</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Dossier Persona Picker before synthesis */}
              <div className="pt-3 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 shrink-0">
                  Dossier audience persona:
                </span>
                <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-white rounded-lg border border-slate-200">
                  {TARGET_AUDIENCES.map((aud) => (
                    <button
                      key={aud.id}
                      type="button"
                      onClick={() => setTargetAudience(aud.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        targetAudience === aud.id
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                      title={aud.description}
                    >
                      {aud.shortLabel}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Direct Replay / Cached Result Notice */}
      {replayNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{replayNotice.message}</p>
              {replayNotice.savedTimestamp && (
                <p className="text-[11px] text-emerald-700 mt-0.5 tabular-nums">
                  Based on saved run from {new Date(replayNotice.savedTimestamp).toLocaleString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {replayNotice.type === 'direct_rerun' && finalDossier && (
              <button
                type="button"
                onClick={() => handleSynthesizeMasterDossier()}
                disabled={isSynthesizing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isSynthesizing ? 'Polishing...' : 'Polish Narrative with AI'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleAskQuestion(strategicQuestion, true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Run Fresh AI Instead</span>
            </button>
          </div>
        </div>
      )}

      {/* Strategic Master Dossier */}
      {finalDossier && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          {/* Header & Actions */}
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-emerald-600 shrink-0" />
                  <h3 className="text-lg font-bold text-slate-900">
                    Strategic Master Dossier
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-1 tabular-nums">
                  <span>
                    Confidence: <strong className="font-semibold text-emerald-700">{finalDossier.confidenceScore}%</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className="font-semibold text-slate-900">{completedStepsCount} / 5</strong> steps checked
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Tailored for <strong className="font-semibold text-indigo-700">{(TARGET_AUDIENCES.find(a => a.id === (finalDossier.targetAudience || targetAudience)) || currentAudienceConfig).shortLabel}</strong>
                  </span>
                </div>
              </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsClarityModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                title="Open Dossier Studio to ask follow-up questions, create charts, or customize your HTML dossier"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Dossier Studio &amp; Q&amp;A{clarityItems.length > 0 ? ` (${clarityItems.length})` : ''}</span>
              </button>

              {onFeedToAnswerConsistency && (
                <button
                  type="button"
                  onClick={handleFeedToAnswerConsistency}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  title="Send this dossier to Answer Consistency to verify across 5 methods"
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>Double-Check Consistency</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleDownloadStrategicReport(undefined, undefined, reportPersona)}
                disabled={isPreparingHtmlReport}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                title="Download full Tailored Dossier as HTML"
              >
                {isPreparingHtmlReport ? (
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>{isPreparingHtmlReport ? 'Preparing HTML...' : 'Download Dossier (HTML)'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCustomFilename(`Strategic_Dossier_${reportPersona}_${(strategicQuestion || 'Report').slice(0, 24).replace(/[^a-zA-Z0-9]/g, '_')}.html`);
                  setIsCustomReportModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                title="Choose persona, dossier sections, sequence, and filename"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                <span>Custom Dossier</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadCurrentJson}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                title="Download Query, Steps, Code, Answer & Dual CSV SHA-256 hashes as JSON"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Download JSON</span>
              </button>

              <button
                type="button"
                onClick={handleSaveToFavourites}
                disabled={isSavingFav || favSaved}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  favSaved
                    ? 'bg-amber-50 border-amber-200 text-amber-800 font-semibold'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title="Save Query, Steps, Code, Answer & Dual CSV SHA-256 hashes to Favourites"
              >
                <Star className={`w-3.5 h-3.5 ${favSaved ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
                <span>{favSaved ? `Saved (${csvFingerprints.length} SHAs)` : isSavingFav ? 'Saving...' : 'Save to Favourites'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {copySuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copySuccess ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            </div>

            {/* Instant Persona Re-Tailoring Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
              <div className="text-xs text-slate-700">
                <span className="font-semibold text-slate-900">Dossier Persona:</span>{' '}
                <span className="text-slate-600">Switch who this dossier is written for and re-tailor it anytime.</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {TARGET_AUDIENCES.map((aud) => {
                  const isCurrentDossierPersona = (finalDossier.targetAudience || targetAudience) === aud.id;
                  return (
                    <button
                      key={aud.id}
                      type="button"
                      disabled={isSynthesizing}
                      onClick={() => handleSynthesizeMasterDossier(undefined, aud.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        isCurrentDossierPersona
                          ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-200'
                      }`}
                      title={aud.description}
                    >
                      {aud.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {feedSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 flex items-center gap-2 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Sent to <strong>Answer Consistency</strong> so you can double-check it across 5 independent checks!</span>
            </div>
          )}

          {/* 1. Strategic Verdict & Executive Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">
              1. Strategic Verdict &amp; Executive Summary
            </h4>
            <div className="p-3.5 bg-white rounded-lg border border-emerald-200 text-sm font-semibold text-slate-900 leading-relaxed">
              {finalDossier.strategicVerdict}
            </div>
            <div className="text-sm text-slate-700 leading-relaxed space-y-2">
              {finalDossier.executiveSummary.split('\n\n').map((para, pIdx) => (
                <p key={pIdx}>{para}</p>
              ))}
            </div>
          </div>

          {/* 2. Progressive Evidence Matrix */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900">
              2. Progressive Evidence Matrix (5-Step Findings)
            </h4>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Step</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Experiment &amp; Question</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Key Empirical Finding</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Strategic Impact &amp; Decision</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {subQuestions.filter(s => s.status === 'completed').map((s) => {
                    const ev = (finalDossier.progressiveEvidence || []).find(e => e.stepNumber === s.stepNumber);
                    return (
                      <tr key={s.stepNumber} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-semibold text-indigo-700 tabular-nums whitespace-nowrap">Step {s.stepNumber}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-900 block">{ev?.stepTitle || s.title}</span>
                          <span className="text-[11px] text-slate-500">{s.subQuestion}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 leading-relaxed">{ev?.keyFinding || s.narrative || 'Checked'}</td>
                        <td className="px-4 py-3 text-slate-700 leading-relaxed">
                          <span className="font-medium text-slate-900 block">{s.selectedChoiceLabel || 'Standard path'}</span>
                          {ev?.strategicImpact && (
                            <span className="text-[11px] text-slate-500">{ev.strategicImpact}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. What to Do Next */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  3. What to Do Next
                </h4>
                <p className="text-xs text-slate-600 mt-0.5">
                  Simple action steps based on what we discovered. Open technical notes only if you want exact column names or prompts.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowColumnReferenceBank(!showColumnReferenceBank)}
                className="text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>{showColumnReferenceBank ? 'Hide File Columns' : 'See File Columns'}</span>
              </button>
            </div>

            {showColumnReferenceBank && (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="text-xs font-medium text-slate-700 block">
                  Columns in your files (click any name to copy):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {getAvailableColumns().map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(col);
                        setCopiedColumnName(col);
                        setTimeout(() => setCopiedColumnName(null), 2000);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-slate-800 hover:text-indigo-800 text-xs font-mono rounded-md border border-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Click to copy column name"
                    >
                      <span>{col}</span>
                      {copiedColumnName === col && <Check className="w-3 h-3 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {(finalDossier.richRecommendations || []).map((rec, rIdx) => {
                const recKey = rec.id || `rec-${rIdx}`;
                const isTechOpen = !!showTechNextStepsMap[recKey];

                return (
                  <div key={recKey} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-semibold text-xs flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                          {rIdx + 1}
                        </span>
                        <div>
                          <h5 className="text-sm font-semibold text-slate-900">{rec.title}</h5>
                          <p className="text-sm text-slate-700 leading-relaxed mt-1">
                            {rec.easyVersion}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowTechNextStepsMap(prev => ({ ...prev, [recKey]: !prev[recKey] }))}
                        className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        {isTechOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <span>{isTechOpen ? 'Hide Technical Details & Follow-Up Prompt' : 'Technical Details, Columns & Follow-Up Prompt'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setStrategicQuestion(rec.copyPasteableQuestion);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-xs px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <ArrowRight className="w-3 h-3" />
                        <span>Ask This Next</span>
                      </button>
                    </div>

                    {isTechOpen && (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
                        <div>
                          <span className="font-semibold text-slate-800 block mb-0.5">Technical Notes</span>
                          <p className="text-slate-700 leading-relaxed">{rec.technicalInfo}</p>
                        </div>

                        {rec.columnNames && rec.columnNames.length > 0 && (
                          <div>
                            <span className="font-semibold text-slate-800 block mb-1">Data Columns Used (click to copy)</span>
                            <div className="flex flex-wrap gap-1.5">
                              {rec.columnNames.map((col) => (
                                <button
                                  key={col}
                                  type="button"
                                  onClick={async () => {
                                    await navigator.clipboard.writeText(col);
                                    setCopiedColumnName(col);
                                    setTimeout(() => setCopiedColumnName(null), 2000);
                                  }}
                                  className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-800 border border-slate-200 rounded font-mono flex items-center gap-1 cursor-pointer"
                                >
                                  <span>{col}</span>
                                  {copiedColumnName === col ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800">Ready-to-Use Follow-Up Question</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(rec.copyPasteableQuestion);
                                  setCopiedPromptId(rec.id);
                                  setTimeout(() => setCopiedPromptId(null), 2500);
                                }}
                                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium rounded-md flex items-center gap-1 cursor-pointer"
                              >
                                {copiedPromptId === rec.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedPromptId === rec.id ? 'Copied' : 'Copy'}</span>
                              </button>
                              {onFeedToAnswerConsistency && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onFeedToAnswerConsistency({
                                      question: rec.copyPasteableQuestion,
                                      guidance: `Strategic Recommendation from Answer Strategically:
Title: ${rec.title}
Target Audience: ${currentAudienceConfig.label}
Plain Translation: ${rec.easyVersion}
Technical Methodology: ${rec.technicalInfo}
Specific Columns: ${rec.columnNames.join(', ')}

Instructions for Answer Consistency:
Evaluate whether this specific recommendation and prompt ("${rec.copyPasteableQuestion}") is statistically invariant and consistent across 5 independent analytical methods.`,
                                      source: 'strategic_dossier'
                                    });
                                  }}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md flex items-center gap-1 cursor-pointer"
                                >
                                  <Scale className="w-3 h-3" />
                                  <span>Double-Check Consistency</span>
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="p-2.5 bg-slate-900 rounded-lg text-sky-200 font-mono text-xs select-all leading-relaxed">
                            {rec.copyPasteableQuestion}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Implementation Roadmap */}
          {finalDossier.implementationRoadmap && finalDossier.implementationRoadmap.length > 0 && (
            <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 space-y-2.5">
              <h4 className="text-sm font-bold text-slate-900">
                4. Implementation Roadmap
              </h4>
              <ol className="space-y-1.5 text-xs text-slate-700">
                {finalDossier.implementationRoadmap.map((phase, pIdx) => (
                  <li key={pIdx} className="flex items-start gap-2 leading-relaxed">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 font-semibold text-[11px] flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                      {pIdx + 1}
                    </span>
                    <span>{phase}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 5. Risks, Caveats & Things to Keep in Mind */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-1">
            <div className="font-semibold text-slate-900">5. Risks, Caveats &amp; Things to Keep in Mind</div>
            <p className="leading-relaxed">{finalDossier.risksAndCaveats}</p>
          </div>

          {/* 6. Tailored Dossier Studio & Strategic Clarification */}
          <div className="border border-slate-200 rounded-xl p-5 bg-white">
            {renderClarityStudioContent(false)}
          </div>
        </div>
      )}

      {/* Tailored Dossier Studio & Strategic Clarification Modal */}
      {isClarityModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-white shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Tailored Dossier Studio &amp; Strategic Clarification
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Ask for simpler explanations, create charts, or customize your downloadable Strategic Master Dossier.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsClarityModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-50/50">
              {renderClarityStudioContent(true)}
            </div>
          </div>
        </div>
      )}

      {/* Custom Report Download Modal */}
      {isCustomReportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-white shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Pick What Goes Into Your Report
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Check the sections you want, change their order, and pick a filename.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomReportModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Report Audience Persona Picker */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-xs font-semibold text-slate-800">
                    HTML Report Audience Persona
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Adapts language, takeaways &amp; badges in the downloaded HTML file
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {TARGET_AUDIENCES.map((aud) => (
                    <button
                      key={aud.id}
                      type="button"
                      onClick={() => setReportPersona(aud.id)}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                        reportPersona === aud.id
                          ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block font-semibold">{aud.shortLabel}</span>
                      <span className={`block text-[11px] mt-0.5 leading-snug ${reportPersona === aud.id ? 'text-indigo-100' : 'text-slate-500'}`}>
                        {aud.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  File name
                </label>
                <input
                  type="text"
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  placeholder="Strategic_Tailored_Report.html"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={startExpandedInCustomReport}
                  onChange={(e) => setStartExpandedInCustomReport(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                />
                <span>Start collapsible sections expanded in the downloaded HTML file</span>
              </label>

              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-2">
                  Sections &amp; order
                </span>
                <div className="space-y-2">
                  {customSections.map((sec, idx) => (
                    <div
                      key={sec.id}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                        sec.enabled ? 'bg-white border-indigo-200' : 'bg-slate-50 border-slate-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={sec.enabled}
                          onChange={() => {
                            const updated = [...customSections];
                            updated[idx].enabled = !updated[idx].enabled;
                            setCustomSections(updated);
                          }}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <span className="text-xs font-semibold text-slate-900 block">{sec.label}</span>
                          <span className="text-[11px] text-slate-500">{sec.shortDesc}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[11px] font-mono text-slate-500 px-1.5 tabular-nums">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (idx === 0) return;
                            const updated = [...customSections];
                            const temp = updated[idx];
                            updated[idx] = updated[idx - 1];
                            updated[idx - 1] = temp;
                            setCustomSections(updated);
                          }}
                          disabled={idx === 0}
                          className="p-1 text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded disabled:opacity-30 cursor-pointer"
                          title="Move Up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (idx === customSections.length - 1) return;
                            const updated = [...customSections];
                            const temp = updated[idx];
                            updated[idx] = updated[idx + 1];
                            updated[idx + 1] = temp;
                            setCustomSections(updated);
                          }}
                          disabled={idx === customSections.length - 1}
                          className="p-1 text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded disabled:opacity-30 cursor-pointer"
                          title="Move Down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsCustomReportModalOpen(false)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPreparingHtmlReport}
                onClick={async () => {
                  await handleDownloadStrategicReport(
                    customSections,
                    customFilename || `Strategic_Dossier_${reportPersona}.html`,
                    reportPersona
                  );
                  setIsCustomReportModalOpen(false);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {isPreparingHtmlReport ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin" />
                    <span>Tailoring HTML Report...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Custom HTML Report</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Strategic Favourite JSON Inspector Modal */}
      {inspectingFavJson && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Saved Strategic Favourite JSON</h3>
                <p className="text-xs text-slate-600 mt-0.5 truncate max-w-xl">{inspectingFavJson.userQuery}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingFavJson(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 bg-slate-950">
              <pre className="text-xs font-mono text-emerald-300 whitespace-pre-wrap break-words">
                {serializeStrategicFavouriteToJson(inspectingFavJson)}
              </pre>
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(serializeStrategicFavouriteToJson(inspectingFavJson));
                    setJsonCopySuccess(true);
                    setTimeout(() => setJsonCopySuccess(false), 2000);
                  } catch {}
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
              >
                {jsonCopySuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{jsonCopySuccess ? 'Copied JSON' : 'Copy JSON'}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadStrategicFavouriteJson(inspectingFavJson)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download JSON File</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
