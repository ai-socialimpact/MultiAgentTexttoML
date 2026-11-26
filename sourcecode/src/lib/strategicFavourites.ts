import Papa from 'papaparse';
import { DataAgentEngine } from './DataAgentEngine';
import { localDb } from './localDb';

export interface CsvFingerprint {
  fileName: string;
  columnsSha256: string;
  dataSha256: string;
  rowCount: number;
  columns: string[];
}

export interface StrategicFavouriteStep {
  stepNumber: number;
  title: string;
  subQuestion: string;
  plannedMethod: string;
  code: string;
  status: string;
  narrative: string;
  metrics?: Record<string, any>;
  result?: any;
}

export interface StrategicDossierAnswerSnapshot {
  strategicVerdict: string;
  executiveSummary: string;
  confidenceScore: number;
  strategicRecommendations: string[];
  risksAndCaveats: string;
  implementationRoadmap?: string[];
  progressiveEvidence?: Array<{
    stepNumber: number;
    stepTitle: string;
    keyFinding: string;
    strategicImpact: string;
  }>;
}

export interface StrategicFavouriteBundle {
  id?: string;
  schemaVersion: string;
  favouriteType: 'strategic_dossier';
  projectId: string;
  userId: string;
  timestamp: string;
  userQuery: string;
  refinedUserQuery: string;
  explorationMode: string;
  audiencePersona: string;
  metaPlanOverview?: string;
  csvFingerprints: CsvFingerprint[];
  strategicSteps: StrategicFavouriteStep[];
  dossierSnapshot: StrategicDossierAnswerSnapshot;
  // Standard compatibility fields for Favourites & FastTrack views
  narrative: string;
  analysisPlan: string[];
  generatedCode: string[];
  analysisResult: string;
  feedback?: string;
}

export type CsvCompatibilityStatus =
  | 'identical_data'
  | 'columns_intact_data_changed'
  | 'columns_changed'
  | 'missing_files'
  | 'no_saved_hashes';

export interface CsvFileCompatibilityDiff {
  fileName: string;
  status: 'identical' | 'rows_changed_columns_intact' | 'columns_changed' | 'missing_in_current';
  savedColumnsSha256: string;
  currentColumnsSha256?: string;
  columnsShaMatch: boolean;
  savedDataSha256: string;
  currentDataSha256?: string;
  dataShaMatch: boolean;
  savedRows: number;
  currentRows?: number;
  rowDelta?: number;
  addedColumns: string[];
  removedColumns: string[];
}

export interface CsvCompatibilityReport {
  status: CsvCompatibilityStatus;
  canDirectRunWithoutAgent: boolean;
  recommendedAction: 'load_cached' | 'rerun_saved_code' | 'run_fresh_ai';
  headline: string;
  detail: string;
  totalSavedRows: number;
  totalCurrentRows: number;
  totalRowDelta: number;
  fileDiffs: CsvFileCompatibilityDiff[];
}

export interface ReplayStepOutput {
  stepNumber: number;
  title: string;
  status: 'completed' | 'error';
  code: string;
  result?: any;
  metrics?: Record<string, any>;
  logs: string[];
  durationMs: number;
  error?: string;
  previousMetrics?: Record<string, any>;
  metricChanges: Array<{
    key: string;
    previousValue: string | number;
    currentValue: string | number;
    deltaText?: string;
  }>;
}

export interface ReplayExecutionSummary {
  allSucceeded: boolean;
  failedStepNumber?: number;
  errorMessage?: string;
  totalDurationMs: number;
  steps: ReplayStepOutput[];
}

/**
 * Computes hex SHA-256 digest of any string using Web Crypto API.
 */
export async function sha256Hex(input: string): Promise<string> {
  const normalized = input ?? '';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback deterministic FNV-1a 64-bit hex expansion only if crypto.subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes both Column Names SHA-256 and Full Data SHA-256 for a CSV file.
 */
export async function computeCsvFingerprint(
  fileName: string,
  rawCsvText: string,
  parsedRows: any[],
  parsedColumns?: string[]
): Promise<CsvFingerprint> {
  const columns = (
    parsedColumns && parsedColumns.length > 0
      ? parsedColumns
      : parsedRows.length > 0
      ? Object.keys(parsedRows[0] || {})
      : []
  )
    .map((c) => String(c || '').trim())
    .filter((c) => c.length > 0 && !c.startsWith('__'));

  const canonicalHeaderString = columns.join('|');
  const normalizedCsvContent = rawCsvText.replace(/\r\n/g, '\n').trim();

  const [columnsSha256, dataSha256] = await Promise.all([
    sha256Hex(canonicalHeaderString),
    sha256Hex(normalizedCsvContent)
  ]);

  return {
    fileName,
    columnsSha256,
    dataSha256,
    rowCount: parsedRows.length,
    columns
  };
}

/**
 * Loads CSV datasets for a project from localDb or URL and computes dual SHA-256 fingerprints.
 */
export async function loadProjectCsvsWithFingerprints(project: {
  projectId: string;
  dataFiles?: Array<{ name: string; url: string }>;
}): Promise<{
  datasets: Record<string, any[]>;
  fingerprints: CsvFingerprint[];
  totalRows: number;
}> {
  const datasets: Record<string, any[]> = {};
  const fingerprints: CsvFingerprint[] = [];
  let totalRows = 0;

  const csvFiles = (project.dataFiles || []).filter((f) =>
    f.name.toLowerCase().endsWith('.csv')
  );

  for (const file of csvFiles) {
    let text = '';
    if (file.url.startsWith('local://')) {
      const fileName = file.url.replace('local://', '');
      const localFile = await localDb.files
        .where({ projectId: project.projectId, name: fileName })
        .first();
      if (localFile) {
        text =
          localFile.content instanceof Blob
            ? await localFile.content.text()
            : String(localFile.content || '');
      }
    } else {
      const resp = await fetch(file.url);
      text = await resp.text();
    }

    if (text) {
      const parsed = Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
      });
      const clean = (parsed.data as any[]).filter((r: any) =>
        Object.values(r || {}).some((v) => v !== null && v !== '')
      );
      datasets[file.name] = clean;
      totalRows += clean.length;

      const fp = await computeCsvFingerprint(
        file.name,
        text,
        clean,
        parsed.meta?.fields
      );
      fingerprints.push(fp);
    }
  }

  return { datasets, fingerprints, totalRows };
}

/**
 * Normalizes query text for exact comparison (case-insensitive, punctuation-tolerant, whitespace-collapsed).
 */
export function normalizeQueryText(query: string): string {
  return (query || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isExactQueryMatch(q1: string, q2: string): boolean {
  const n1 = normalizeQueryText(q1);
  const n2 = normalizeQueryText(q2);
  return n1.length > 0 && n1 === n2;
}

/**
 * Evaluates dual SHA-256 compatibility between saved CSV fingerprints and currently loaded CSV files.
 */
export function evaluateCsvCompatibility(
  savedFingerprints: CsvFingerprint[] | undefined,
  liveFingerprints: CsvFingerprint[]
): CsvCompatibilityReport {
  const saved = Array.isArray(savedFingerprints) ? savedFingerprints : [];

  if (saved.length === 0) {
    return {
      status: 'no_saved_hashes',
      canDirectRunWithoutAgent: liveFingerprints.length > 0,
      recommendedAction: 'rerun_saved_code',
      headline: 'No CSV SHA fingerprints stored on this legacy item',
      detail: 'Confirm before re-running saved code on the current CSV files.',
      totalSavedRows: 0,
      totalCurrentRows: liveFingerprints.reduce((acc, f) => acc + (f.rowCount || 0), 0),
      totalRowDelta: 0,
      fileDiffs: []
    };
  }

  const liveMap = new Map<string, CsvFingerprint>();
  liveFingerprints.forEach((f) => liveMap.set(f.fileName, f));

  const fileDiffs: CsvFileCompatibilityDiff[] = [];
  let hasMissing = false;
  let hasColumnChange = false;
  let hasDataChange = false;
  let totalSavedRows = 0;
  let totalCurrentRows = 0;

  for (const s of saved) {
    totalSavedRows += s.rowCount || 0;
    const live = liveMap.get(s.fileName);

    if (!live) {
      hasMissing = true;
      fileDiffs.push({
        fileName: s.fileName,
        status: 'missing_in_current',
        savedColumnsSha256: s.columnsSha256,
        columnsShaMatch: false,
        savedDataSha256: s.dataSha256,
        dataShaMatch: false,
        savedRows: s.rowCount || 0,
        addedColumns: [],
        removedColumns: s.columns || []
      });
      continue;
    }

    totalCurrentRows += live.rowCount || 0;
    const columnsShaMatch = s.columnsSha256 === live.columnsSha256;
    const dataShaMatch = s.dataSha256 === live.dataSha256;

    const savedColSet = new Set(s.columns || []);
    const liveColSet = new Set(live.columns || []);
    const addedColumns = (live.columns || []).filter((c) => !savedColSet.has(c));
    const removedColumns = (s.columns || []).filter((c) => !liveColSet.has(c));

    if (!columnsShaMatch) {
      hasColumnChange = true;
    } else if (!dataShaMatch) {
      hasDataChange = true;
    }

    fileDiffs.push({
      fileName: s.fileName,
      status: !columnsShaMatch
        ? 'columns_changed'
        : !dataShaMatch
        ? 'rows_changed_columns_intact'
        : 'identical',
      savedColumnsSha256: s.columnsSha256,
      currentColumnsSha256: live.columnsSha256,
      columnsShaMatch,
      savedDataSha256: s.dataSha256,
      currentDataSha256: live.dataSha256,
      dataShaMatch,
      savedRows: s.rowCount || 0,
      currentRows: live.rowCount || 0,
      rowDelta: (live.rowCount || 0) - (s.rowCount || 0),
      addedColumns,
      removedColumns
    });
  }

  const totalRowDelta = totalCurrentRows - totalSavedRows;

  if (hasMissing) {
    return {
      status: 'missing_files',
      canDirectRunWithoutAgent: false,
      recommendedAction: 'run_fresh_ai',
      headline: 'Saved CSV file is missing in this project',
      detail: 'One or more CSV files used when this query was saved are not currently loaded.',
      totalSavedRows,
      totalCurrentRows,
      totalRowDelta,
      fileDiffs
    };
  }

  if (hasColumnChange) {
    return {
      status: 'columns_changed',
      canDirectRunWithoutAgent: false,
      recommendedAction: 'run_fresh_ai',
      headline: 'Column Names SHA changed — schema review required',
      detail:
        'CSV column names changed since this favourite was saved. We recommend running a fresh AI analysis so code uses the new column names safely.',
      totalSavedRows,
      totalCurrentRows,
      totalRowDelta,
      fileDiffs
    };
  }

  if (hasDataChange) {
    const deltaLabel =
      totalRowDelta > 0
        ? `+${totalRowDelta.toLocaleString()} new rows`
        : totalRowDelta < 0
        ? `${totalRowDelta.toLocaleString()} rows`
        : 'row values updated';
    return {
      status: 'columns_intact_data_changed',
      canDirectRunWithoutAgent: true,
      recommendedAction: 'rerun_saved_code',
      headline: `Recommended: Column Names SHA matches (${deltaLabel}) — safe to re-run saved code`,
      detail:
        'All CSV column names are intact while data rows changed. Saved JavaScript code can re-run directly without the Agentic workflow.',
      totalSavedRows,
      totalCurrentRows,
      totalRowDelta,
      fileDiffs
    };
  }

  return {
    status: 'identical_data',
    canDirectRunWithoutAgent: true,
    recommendedAction: 'load_cached',
    headline: 'Column Names SHA & Data SHA both match identically',
    detail: 'CSV files are unchanged since this run was saved. Saved results are 100% current.',
    totalSavedRows,
    totalCurrentRows,
    totalRowDelta: 0,
    fileDiffs
  };
}

/**
 * Recursively removes undefined values and compacts large arrays/results so Firestore writes remain well under 1MB.
 */
export function sanitizeForFirestore(val: any, depth: number = 0): any {
  if (val === undefined) return null;
  if (val === null || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') {
    if (typeof val === 'string' && val.length > 40000) {
      return val.slice(0, 40000) + '... [truncated]';
    }
    return val;
  }
  if (depth > 8) return String(val).slice(0, 500);
  if (Array.isArray(val)) {
    const capped = val.length > 60 ? val.slice(0, 60) : val;
    return capped.map((item) => sanitizeForFirestore(item, depth + 1));
  }
  if (typeof val === 'object') {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        clean[k] = sanitizeForFirestore(v, depth + 1);
      }
    }
    return clean;
  }
  return String(val);
}

/**
 * Extracts compact key scalar metrics from a step execution result for quick delta comparison.
 */
export function extractStepMetrics(result: any): Record<string, any> {
  if (!result || typeof result !== 'object') {
    return result !== undefined && result !== null ? { value: result } : {};
  }
  const metrics: Record<string, any> = {};
  for (const [key, val] of Object.entries(result)) {
    if (key === 'chartSpec' || key === 'rows' || key === 'data' || key === 'table') continue;
    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      metrics[key] = val;
    } else if (Array.isArray(val) && (key === 'labels' || key === 'values') && val.length <= 15) {
      metrics[key] = val;
    }
  }
  if (Array.isArray(result.labels) && Array.isArray(result.values) && result.labels.length > 0) {
    metrics.topLabel = `${result.labels[0]}: ${result.values[0]}`;
  }
  return metrics;
}

/**
 * Replays saved step code sequentially via DataAgentEngine WITHOUT calling any AI agent / LLM.
 */
export async function replayStrategicStepsWithoutAgent(
  steps: StrategicFavouriteStep[],
  datasets: Record<string, any[]>,
  onStepProgress?: (stepNumber: number, status: 'running' | 'completed' | 'error', output?: ReplayStepOutput) => void
): Promise<ReplayExecutionSummary> {
  const startedAt = Date.now();
  const outputs: ReplayStepOutput[] = [];
  let allSucceeded = true;
  let failedStepNumber: number | undefined;
  let errorMessage: string | undefined;

  for (const step of steps) {
    const logs: string[] = [];
    const stepStart = Date.now();
    if (onStepProgress) {
      onStepProgress(step.stepNumber, 'running');
    }

    if (!step.code || !step.code.trim()) {
      const out: ReplayStepOutput = {
        stepNumber: step.stepNumber,
        title: step.title,
        status: 'error',
        code: '',
        logs: ['No saved JavaScript code found for this step.'],
        durationMs: 0,
        error: 'No saved JavaScript code found for this step.',
        previousMetrics: step.metrics,
        metricChanges: []
      };
      outputs.push(out);
      allSucceeded = false;
      failedStepNumber = step.stepNumber;
      errorMessage = out.error;
      if (onStepProgress) onStepProgress(step.stepNumber, 'error', out);
      continue;
    }

    try {
      const engine = new DataAgentEngine();
      const freshResult = await engine.runAnalysis(step.code, datasets, (msg) => {
        logs.push(msg);
      });
      const freshMetrics = extractStepMetrics(freshResult);
      const prevMetrics = step.metrics || {};

      const metricChanges: ReplayStepOutput['metricChanges'] = [];
      const seenKeys = new Set([...Object.keys(prevMetrics), ...Object.keys(freshMetrics)]);
      for (const k of seenKeys) {
        const pv = prevMetrics[k];
        const cv = freshMetrics[k];
        if (
          (typeof pv === 'number' || typeof pv === 'string') &&
          (typeof cv === 'number' || typeof cv === 'string')
        ) {
          let deltaText: string | undefined;
          if (typeof pv === 'number' && typeof cv === 'number') {
            const diff = cv - pv;
            if (diff !== 0) {
              deltaText = `${diff > 0 ? '+' : ''}${Number.isInteger(diff) ? diff : diff.toFixed(2)}`;
            } else {
              deltaText = 'No change';
            }
          }
          metricChanges.push({
            key: k,
            previousValue: pv,
            currentValue: cv,
            deltaText
          });
        }
      }

      const out: ReplayStepOutput = {
        stepNumber: step.stepNumber,
        title: step.title,
        status: 'completed',
        code: step.code,
        result: freshResult,
        metrics: freshMetrics,
        logs,
        durationMs: Date.now() - stepStart,
        previousMetrics: prevMetrics,
        metricChanges
      };
      outputs.push(out);
      if (onStepProgress) onStepProgress(step.stepNumber, 'completed', out);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const out: ReplayStepOutput = {
        stepNumber: step.stepNumber,
        title: step.title,
        status: 'error',
        code: step.code,
        logs,
        durationMs: Date.now() - stepStart,
        error: msg,
        previousMetrics: step.metrics,
        metricChanges: []
      };
      outputs.push(out);
      allSucceeded = false;
      if (!failedStepNumber) {
        failedStepNumber = step.stepNumber;
        errorMessage = msg;
      }
      if (onStepProgress) onStepProgress(step.stepNumber, 'error', out);
    }
  }

  return {
    allSucceeded,
    failedStepNumber,
    errorMessage,
    totalDurationMs: Date.now() - startedAt,
    steps: outputs
  };
}

/**
 * Builds canonical JSON export representation matching Query, Steps, Code, Answer, and Dual CSV SHAs.
 */
export function serializeStrategicFavouriteToJson(bundle: StrategicFavouriteBundle): string {
  const canonical = {
    schemaVersion: bundle.schemaVersion || '1.0',
    favouriteType: bundle.favouriteType || 'strategic_dossier',
    savedAt: bundle.timestamp,
    query: bundle.userQuery,
    refinedQuery: bundle.refinedUserQuery,
    explorationMode: bundle.explorationMode,
    audiencePersona: bundle.audiencePersona,
    metaPlanOverview: bundle.metaPlanOverview || '',
    csvFingerprints: (bundle.csvFingerprints || []).map((f) => ({
      fileName: f.fileName,
      columnsSha256: f.columnsSha256,
      dataSha256: f.dataSha256,
      rowCount: f.rowCount,
      columns: f.columns
    })),
    steps: (bundle.strategicSteps || []).map((s) => ({
      stepNumber: s.stepNumber,
      title: s.title,
      subQuestion: s.subQuestion,
      plannedMethod: s.plannedMethod,
      code: s.code,
      status: s.status,
      narrative: s.narrative,
      metrics: s.metrics || {},
      result: s.result || null
    })),
    answer: {
      strategicVerdict: bundle.dossierSnapshot?.strategicVerdict || '',
      executiveSummary: bundle.dossierSnapshot?.executiveSummary || '',
      confidenceScore: bundle.dossierSnapshot?.confidenceScore ?? 0,
      progressiveEvidence: bundle.dossierSnapshot?.progressiveEvidence || [],
      strategicRecommendations: bundle.dossierSnapshot?.strategicRecommendations || [],
      implementationRoadmap: bundle.dossierSnapshot?.implementationRoadmap || [],
      risksAndCaveats: bundle.dossierSnapshot?.risksAndCaveats || ''
    }
  };
  return JSON.stringify(canonical, null, 2);
}

/**
 * Downloads the strategic favourite bundle as a clean .json file.
 */
export function downloadStrategicFavouriteJson(
  bundle: StrategicFavouriteBundle,
  filenameOverride?: string
): void {
  const jsonText = serializeStrategicFavouriteToJson(bundle);
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const slug = (bundle.userQuery || 'strategic_query')
    .slice(0, 32)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const colPrefix = bundle.csvFingerprints?.[0]?.columnsSha256?.slice(0, 8) || 'bundle';
  const fileName = filenameOverride || `Strategic_Favourite_${slug || 'query'}_${colPrefix}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parses an exported canonical JSON file back into a StrategicFavouriteBundle.
 */
export function parseImportedStrategicJson(
  rawJsonText: string,
  projectId: string,
  userId: string
): StrategicFavouriteBundle {
  const parsed = JSON.parse(rawJsonText);
  const userQuery = String(parsed.query || parsed.userQuery || '').trim();
  if (!userQuery) {
    throw new Error('Invalid JSON favourite: missing query field.');
  }

  const rawSteps: any[] = Array.isArray(parsed.steps)
    ? parsed.steps
    : Array.isArray(parsed.strategicSteps)
    ? parsed.strategicSteps
    : [];

  if (rawSteps.length === 0) {
    throw new Error('Invalid JSON favourite: no saved analysis steps found.');
  }

  const strategicSteps: StrategicFavouriteStep[] = rawSteps.map((s: any, idx: number) => ({
    stepNumber: Number(s.stepNumber || idx + 1),
    title: String(s.title || `Step ${idx + 1}`),
    subQuestion: String(s.subQuestion || ''),
    plannedMethod: String(s.plannedMethod || 'Saved Analysis Code'),
    code: String(s.code || ''),
    status: String(s.status || 'completed'),
    narrative: String(s.narrative || ''),
    metrics: s.metrics || {},
    result: s.result ?? null
  }));

  const rawFingerprints: any[] = Array.isArray(parsed.csvFingerprints) ? parsed.csvFingerprints : [];
  const csvFingerprints: CsvFingerprint[] = rawFingerprints.map((f: any) => ({
    fileName: String(f.fileName || ''),
    columnsSha256: String(f.columnsSha256 || ''),
    dataSha256: String(f.dataSha256 || ''),
    rowCount: Number(f.rowCount || 0),
    columns: Array.isArray(f.columns) ? f.columns.map(String) : []
  }));

  const rawAnswer = parsed.answer || parsed.dossierSnapshot || {};
  const dossierSnapshot: StrategicDossierAnswerSnapshot = {
    strategicVerdict: String(rawAnswer.strategicVerdict || ''),
    executiveSummary: String(rawAnswer.executiveSummary || ''),
    confidenceScore: Number(rawAnswer.confidenceScore ?? 80),
    strategicRecommendations: Array.isArray(rawAnswer.strategicRecommendations)
      ? rawAnswer.strategicRecommendations.map(String)
      : [],
    risksAndCaveats: String(rawAnswer.risksAndCaveats || ''),
    implementationRoadmap: Array.isArray(rawAnswer.implementationRoadmap)
      ? rawAnswer.implementationRoadmap.map(String)
      : [],
    progressiveEvidence: Array.isArray(rawAnswer.progressiveEvidence)
      ? rawAnswer.progressiveEvidence
      : []
  };

  const planList = strategicSteps.map(
    (s) => `Step ${s.stepNumber} (${s.title}): ${s.subQuestion}`
  );
  const codeList = strategicSteps.map((s) => s.code).filter(Boolean);
  const narrative = `Strategic Verdict: ${dossierSnapshot.strategicVerdict}\n\n${dossierSnapshot.executiveSummary}\n\nRecommendations:\n${dossierSnapshot.strategicRecommendations.join('\n')}`;

  return {
    schemaVersion: String(parsed.schemaVersion || '1.0'),
    favouriteType: 'strategic_dossier',
    projectId,
    userId,
    timestamp: String(parsed.savedAt || parsed.timestamp || new Date().toISOString()),
    userQuery,
    refinedUserQuery: String(parsed.refinedQuery || parsed.refinedUserQuery || userQuery),
    explorationMode: String(parsed.explorationMode || 'custom'),
    audiencePersona: String(parsed.audiencePersona || 'school_student'),
    metaPlanOverview: String(parsed.metaPlanOverview || ''),
    csvFingerprints,
    strategicSteps,
    dossierSnapshot,
    narrative,
    analysisPlan: planList,
    generatedCode: codeList,
    analysisResult: JSON.stringify({
      confidenceScore: dossierSnapshot.confidenceScore,
      strategicVerdict: dossierSnapshot.strategicVerdict,
      subQuestions: strategicSteps.map((s) => ({
        stepNumber: s.stepNumber,
        title: s.title,
        finding: s.narrative?.slice(0, 120)
      }))
    }),
    feedback: 'Strategic Dossier'
  };
}
