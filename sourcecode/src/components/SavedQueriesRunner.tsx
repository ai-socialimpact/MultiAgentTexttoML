import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';
import { useSettings } from '../contexts/SettingsContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { agents } from '../lib/agents';
import { DOSSIER_PERSONAS, type DossierPersonaId } from '../lib/dossierPersonas';
import {
  type CsvFingerprint,
  type CsvCompatibilityReport,
  type StrategicFavouriteBundle,
  type ReplayExecutionSummary,
  loadProjectCsvsWithFingerprints,
  evaluateCsvCompatibility,
  replayStrategicStepsWithoutAgent,
  downloadStrategicFavouriteJson,
  serializeStrategicFavouriteToJson,
  parseImportedStrategicJson,
  sanitizeForFirestore
} from '../lib/strategicFavourites';
import {
  Play,
  Search,
  Sparkles,
  Download,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Database,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  X,
  ArrowUpRight,
  Trash2,
  BookmarkCheck,
  Code
} from 'lucide-react';
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

export interface SavedQueriesRunnerProps {
  onOpenInAnswerStrategically?: (fav: StrategicFavouriteBundle, autoRunWithoutAgent?: boolean) => void;
}

export const SavedQueriesRunner: React.FC<SavedQueriesRunnerProps> = ({
  onOpenInAnswerStrategically
}) => {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const { models } = useSettings();

  const [savedQueries, setSavedQueries] = useState<StrategicFavouriteBundle[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(true);

  const [datasets, setDatasets] = useState<Record<string, any[]>>({});
  const [csvFingerprints, setCsvFingerprints] = useState<CsvFingerprint[]>([]);
  const [dataStatus, setDataStatus] = useState<{ loading: boolean; totalRows: number; error?: string }>({
    loading: true,
    totalRows: 0
  });
  const [showCsvShaDetails, setShowCsvShaDetails] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [aiScores, setAiScores] = useState<Record<string, number>>({});

  // Selected / running query state
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const [runningQueryId, setRunningQueryId] = useState<string | null>(null);
  const [stepProgressMap, setStepProgressMap] = useState<Record<number, 'running' | 'completed' | 'error'>>({});
  const [replayResultsById, setReplayResultsById] = useState<Record<string, ReplayExecutionSummary>>({});
  const [expandedCodeKeys, setExpandedCodeKeys] = useState<Record<string, boolean>>({});
  const [savingUpdatedId, setSavingUpdatedId] = useState<string | null>(null);
  const [savedBannerId, setSavedBannerId] = useState<string | null>(null);

  // Column mismatch confirmation state
  const [pendingMismatchRun, setPendingMismatchRun] = useState<{
    fav: StrategicFavouriteBundle;
    compat: CsvCompatibilityReport;
  } | null>(null);

  // JSON inspector modal
  const [inspectingJsonFav, setInspectingJsonFav] = useState<StrategicFavouriteBundle | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  // Import JSON feedback & inline delete confirm
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load CSV datasets & dual SHA-256 hashes
  useEffect(() => {
    const load = async () => {
      if (!currentProject || !currentProject.dataFiles || currentProject.dataFiles.length === 0) {
        setDatasets({});
        setCsvFingerprints([]);
        setDataStatus({ loading: false, totalRows: 0, error: 'No CSV files uploaded in this project.' });
        return;
      }
      setDataStatus({ loading: true, totalRows: 0 });
      try {
        const res = await loadProjectCsvsWithFingerprints(currentProject);
        setDatasets(res.datasets);
        setCsvFingerprints(res.fingerprints);
        setDataStatus({
          loading: false,
          totalRows: res.totalRows,
          error: Object.keys(res.datasets).length === 0 ? 'No valid CSV rows found.' : undefined
        });
      } catch (err: any) {
        setDataStatus({ loading: false, totalRows: 0, error: err?.message || 'Failed to read CSV files.' });
      }
    };
    load();
  }, [currentProject]);

  // Subscribe to saved strategic favourites in Firestore
  useEffect(() => {
    if (!user || !currentProject) {
      setSavedQueries([]);
      setIsLoadingQueries(false);
      return;
    }

    setIsLoadingQueries(true);
    const q = query(
      collection(db, 'favourites'),
      where('projectId', '==', currentProject.projectId),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: StrategicFavouriteBundle[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (
            data.favouriteType === 'strategic_dossier' ||
            (Array.isArray(data.strategicSteps) && data.strategicSteps.length > 0)
          ) {
            items.push({ id: docSnap.id, ...data } as StrategicFavouriteBundle);
          }
        });
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSavedQueries(items);
        setIsLoadingQueries(false);
      },
      (error) => {
        setIsLoadingQueries(false);
        handleFirestoreError(error, OperationType.LIST, 'favourites');
      }
    );

    return () => unsubscribe();
  }, [user, currentProject]);

  const handleAiSearch = async () => {
    const q = searchText.trim();
    if (!q || savedQueries.length === 0) return;
    setIsAiSearching(true);
    try {
      const res = await agents.similaritySearch(q, savedQueries, models.planner || models.strategyCreator);
      const scores: Record<string, number> = {};
      (res?.matches || []).forEach((m: any) => {
        if (m?.id) scores[m.id] = Number(m.score ?? 0.8);
      });
      setAiScores(scores);
    } catch (err) {
      console.warn('AI similarity search failed:', err);
    } finally {
      setIsAiSearching(false);
    }
  };

  const executeSavedQueryWithoutAgent = async (fav: StrategicFavouriteBundle) => {
    const key = fav.id || fav.timestamp;
    if (Object.keys(datasets).length === 0) {
      setImportMessage({ type: 'err', text: 'CSV datasets are not ready yet. Please wait for files to finish loading.' });
      return;
    }

    setActiveQueryId(key);
    setRunningQueryId(key);
    setPendingMismatchRun(null);
    setStepProgressMap({});

    try {
      const summary = await replayStrategicStepsWithoutAgent(
        fav.strategicSteps || [],
        datasets,
        (stepNum, status) => {
          setStepProgressMap((prev) => ({ ...prev, [stepNum]: status }));
        }
      );
      setReplayResultsById((prev) => ({ ...prev, [key]: summary }));
    } finally {
      setRunningQueryId(null);
    }
  };

  const handleRunQueryClick = (fav: StrategicFavouriteBundle, compat: CsvCompatibilityReport) => {
    const key = fav.id || fav.timestamp;
    if (compat.status === 'columns_changed' || compat.status === 'missing_files') {
      setPendingMismatchRun({ fav, compat });
      setActiveQueryId(key);
      return;
    }
    executeSavedQueryWithoutAgent(fav);
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentProject || !user) return;
    setImportMessage(null);
    try {
      const text = await file.text();
      const imported = parseImportedStrategicJson(text, currentProject.projectId, user.uid);
      const cleanPayload = sanitizeForFirestore(imported);
      const docRef = await addDoc(collection(db, 'favourites'), cleanPayload);
      setActiveQueryId(docRef.id);
      setImportMessage({
        type: 'ok',
        text: `Imported "${imported.userQuery}" and saved to your project favourites.`
      });
    } catch (err: any) {
      setImportMessage({
        type: 'err',
        text: err?.message || 'Could not parse JSON file.'
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveUpdatedSnapshot = async (
    fav: StrategicFavouriteBundle,
    replay: ReplayExecutionSummary,
    compat: CsvCompatibilityReport
  ) => {
    if (!currentProject || !user) return;
    const key = fav.id || fav.timestamp;
    setSavingUpdatedId(key);
    try {
      const updatedSteps = (fav.strategicSteps || []).map((orig) => {
        const fresh = replay.steps.find((r) => r.stepNumber === orig.stepNumber);
        if (!fresh || fresh.status !== 'completed') return orig;
        const deltaText = fresh.metricChanges
          .slice(0, 4)
          .map((c) => `${c.key}: ${c.currentValue}${c.deltaText ? ` (${c.deltaText})` : ''}`)
          .join(' · ');
        return sanitizeForFirestore({
          ...orig,
          metrics: fresh.metrics || orig.metrics,
          result: fresh.result ?? orig.result,
          narrative: deltaText ? `Updated replay metrics: ${deltaText}` : orig.narrative
        });
      });

      const deltaText = compat.totalRowDelta !== 0
        ? `${compat.totalRowDelta > 0 ? '+' : ''}${compat.totalRowDelta.toLocaleString()} rows`
        : `${dataStatus.totalRows.toLocaleString()} rows`;

      const updatedBundle: StrategicFavouriteBundle = {
        ...fav,
        id: undefined,
        projectId: currentProject.projectId,
        userId: user.uid,
        timestamp: new Date().toISOString(),
        csvFingerprints: sanitizeForFirestore(csvFingerprints),
        strategicSteps: updatedSteps,
        dossierSnapshot: sanitizeForFirestore({
          ...fav.dossierSnapshot,
          strategicVerdict: fav.dossierSnapshot?.strategicVerdict
            ? `[Refreshed · ${deltaText}] ${fav.dossierSnapshot.strategicVerdict}`
            : `Refreshed Direct Code Replay (${deltaText})`,
          executiveSummary: `Re-ran saved code directly without Agentic workflow on ${deltaText}.\n\n${fav.dossierSnapshot?.executiveSummary || ''}`
        })
      };

      await addDoc(collection(db, 'favourites'), sanitizeForFirestore(updatedBundle));
      setSavedBannerId(key);
      setTimeout(() => setSavedBannerId(null), 3000);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'favourites');
    } finally {
      setSavingUpdatedId(null);
    }
  };

  const handleDeleteFavourite = async (favId: string) => {
    try {
      await deleteDoc(doc(db, 'favourites', favId));
      setConfirmDeleteId(null);
      if (activeQueryId === favId) setActiveQueryId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `favourites/${favId}`);
    }
  };

  const renderStepVisual = (res: any) => {
    if (!res) return null;
    if (res.chartSpec?.data) {
      const { type, data, options: specOpts } = res.chartSpec;
      const opts = { responsive: true, maintainAspectRatio: false, ...specOpts };
      return (
        <div className="h-52 w-full relative">
          {type === 'line' ? (
            <Line data={data} options={opts} />
          ) : type === 'pie' ? (
            <Pie data={data} options={opts} />
          ) : (
            <Bar data={data} options={opts} />
          )}
        </div>
      );
    }
    if (Array.isArray(res.labels) && Array.isArray(res.values) && res.labels.length > 0) {
      return (
        <div className="h-52 w-full relative">
          <Bar
            data={{
              labels: res.labels.slice(0, 15),
              datasets: [
                {
                  label: 'Value',
                  data: res.values.slice(0, 15),
                  backgroundColor: 'rgba(79, 70, 229, 0.7)',
                  borderColor: 'rgb(79, 70, 229)',
                  borderWidth: 1
                }
              ]
            }}
            options={{ responsive: true, maintainAspectRatio: false }}
          />
        </div>
      );
    }
    return null;
  };

  const filteredQueries = savedQueries
    .filter((fav) => {
      if (!searchText.trim()) return true;
      const needle = searchText.toLowerCase();
      return (
        fav.userQuery.toLowerCase().includes(needle) ||
        (fav.dossierSnapshot?.strategicVerdict || '').toLowerCase().includes(needle) ||
        (fav.strategicSteps || []).some((s) => s.title.toLowerCase().includes(needle)) ||
        Boolean(fav.id && aiScores[fav.id])
      );
    })
    .sort((a, b) => {
      const sa = (a.id && aiScores[a.id]) || 0;
      const sb = (b.id && aiScores[b.id]) || 0;
      if (sb !== sa) return sb - sa;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header & Search Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Saved Strategic Queries Runner
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Search and re-run saved multi-step queries directly on today&apos;s CSV files. When Column Names SHA-256 matches, saved code executes immediately without the Agentic workflow.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportJsonFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              <span>Import JSON</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCsvShaDetails((prev) => !prev)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs text-slate-700 rounded-lg transition-colors cursor-pointer tabular-nums whitespace-nowrap"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              {dataStatus.loading ? (
                <span>Loading CSVs...</span>
              ) : (
                <span>
                  <strong className="font-semibold text-slate-900">{csvFingerprints.length}</strong> CSVs · <strong className="font-semibold text-slate-900">{dataStatus.totalRows.toLocaleString()}</strong> rows
                </span>
              )}
              {showCsvShaDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Live CSV Dual SHA-256 Inspection Table */}
        {showCsvShaDetails && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">Active Project CSV Dual SHA-256 Fingerprints</h3>
              <span className="text-[11px] text-slate-500">Column Names SHA stays constant when only rows are appended</span>
            </div>
            {csvFingerprints.length === 0 ? (
              <p className="text-xs text-slate-500">{dataStatus.error || 'No CSV fingerprints available.'}</p>
            ) : (
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3 font-semibold">CSV File</th>
                      <th className="py-2 px-3 font-semibold text-right">Rows</th>
                      <th className="py-2 px-3 font-semibold text-right">Columns</th>
                      <th className="py-2 px-3 font-semibold">Column Names SHA-256</th>
                      <th className="py-2 px-3 font-semibold">Full Data SHA-256</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {csvFingerprints.map((fp) => (
                      <tr key={fp.fileName}>
                        <td className="py-2 px-3 font-medium text-slate-900">{fp.fileName}</td>
                        <td className="py-2 px-3 text-right text-slate-700">{fp.rowCount.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-slate-700">{fp.columns.length}</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-emerald-700">{fp.columnsSha256.slice(0, 16)}…</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-600">{fp.dataSha256.slice(0, 16)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Search Input & Semantic Match */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                if (!e.target.value.trim()) setAiScores({});
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAiSearch();
              }}
              placeholder="Search saved queries by question, step title, or topic..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleAiSearch}
            disabled={isAiSearching || !searchText.trim() || savedQueries.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            {isAiSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{isAiSearching ? 'Matching...' : 'Find Similar Queries'}</span>
          </button>
        </div>

        {importMessage && (
          <div
            className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              importMessage.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <span>{importMessage.text}</span>
            <button type="button" onClick={() => setImportMessage(null)} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Column Change Confirmation Banner (when a user tries to run a query whose CSV column names changed) */}
      {pendingMismatchRun && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{pendingMismatchRun.compat.headline}</span>
              </div>
              <p className="text-xs text-amber-900">
                {pendingMismatchRun.compat.detail}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPendingMismatchRun(null)}
              className="p-1 text-amber-700 hover:text-amber-950 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {pendingMismatchRun.compat.fileDiffs.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-amber-50/70 border-b border-amber-200 text-amber-950">
                  <tr>
                    <th className="py-1.5 px-3 font-semibold">CSV File</th>
                    <th className="py-1.5 px-3 font-semibold">Column Names SHA</th>
                    <th className="py-1.5 px-3 font-semibold">Column Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {pendingMismatchRun.compat.fileDiffs.map((fd) => (
                    <tr key={fd.fileName}>
                      <td className="py-1.5 px-3 font-medium text-slate-900">{fd.fileName}</td>
                      <td className="py-1.5 px-3 font-mono text-[11px] text-rose-700">
                        {fd.columnsShaMatch ? 'Match' : 'Mismatch'} ({fd.savedColumnsSha256.slice(0, 8)} → {fd.currentColumnsSha256?.slice(0, 8) || 'missing'})
                      </td>
                      <td className="py-1.5 px-3 text-slate-700">
                        {fd.addedColumns.length > 0 && <span className="text-emerald-700 mr-2">Added: {fd.addedColumns.join(', ')}</span>}
                        {fd.removedColumns.length > 0 && <span className="text-rose-700">Removed: {fd.removedColumns.join(', ')}</span>}
                        {fd.addedColumns.length === 0 && fd.removedColumns.length === 0 && fd.status === 'columns_changed' && (
                          <span>Column order changed</span>
                        )}
                        {fd.status === 'missing_in_current' && <span className="text-rose-700">File missing in project</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {onOpenInAnswerStrategically && (
              <button
                type="button"
                onClick={() => onOpenInAnswerStrategically(pendingMismatchRun.fav, false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Re-plan Fresh with AI in Answer Strategically (Recommended)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => executeSavedQueryWithoutAgent(pendingMismatchRun.fav)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-amber-100 border border-amber-300 text-amber-950 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Try Running Saved Code Anyway</span>
            </button>
          </div>
        </div>
      )}

      {/* Saved Queries List */}
      {isLoadingQueries ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Loading saved strategic queries...
        </div>
      ) : filteredQueries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
          <BookmarkCheck className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">
            {savedQueries.length === 0
              ? 'No saved strategic queries yet'
              : 'No saved queries matched your search'}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {savedQueries.length === 0
              ? 'Run a question in Answer Strategically and click Save to Favourites, or import an exported JSON file above.'
              : 'Try a different keyword or clear the search box.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredQueries.map((fav) => {
            const key = fav.id || fav.timestamp;
            const compat = evaluateCsvCompatibility(fav.csvFingerprints, csvFingerprints);
            const isExpanded = activeQueryId === key;
            const isRunningThis = runningQueryId === key;
            const replay = replayResultsById[key];
            const personaLabel =
              DOSSIER_PERSONAS[(fav.audiencePersona as DossierPersonaId) || 'school_student']?.shortLabel ||
              'Saved Persona';
            const colShaShort = fav.csvFingerprints?.[0]?.columnsSha256?.slice(0, 8) || 'none';
            const dataShaShort = fav.csvFingerprints?.[0]?.dataSha256?.slice(0, 8) || 'none';
            const simScore = fav.id ? aiScores[fav.id] : undefined;

            return (
              <div key={key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Summary Row */}
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-start gap-2">
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">
                        {fav.userQuery}
                      </h3>
                    </div>

                    {/* Clean Unboxed Metadata */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span>{new Date(fav.timestamp).toLocaleString()}</span>
                      <span aria-hidden="true">·</span>
                      <span>{personaLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{fav.strategicSteps?.length || 0} steps</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Col SHA {colShaShort}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Data SHA {dataShaShort}</span>
                      {compat.totalSavedRows > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {compat.totalSavedRows.toLocaleString()} saved rows → {compat.totalCurrentRows.toLocaleString()} current rows
                          </span>
                        </>
                      )}
                      {simScore && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-indigo-700 font-semibold">{Math.round(simScore * 100)}% similar</span>
                        </>
                      )}
                    </div>

                    {/* Dual SHA Compatibility Guidance */}
                    <div
                      className={`text-xs font-medium flex items-center gap-1.5 ${
                        compat.canDirectRunWithoutAgent ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {compat.canDirectRunWithoutAgent ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{compat.headline}</span>
                    </div>
                  </div>

                  {/* Single-line Controls */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isRunningThis || dataStatus.loading}
                      onClick={() => handleRunQueryClick(fav, compat)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        compat.canDirectRunWithoutAgent
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          : 'bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950'
                      }`}
                    >
                      {isRunningThis ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Running Code...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>
                            {compat.status === 'identical_data'
                              ? 'Re-run Saved Code'
                              : compat.canDirectRunWithoutAgent
                              ? 'Run Now (No AI Wait)'
                              : 'Review & Run'}
                          </span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveQueryId(isExpanded ? null : key)}
                      className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectingJsonFav(fav)}
                      className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      title="Inspect canonical JSON"
                    >
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      <span>JSON</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadStrategicFavouriteJson(fav)}
                      className="inline-flex items-center gap-1 px-2.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      title="Download portable JSON file"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    {onOpenInAnswerStrategically && (
                      <button
                        type="button"
                        onClick={() => onOpenInAnswerStrategically(fav, compat.canDirectRunWithoutAgent)}
                        className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        title="Open this query and steps inside Answer Strategically"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                        <span>Open in Studio</span>
                      </button>
                    )}

                    {fav.id && (
                      confirmDeleteId === fav.id ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteFavourite(fav.id!)}
                          className="inline-flex items-center gap-1 px-2.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Confirm Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(fav.id!)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete saved favourite"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Expanded Direct Execution Results & Saved Steps */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50/70 p-5 space-y-5">
                    {/* Fresh Execution Banner when run directly */}
                    {replay && (
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>
                                Direct Code Execution Complete ({(replay.totalDurationMs / 1000).toFixed(2)}s · Zero Agentic Calls)
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 tabular-nums">
                              Ran {replay.steps.filter((s) => s.status === 'completed').length} / {replay.steps.length} saved steps against {dataStatus.totalRows.toLocaleString()} current rows.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={savingUpdatedId === key}
                              onClick={() => handleSaveUpdatedSnapshot(fav, replay, compat)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                            >
                              <BookmarkCheck className="w-3.5 h-3.5" />
                              <span>
                                {savedBannerId === key
                                  ? 'Saved Updated Run'
                                  : savingUpdatedId === key
                                  ? 'Saving...'
                                  : 'Save Updated Snapshot'}
                              </span>
                            </button>
                            {onOpenInAnswerStrategically && (
                              <button
                                type="button"
                                onClick={() => onOpenInAnswerStrategically(fav, true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Full Dossier View</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Original Saved Answer Summary */}
                    {fav.dossierSnapshot?.strategicVerdict && (
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                          Saved Strategic Answer ({new Date(fav.timestamp).toLocaleDateString()})
                        </span>
                        <p className="text-sm font-semibold text-slate-900">
                          {fav.dossierSnapshot.strategicVerdict}
                        </p>
                        {fav.dossierSnapshot.executiveSummary && (
                          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {fav.dossierSnapshot.executiveSummary}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Step-by-Step Comparison Grid */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-slate-700">
                        Saved Steps &amp; Live Re-run Outputs
                      </h4>
                      {(fav.strategicSteps || []).map((step) => {
                        const freshStep = replay?.steps.find((r) => r.stepNumber === step.stepNumber);
                        const liveStatus = isRunningThis
                          ? stepProgressMap[step.stepNumber] || 'pending'
                          : freshStep?.status;
                        const codeKey = `${key}-step-${step.stepNumber}`;
                        const showCode = !!expandedCodeKeys[codeKey];

                        return (
                          <div
                            key={step.stepNumber}
                            className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 tabular-nums">
                                  <span>Step {step.stepNumber}: {step.title}</span>
                                  {liveStatus === 'running' && (
                                    <span className="text-indigo-600 font-medium inline-flex items-center gap-1">
                                      <RefreshCw className="w-3 h-3 animate-spin" /> Running...
                                    </span>
                                  )}
                                  {liveStatus === 'completed' && (
                                    <span className="text-emerald-700 font-medium">
                                      · Re-ran in {freshStep?.durationMs ?? 0}ms
                                    </span>
                                  )}
                                  {liveStatus === 'error' && (
                                    <span className="text-rose-700 font-medium">· Error</span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-600 mt-0.5">{step.subQuestion}</p>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedCodeKeys((prev) => ({ ...prev, [codeKey]: !prev[codeKey] }))
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 rounded-md cursor-pointer whitespace-nowrap self-start sm:self-auto"
                              >
                                <Code className="w-3 h-3" />
                                <span>{showCode ? 'Hide Code' : 'View Saved Code'}</span>
                              </button>
                            </div>

                            {showCode && (
                              <pre className="p-3 bg-slate-950 text-emerald-300 rounded-lg text-[11px] font-mono overflow-x-auto max-h-56">
                                {step.code || '// No code'}
                              </pre>
                            )}

                            {/* Fresh vs Saved Result Side-by-Side */}
                            {freshStep && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 space-y-2">
                                  <span className="text-[11px] font-semibold text-slate-600 block">
                                    Previously Saved Result
                                  </span>
                                  {step.narrative && (
                                    <p className="text-xs text-slate-700 leading-relaxed">{step.narrative}</p>
                                  )}
                                  {step.result && (
                                    <pre className="text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-40 tabular-nums">
                                      {JSON.stringify(step.result, null, 2)}
                                    </pre>
                                  )}
                                </div>

                                <div className="border border-indigo-200 rounded-lg p-3 bg-indigo-50/40 space-y-2">
                                  <span className="text-[11px] font-semibold text-indigo-900 block">
                                    Updated Result on Current CSVs
                                  </span>
                                  {freshStep.error ? (
                                    <p className="text-xs text-rose-700 font-medium">{freshStep.error}</p>
                                  ) : (
                                    <>
                                      {freshStep.metricChanges.length > 0 && (
                                        <div className="overflow-x-auto bg-white border border-indigo-100 rounded">
                                          <table className="w-full text-left text-[11px] tabular-nums">
                                            <thead className="bg-indigo-50/60 text-slate-600">
                                              <tr>
                                                <th className="py-1 px-2 font-semibold">Metric</th>
                                                <th className="py-1 px-2 font-semibold text-right">Saved</th>
                                                <th className="py-1 px-2 font-semibold text-right">Updated</th>
                                                <th className="py-1 px-2 font-semibold text-right">Change</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                              {freshStep.metricChanges.map((mc) => (
                                                <tr key={mc.key}>
                                                  <td className="py-1 px-2 font-medium text-slate-800">{mc.key}</td>
                                                  <td className="py-1 px-2 text-right font-mono text-slate-500">{String(mc.previousValue)}</td>
                                                  <td className="py-1 px-2 text-right font-mono font-semibold text-slate-900">{String(mc.currentValue)}</td>
                                                  <td className="py-1 px-2 text-right font-mono text-indigo-700">{mc.deltaText || '—'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {renderStepVisual(freshStep.result)}
                                      <pre className="text-[11px] font-mono text-slate-800 bg-white border border-indigo-100 rounded p-2 overflow-auto max-h-40 tabular-nums">
                                        {JSON.stringify(freshStep.result, null, 2)}
                                      </pre>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* JSON Inspector Modal */}
      {inspectingJsonFav && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Saved Strategic Query JSON</h3>
                <p className="text-xs text-slate-600 mt-0.5 truncate max-w-xl">{inspectingJsonFav.userQuery}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingJsonFav(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 bg-slate-950">
              <pre className="text-xs font-mono text-emerald-300 whitespace-pre-wrap break-words">
                {serializeStrategicFavouriteToJson(inspectingJsonFav)}
              </pre>
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(serializeStrategicFavouriteToJson(inspectingJsonFav));
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  } catch {}
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
              >
                {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copiedJson ? 'Copied JSON' : 'Copy JSON'}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadStrategicFavouriteJson(inspectingJsonFav)}
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
