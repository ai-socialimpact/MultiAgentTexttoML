import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FolderTree,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  ExternalLink
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
import { FormattedAnswerDisplay, exportBlockToCsv, parseContentToBlocks } from './FormattedAnswerDisplay';
import { DOSSIER_PERSONAS, DossierPersonaId } from '../lib/dossierPersonas';
import { agents } from '../lib/agents';
import { useSettings } from '../contexts/SettingsContext';

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

export type ViewerMainMode = 'generic' | 'ai_explainer';
export type GenericTemplateId = 'summary' | 'table' | 'explorer' | 'raw';

export interface SmartResultViewerProps {
  query: string;
  result: any;
  previousResult?: any;
  label?: string;
  contextId?: string;
}

interface DiscoveredMetric {
  key: string;
  path: string;
  label: string;
  value: string | number | boolean;
  numericValue: number | null;
  formattedValue: string;
  previousFormatted?: string;
  numericDelta?: number | null;
  percentDelta?: number | null;
  changed?: boolean;
}

interface DiscoveredTable {
  id: string;
  title: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  sourcePath: string;
}

interface AutoChartSpec {
  type: 'bar' | 'line' | 'pie';
  title: string;
  data: any;
  options?: any;
}

interface AnalyzedPayload {
  normalized: any;
  previousNormalized: any;
  kind: 'empty' | 'primitive' | 'text' | 'chart' | 'table_array' | 'object_map' | 'nested_json';
  formatLabel: string;
  metrics: DiscoveredMetric[];
  tables: DiscoveredTable[];
  chart: AutoChartSpec | null;
  narrativeText: string;
  recommendedTemplate: GenericTemplateId;
  rawText: string;
}

const CHART_PALETTE_BG = [
  'rgba(37, 99, 235, 0.72)',
  'rgba(16, 185, 129, 0.72)',
  'rgba(245, 158, 11, 0.72)',
  'rgba(99, 102, 241, 0.72)',
  'rgba(236, 72, 153, 0.72)',
  'rgba(20, 184, 166, 0.72)',
  'rgba(249, 115, 22, 0.72)',
  'rgba(139, 92, 246, 0.72)'
];

const CHART_PALETTE_BORDER = [
  'rgb(37, 99, 235)',
  'rgb(16, 185, 129)',
  'rgb(245, 158, 11)',
  'rgb(99, 102, 241)',
  'rgb(236, 72, 153)',
  'rgb(20, 184, 166)',
  'rgb(249, 115, 22)',
  'rgb(139, 92, 246)'
];

function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function humanizeKey(key: string): string {
  if (!key) return '';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function tryUnwrapJson(value: any, maxDepth = 2): any {
  let current = value;
  for (let i = 0; i < maxDepth; i++) {
    if (typeof current !== 'string') break;
    let trimmed = current.trim();
    if (!trimmed) break;

    // Strip markdown ```json ... ``` fences if present
    const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch && fenceMatch[1]) {
      trimmed = fenceMatch[1].trim();
    }

    const looksJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'));

    if (!looksJson) break;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === current) break;
      current = parsed;
    } catch {
      break;
    }
  }
  return current;
}

function isIsoDateString(val: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(val)) {
    return false;
  }
  const ts = Date.parse(val);
  return !Number.isNaN(ts);
}

function isUrlString(val: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(val.trim());
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatScalarValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return '—';
    if (isIsoDateString(t)) {
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) {
        return t.includes('T') ? d.toLocaleString() : d.toLocaleDateString();
      }
    }
    return t;
  }
  if (Array.isArray(v)) return `${v.length} items`;
  if (isPlainObject(v)) return `${Object.keys(v).length} fields`;
  return String(v);
}

function toNumericIfClean(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function lookupPathValue(obj: any, path: string): any {
  if (!isPlainObject(obj) && !Array.isArray(obj)) return undefined;
  const parts = path.split('.');
  let cur: any = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function flattenCellForTable(val: any): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    if (val.every((x) => typeof x !== 'object' || x === null)) {
      return val.map((x) => String(x ?? '—')).join(', ');
    }
    return `[${val.length} items]`;
  }
  if (isPlainObject(val)) {
    const entries = Object.entries(val);
    if (entries.length === 0) return '—';
    if (entries.length <= 3 && entries.every(([, v]) => typeof v !== 'object' || v === null)) {
      return entries.map(([k, v]) => `${humanizeKey(k)}: ${formatScalarValue(v)}`).join(' · ');
    }
    return `{${entries.length} fields}`;
  }
  return String(val);
}

function safeStableSignature(value: any): string {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (!str) return 'empty';
    // Compact deterministic fingerprint from length + prefix + suffix
    let hash = 2166136261;
    const sample = str.slice(0, 6000);
    for (let i = 0; i < sample.length; i++) {
      hash ^= sample.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${str.length}:${(hash >>> 0).toString(16)}`;
  } catch {
    return String(value).slice(0, 64);
  }
}

function analyzeResultPayload(rawValue: any, previousRawValue?: any): AnalyzedPayload {
  const normalized = tryUnwrapJson(rawValue);
  const previousNormalized = previousRawValue !== undefined ? tryUnwrapJson(previousRawValue) : undefined;

  const rawText = (() => {
    if (normalized === null || normalized === undefined) return '';
    if (typeof normalized === 'string') return normalized;
    try {
      return JSON.stringify(normalized, null, 2);
    } catch {
      return String(normalized);
    }
  })();

  if (
    normalized === null ||
    normalized === undefined ||
    (typeof normalized === 'string' && normalized.trim() === '')
  ) {
    return {
      normalized,
      previousNormalized,
      kind: 'empty',
      formatLabel: 'Empty Result',
      metrics: [],
      tables: [],
      chart: null,
      narrativeText: '',
      recommendedTemplate: 'summary',
      rawText: ''
    };
  }

  // Primitive scalar (number / boolean)
  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    const prevNum = toNumericIfClean(previousNormalized);
    const curNum = toNumericIfClean(normalized);
    const numericDelta = prevNum !== null && curNum !== null ? curNum - prevNum : null;
    const percentDelta =
      prevNum !== null && curNum !== null && prevNum !== 0
        ? ((curNum - prevNum) / Math.abs(prevNum)) * 100
        : null;

    return {
      normalized,
      previousNormalized,
      kind: 'primitive',
      formatLabel: typeof normalized === 'number' ? 'Numeric Metric' : 'Boolean Value',
      metrics: [
        {
          key: 'result',
          path: 'result',
          label: 'Result Value',
          value: normalized,
          numericValue: curNum,
          formattedValue: formatScalarValue(normalized),
          previousFormatted: previousNormalized !== undefined ? formatScalarValue(previousNormalized) : undefined,
          numericDelta,
          percentDelta,
          changed: previousNormalized !== undefined && previousNormalized !== normalized
        }
      ],
      tables: [],
      chart: null,
      narrativeText: '',
      recommendedTemplate: 'summary',
      rawText
    };
  }

  // Text / Markdown / Delimited string
  if (typeof normalized === 'string') {
    const blocks = parseContentToBlocks(normalized);
    const tables: DiscoveredTable[] = [];
    const metrics: DiscoveredMetric[] = [];
    const narrativeChunks: string[] = [];

    blocks.forEach((b, idx) => {
      if (b.type === 'table' && b.headers && b.rows && b.rows.length > 0) {
        tables.push({
          id: `text-table-${idx}`,
          title: tables.length === 0 ? 'Extracted Table' : `Extracted Table ${tables.length + 1}`,
          headers: b.headers,
          rows: b.rows,
          sourcePath: `block[${idx}]`
        });
      } else if (b.type === 'keyValue' && b.pairs) {
        b.pairs.forEach((p, pIdx) => {
          const curNum = toNumericIfClean(p.value);
          metrics.push({
            key: p.key,
            path: `kv_${idx}_${pIdx}`,
            label: humanizeKey(p.key),
            value: p.value,
            numericValue: curNum,
            formattedValue: p.value
          });
        });
      } else if (b.type === 'list' && b.items) {
        narrativeChunks.push(b.items.map((it) => `- ${it}`).join('\n'));
      } else if (b.type === 'text' && b.text) {
        narrativeChunks.push(b.text);
      }
    });

    // Try building auto chart from first parsed text table if clean
    const chart = buildChartFromTables(tables);

    const hasTable = tables.length > 0;
    const recommendedTemplate: GenericTemplateId =
      hasTable && narrativeChunks.length === 0 && metrics.length === 0
        ? 'table'
        : hasTable || metrics.length > 0 || chart
          ? 'summary'
          : 'explorer';

    return {
      normalized,
      previousNormalized,
      kind: 'text',
      formatLabel: hasTable ? 'Structured Text & Table' : 'Text Narrative',
      metrics,
      tables,
      chart,
      narrativeText: normalized,
      recommendedTemplate,
      rawText
    };
  }

  // Collect Tables, Metrics, Narrative & Charts from Array or Object JSON
  const tables: DiscoveredTable[] = [];
  const metrics: DiscoveredMetric[] = [];
  const narrativeParts: string[] = [];
  let explicitChart: AutoChartSpec | null = null;

  // 1. Check top-level ChartJS chartSpec
  if (isPlainObject(normalized) && normalized.chartSpec && isPlainObject(normalized.chartSpec.data)) {
    const rawType = String(normalized.chartSpec.type || 'bar').toLowerCase();
    const chartType: 'bar' | 'line' | 'pie' =
      rawType === 'line' ? 'line' : rawType === 'pie' || rawType === 'doughnut' ? 'pie' : 'bar';
    explicitChart = {
      type: chartType,
      title: normalized.chartSpec.title || normalized.title || 'Visual Chart',
      data: normalized.chartSpec.data,
      options: normalized.chartSpec.options
    };

    // Convert chartSpec.data into a DiscoveredTable too for Data Table view!
    const specLabels = normalized.chartSpec.data.labels;
    const specDatasets = normalized.chartSpec.data.datasets;
    if (Array.isArray(specLabels) && Array.isArray(specDatasets) && specDatasets.length > 0) {
      const headers = [
        'Label',
        ...specDatasets.map((ds: any, i: number) => String(ds.label || `Series ${i + 1}`))
      ];
      const rows = specLabels.map((lbl: any, rIdx: number) => [
        flattenCellForTable(lbl),
        ...specDatasets.map((ds: any) => flattenCellForTable(ds.data?.[rIdx]))
      ]);
      tables.push({
        id: 'chartspec-table',
        title: explicitChart.title || 'Chart Data Series',
        headers,
        rows,
        sourcePath: 'chartSpec.data'
      });
    }
  }

  // 2. Check top-level { labels: [...], values: [...] }
  if (
    isPlainObject(normalized) &&
    Array.isArray(normalized.labels) &&
    Array.isArray(normalized.values) &&
    normalized.labels.length > 0
  ) {
    if (!explicitChart) {
      explicitChart = {
        type: 'bar',
        title: normalized.title ? String(normalized.title) : 'Series Breakdown',
        data: {
          labels: normalized.labels.map((l: any) => String(l)),
          datasets: [
            {
              label: normalized.valueLabel ? String(normalized.valueLabel) : 'Value',
              data: normalized.values.map((v: any) => Number(v) || 0),
              backgroundColor: normalized.labels.map((_: any, i: number) => CHART_PALETTE_BG[i % CHART_PALETTE_BG.length]),
              borderColor: normalized.labels.map((_: any, i: number) => CHART_PALETTE_BORDER[i % CHART_PALETTE_BORDER.length]),
              borderWidth: 1
            }
          ]
        }
      };
    }
    tables.push({
      id: 'labels-values-table',
      title: 'Labels & Values',
      headers: ['Label', normalized.valueLabel ? String(normalized.valueLabel) : 'Value'],
      rows: normalized.labels.map((lbl: any, i: number) => [
        flattenCellForTable(lbl),
        flattenCellForTable(normalized.values[i])
      ]),
      sourcePath: 'labels/values'
    });
  }

  // Helper to extract tables up to depth 3
  const seenTablePaths = new Set<string>();
  const discoverTablesRecursive = (node: any, path: string, titleHint: string, depth: number) => {
    if (depth > 3 || node === null || node === undefined) return;

    if (Array.isArray(node) && node.length > 0) {
      const objectRows = node.filter((item) => isPlainObject(item));
      if (objectRows.length > 0 && objectRows.length >= Math.ceil(node.length * 0.6)) {
        const headerSet = new Set<string>();
        objectRows.forEach((row) => {
          Object.keys(row).forEach((k) => headerSet.add(k));
        });
        const headers = Array.from(headerSet);
        if (headers.length > 0 && !seenTablePaths.has(path)) {
          seenTablePaths.add(path);
          const rows = objectRows.map((row) => headers.map((h) => flattenCellForTable(row[h])));
          tables.push({
            id: `tbl-${tables.length}`,
            title: titleHint || 'Records Table',
            headers,
            rows,
            sourcePath: path || 'root'
          });
        }
        return;
      }

      // Array of primitives at root or key
      if (node.every((x) => typeof x !== 'object' || x === null) && path) {
        if (!seenTablePaths.has(path) && path !== 'labels' && path !== 'values') {
          seenTablePaths.add(path);
          tables.push({
            id: `tbl-${tables.length}`,
            title: titleHint || humanizeKey(path),
            headers: ['#', humanizeKey(path.split('.').pop() || 'Value')],
            rows: node.map((v, idx) => [idx + 1, flattenCellForTable(v)]),
            sourcePath: path
          });
        }
        return;
      }
    }

    if (isPlainObject(node)) {
      const entries = Object.entries(node).filter(
        ([k]) => !['chartSpec', 'labels', 'values'].includes(k)
      );

      // Check Object-of-Objects dictionary map (at least 2 uniform sub-objects with mostly scalar fields)
      if (entries.length >= 2) {
        const allSubObjects = entries.every(([, v]) => isPlainObject(v) && !Array.isArray(v));
        if (allSubObjects) {
          const subHeaderSet = new Set<string>();
          let totalScalarFields = 0;
          entries.forEach(([, subObj]) => {
            Object.entries(subObj as Record<string, any>).forEach(([sk, sv]) => {
              if (typeof sv !== 'object' || sv === null) {
                totalScalarFields++;
              }
              subHeaderSet.add(sk);
            });
          });
          const subHeaders = Array.from(subHeaderSet);
          if (subHeaders.length > 0 && totalScalarFields >= entries.length && !seenTablePaths.has(path || 'root-map')) {
            seenTablePaths.add(path || 'root-map');
            tables.push({
              id: `tbl-${tables.length}`,
              title: titleHint || 'Breakdown Table',
              headers: ['Item', ...subHeaders],
              rows: entries.map(([itemKey, subObj]) => [
                itemKey,
                ...subHeaders.map((sh) => flattenCellForTable((subObj as Record<string, any>)[sh]))
              ]),
              sourcePath: path || 'root'
            });
            return;
          }
        }
      }

      // Recurse into child keys
      for (const [k, v] of entries) {
        if (typeof v === 'object' && v !== null) {
          const nextPath = path ? `${path}.${k}` : k;
          discoverTablesRecursive(v, nextPath, humanizeKey(k), depth + 1);
        }
      }
    }
  };

  discoverTablesRecursive(normalized, '', 'Result Records', 0);

  // Extract Scalar KPI Metrics + Narrative fields from top-level and 1-level-nested summary objects
  const narrativeKeys = new Set([
    'summary',
    'answer',
    'narrative',
    'explanation',
    'insight',
    'insights',
    'conclusion',
    'recommendation',
    'recommendations',
    'notes',
    'note',
    'description',
    'message',
    'text'
  ]);
  const skipMetaKeys = new Set(['chartSpec', 'labels', 'values', 'logs', 'rawCode']);

  const collectScalars = (obj: Record<string, any>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
      if (skipMetaKeys.has(k)) continue;
      const path = prefix ? `${prefix}.${k}` : k;

      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (!trimmed) continue;
        if (narrativeKeys.has(k.toLowerCase()) || trimmed.length > 110 || trimmed.includes('\n')) {
          narrativeParts.push(`**${humanizeKey(k)}:**\n${trimmed}`);
          continue;
        }
      }

      if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.trim().length <= 80)) {
        const curNum = toNumericIfClean(v);
        const prevVal = previousNormalized !== undefined ? lookupPathValue(previousNormalized, path) : undefined;
        const prevNum = prevVal !== undefined ? toNumericIfClean(prevVal) : null;
        const numericDelta = prevNum !== null && curNum !== null ? curNum - prevNum : null;
        const percentDelta =
          prevNum !== null && curNum !== null && prevNum !== 0
            ? ((curNum - prevNum) / Math.abs(prevNum)) * 100
            : null;
        const changed =
          prevVal !== undefined &&
          (numericDelta !== null ? Math.abs(numericDelta) > 1e-9 : String(prevVal) !== String(v));

        metrics.push({
          key: k,
          path,
          label: prefix ? `${humanizeKey(prefix)} · ${humanizeKey(k)}` : humanizeKey(k),
          value: v,
          numericValue: curNum,
          formattedValue: formatScalarValue(v),
          previousFormatted: prevVal !== undefined ? formatScalarValue(prevVal) : undefined,
          numericDelta,
          percentDelta,
          changed
        });
      } else if (depth === 0 && isPlainObject(v) && !seenTablePaths.has(path)) {
        const subKeys = Object.keys(v);
        if (subKeys.length > 0 && subKeys.length <= 8) {
          collectScalars(v, k, depth + 1);
        }
      }
    }
  };

  if (isPlainObject(normalized)) {
    collectScalars(normalized, '', 0);

    // Fallback flat key-value table if object had only scalars and no tables yet
    if (tables.length === 0) {
      const scalarEntries = Object.entries(normalized).filter(
        ([k, v]) => !skipMetaKeys.has(k) && (typeof v !== 'object' || v === null)
      );
      if (scalarEntries.length > 0) {
        tables.push({
          id: 'kv-fallback-table',
          title: 'Key-Value Summary',
          headers: ['Field', 'Value'],
          rows: scalarEntries.map(([k, v]) => [humanizeKey(k), flattenCellForTable(v)]),
          sourcePath: 'root'
        });
      }
    }
  } else if (Array.isArray(normalized)) {
    metrics.push({
      key: 'count',
      path: 'length',
      label: 'Total Items',
      value: normalized.length,
      numericValue: normalized.length,
      formattedValue: formatNumber(normalized.length),
      previousFormatted: Array.isArray(previousNormalized)
        ? formatNumber(previousNormalized.length)
        : undefined,
      numericDelta: Array.isArray(previousNormalized)
        ? normalized.length - previousNormalized.length
        : null,
      percentDelta:
        Array.isArray(previousNormalized) && previousNormalized.length > 0
          ? ((normalized.length - previousNormalized.length) / previousNormalized.length) * 100
          : null,
      changed: Array.isArray(previousNormalized) && normalized.length !== previousNormalized.length
    });

    if (tables.length === 0) {
      tables.push({
        id: 'array-items-table',
        title: 'Items List',
        headers: ['#', 'Value'],
        rows: normalized.map((item, idx) => [idx + 1, flattenCellForTable(item)]),
        sourcePath: 'root'
      });
    }
  }

  const autoChart = explicitChart || buildChartFromTables(tables);

  let kind: AnalyzedPayload['kind'] = 'nested_json';
  let formatLabel = 'JSON Object';
  if (explicitChart) {
    kind = 'chart';
    formatLabel = 'Chart & Visual Data';
  } else if (Array.isArray(normalized) && tables.length > 0) {
    kind = 'table_array';
    formatLabel = `Array (${normalized.length} records)`;
  } else if (tables.some((t) => t.id !== 'kv-fallback-table')) {
    kind = 'object_map';
    formatLabel = 'Structured JSON';
  }

  let recommendedTemplate: GenericTemplateId = 'summary';
  if (explicitChart) {
    recommendedTemplate = 'summary';
  } else if (
    kind === 'table_array' &&
    metrics.length <= 2 &&
    narrativeParts.length === 0
  ) {
    recommendedTemplate = 'table';
  } else if (metrics.length === 0 && !autoChart && narrativeParts.length === 0) {
    recommendedTemplate = tables.length > 0 && tables[0].rows.length >= 2 && tables[0].headers.length >= 2
      ? 'table'
      : 'explorer';
  } else {
    recommendedTemplate = 'summary';
  }

  return {
    normalized,
    previousNormalized,
    kind,
    formatLabel,
    metrics,
    tables,
    chart: autoChart,
    narrativeText: narrativeParts.join('\n\n'),
    recommendedTemplate,
    rawText
  };
}

function buildChartFromTables(tables: DiscoveredTable[]): AutoChartSpec | null {
  for (const tbl of tables) {
    if (tbl.id === 'kv-fallback-table') continue;
    if (tbl.rows.length < 2 || tbl.rows.length > 25 || tbl.headers.length < 2) continue;

    // Find 1 label column (non-numeric or first string column) and up to 2 numeric columns
    let labelColIdx = -1;
    const numericColIndices: number[] = [];

    tbl.headers.forEach((header, colIdx) => {
      const sampleVals = tbl.rows.map((r) => r[colIdx]).filter((v) => v !== null && v !== undefined && v !== '');
      if (sampleVals.length === 0) return;

      const numericCount = sampleVals.filter((v) => toNumericIfClean(v) !== null).length;
      if (numericCount >= Math.ceil(sampleVals.length * 0.8) && header !== '#') {
        numericColIndices.push(colIdx);
      } else if (labelColIdx === -1 && header !== '#') {
        labelColIdx = colIdx;
      }
    });

    if (labelColIdx === -1 && tbl.headers[0] !== '#') {
      labelColIdx = 0;
    }

    if (labelColIdx !== -1 && numericColIndices.length >= 1) {
      const selectedMetrics = numericColIndices.slice(0, 2);
      const labels = tbl.rows.map((r) => {
        const s = String(r[labelColIdx] ?? '—');
        return s.length > 28 ? `${s.slice(0, 26)}…` : s;
      });

      return {
        type: 'bar',
        title: tbl.title,
        data: {
          labels,
          datasets: selectedMetrics.map((colIdx, dsIdx) => ({
            label: humanizeKey(tbl.headers[colIdx]),
            data: tbl.rows.map((r) => toNumericIfClean(r[colIdx]) ?? 0),
            backgroundColor:
              selectedMetrics.length === 1
                ? labels.map((_, i) => CHART_PALETTE_BG[i % CHART_PALETTE_BG.length])
                : CHART_PALETTE_BG[dsIdx % CHART_PALETTE_BG.length],
            borderColor:
              selectedMetrics.length === 1
                ? labels.map((_, i) => CHART_PALETTE_BORDER[i % CHART_PALETTE_BORDER.length])
                : CHART_PALETTE_BORDER[dsIdx % CHART_PALETTE_BORDER.length],
            borderWidth: 1
          }))
        }
      };
    }
  }
  return null;
}

const JsonTreeNode: React.FC<{
  nodeKey: string;
  value: any;
  previousValue?: any;
  depth: number;
  searchQuery: string;
  expandSignal: { version: number; expand: boolean };
}> = ({ nodeKey, value, previousValue, depth, searchQuery, expandSignal }) => {
  const isContainer = isPlainObject(value) || Array.isArray(value);
  const childEntries: [string, any][] = useMemo(() => {
    if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
    if (isPlainObject(value)) return Object.entries(value);
    return [];
  }, [value]);

  const [isOpen, setIsOpen] = useState<boolean>(depth < 2 && childEntries.length <= 20);

  useEffect(() => {
    if (expandSignal.version > 0) {
      setIsOpen(expandSignal.expand);
    }
  }, [expandSignal]);

  const lowerQ = searchQuery.trim().toLowerCase();

  const nodeMatchesSearch = useMemo(() => {
    if (!lowerQ) return true;
    const check = (k: string, v: any, guard: number): boolean => {
      if (k.toLowerCase().includes(lowerQ) || humanizeKey(k).toLowerCase().includes(lowerQ)) {
        return true;
      }
      if (v === null || v === undefined) return false;
      if (typeof v !== 'object') return String(v).toLowerCase().includes(lowerQ);
      if (guard > 4) return false;
      if (Array.isArray(v)) {
        return v.some((item, i) => check(String(i), item, guard + 1));
      }
      return Object.entries(v).some(([ck, cv]) => check(ck, cv, guard + 1));
    };
    return check(nodeKey, value, 0);
  }, [lowerQ, nodeKey, value]);

  if (!nodeMatchesSearch) return null;

  const isRoot = nodeKey === '__root__';
  const displayLabel = isRoot ? 'Result Overview' : /^\d+$/.test(nodeKey) ? `Item #${Number(nodeKey) + 1}` : humanizeKey(nodeKey);

  if (!isContainer) {
    const isUrl = typeof value === 'string' && isUrlString(value);
    const hasChanged =
      previousValue !== undefined &&
      typeof previousValue !== 'object' &&
      String(previousValue) !== String(value);

    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5 px-2.5 rounded hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
        <span className="text-xs font-medium text-slate-600">{displayLabel}</span>
        <div className="flex items-center gap-2 text-right">
          {hasChanged && (
            <span className="text-[11px] text-slate-400 line-through tabular-nums">
              {formatScalarValue(previousValue)}
            </span>
          )}
          {isUrl ? (
            <a
              href={String(value)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1 break-all"
            >
              {String(value)}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          ) : (
            <span
              className={`text-xs font-semibold break-words ${
                typeof value === 'number'
                  ? 'text-slate-900 tabular-nums'
                  : typeof value === 'boolean'
                    ? value
                      ? 'text-emerald-700'
                      : 'text-slate-600'
                    : hasChanged
                      ? 'text-blue-700'
                      : 'text-slate-900'
              }`}
            >
              {formatScalarValue(value)}
            </span>
          )}
        </div>
      </div>
    );
  }

  const countLabel = Array.isArray(value)
    ? `${value.length} ${value.length === 1 ? 'item' : 'items'}`
    : `${childEntries.length} ${childEntries.length === 1 ? 'field' : 'fields'}`;

  return (
    <div className={depth === 0 ? '' : 'mt-1.5 border-l border-slate-200 pl-3'}>
      {!isRoot && (
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-slate-100 text-left transition-colors"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <span>{displayLabel}</span>
          </span>
          <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{countLabel}</span>
        </button>
      )}

      {(isOpen || isRoot) && (
        <div className={isRoot ? 'divide-y divide-slate-100' : 'mt-1'}>
          {childEntries.length === 0 ? (
            <div className="py-2 px-2 text-xs text-slate-400 italic">Empty</div>
          ) : (
            childEntries.map(([childKey, childVal]) => {
              const prevChild =
                Array.isArray(previousValue)
                  ? previousValue[Number(childKey)]
                  : isPlainObject(previousValue)
                    ? previousValue[childKey]
                    : undefined;
              return (
                <JsonTreeNode
                  key={childKey}
                  nodeKey={childKey}
                  value={childVal}
                  previousValue={prevChild}
                  depth={isRoot ? 0 : depth + 1}
                  searchQuery={searchQuery}
                  expandSignal={expandSignal}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export const SmartResultViewer: React.FC<SmartResultViewerProps> = ({
  query,
  result,
  previousResult,
  label,
  contextId
}) => {
  const { models } = useSettings();
  const analyzed = useMemo(() => analyzeResultPayload(result, previousResult), [result, previousResult]);

  const [mainMode, setMainMode] = useState<ViewerMainMode>('generic');
  const [activeTemplate, setActiveTemplate] = useState<GenericTemplateId>(analyzed.recommendedTemplate);
  const [selectedTableIdx, setSelectedTableIdx] = useState<number>(0);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{ colIdx: number; dir: 'asc' | 'desc' } | null>(null);
  const [explorerSearch, setExplorerSearch] = useState<string>('');
  const [expandSignal, setExpandSignal] = useState<{ version: number; expand: boolean }>({
    version: 0,
    expand: true
  });
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false);

  // AI Explainer state + per-result-and-persona cache
  const [selectedPersonaId, setSelectedPersonaId] = useState<DossierPersonaId>('school_student');
  const [explainerLoading, setExplainerLoading] = useState<boolean>(false);
  const [explainerError, setExplainerError] = useState<string | null>(null);
  const [explainerText, setExplainerText] = useState<string>('');
  const [explainerModelUsed, setExplainerModelUsed] = useState<string>('');
  const explanationCacheRef = useRef<Record<string, { text: string; modelUsed: string }>>({});

  const resultSig = useMemo(() => safeStableSignature(result), [result]);
  const prevSig = useMemo(
    () => (previousResult !== undefined && previousResult !== null ? safeStableSignature(previousResult) : 'none'),
    [previousResult]
  );

  // Reset recommended template when the underlying result payload changes
  useEffect(() => {
    setActiveTemplate(analyzed.recommendedTemplate);
    setSelectedTableIdx(0);
    setTableFilter('');
    setSortConfig(null);
  }, [resultSig, analyzed.recommendedTemplate]);

  const activePersona = useMemo(
    () => DOSSIER_PERSONAS.find((p) => p.id === selectedPersonaId) || DOSSIER_PERSONAS[0],
    [selectedPersonaId]
  );

  const cacheKey = `${contextId || 'res'}::${resultSig}::${prevSig}::${selectedPersonaId}`;

  const runAiExplainer = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh && explanationCacheRef.current[cacheKey]) {
        const cached = explanationCacheRef.current[cacheKey];
        setExplainerText(cached.text);
        setExplainerModelUsed(cached.modelUsed);
        setExplainerError(null);
        return;
      }

      setExplainerLoading(true);
      setExplainerError(null);
      try {
        const { text, modelUsed } = await agents.explainComparisonResults(
          {
            query: query || 'Data analysis result',
            newResult: analyzed.normalized ?? result,
            previousResult:
              previousResult !== undefined && previousResult !== null
                ? analyzed.previousNormalized ?? previousResult
                : undefined,
            targetAudienceInstruction: activePersona.instructionPrompt
          },
          models.explainer
        );
        explanationCacheRef.current[cacheKey] = { text, modelUsed };
        setExplainerText(text);
        setExplainerModelUsed(modelUsed);
      } catch (err: any) {
        setExplainerError(err?.message || 'Failed to generate AI explanation.');
      } finally {
        setExplainerLoading(false);
      }
    },
    [
      cacheKey,
      query,
      analyzed.normalized,
      analyzed.previousNormalized,
      result,
      previousResult,
      activePersona.instructionPrompt,
      models.explainer
    ]
  );

  // Trigger AI Explainer only when the user selects AI Explainer mode (or changes persona inside it)
  useEffect(() => {
    if (mainMode === 'ai_explainer') {
      const cached = explanationCacheRef.current[cacheKey];
      if (cached) {
        setExplainerText(cached.text);
        setExplainerModelUsed(cached.modelUsed);
        setExplainerError(null);
      } else {
        void runAiExplainer(false);
      }
    }
  }, [mainMode, cacheKey, runAiExplainer]);

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(analyzed.rawText);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 1800);
  };

  const activeTable = analyzed.tables[selectedTableIdx] || analyzed.tables[0] || null;

  const filteredAndSortedRows = useMemo(() => {
    if (!activeTable) return [];
    const q = tableFilter.trim().toLowerCase();
    let rows = activeTable.rows;
    if (q) {
      rows = rows.filter((r) => r.some((cell) => String(cell ?? '').toLowerCase().includes(q)));
    }
    if (sortConfig) {
      const { colIdx, dir } = sortConfig;
      rows = [...rows].sort((a, b) => {
        const av = a[colIdx];
        const bv = b[colIdx];
        const an = toNumericIfClean(av);
        const bn = toNumericIfClean(bv);
        let cmp = 0;
        if (an !== null && bn !== null) {
          cmp = an - bn;
        } else {
          cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        }
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [activeTable, tableFilter, sortConfig]);

  const handleToggleSort = (colIdx: number) => {
    setSortConfig((prev) => {
      if (!prev || prev.colIdx !== colIdx) return { colIdx, dir: 'asc' };
      if (prev.dir === 'asc') return { colIdx, dir: 'desc' };
      return null;
    });
  };

  const handleDownloadCsv = (tbl: DiscoveredTable) => {
    const safeRows = tbl.rows.map((r) =>
      r.map((cell) => (cell === null || cell === undefined ? '' : typeof cell === 'boolean' ? (cell ? 'true' : 'false') : cell))
    );
    const csv = exportBlockToCsv(tbl.headers, safeRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(tbl.title || 'result').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (analyzed.kind === 'empty') {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
        No result payload returned.
      </div>
    );
  }

  const summaryParts = [
    analyzed.formatLabel,
    analyzed.metrics.length > 0 ? `${analyzed.metrics.length} ${analyzed.metrics.length === 1 ? 'Metric' : 'Metrics'}` : null,
    analyzed.tables.length > 0 ? `${analyzed.tables.length} ${analyzed.tables.length === 1 ? 'Table' : 'Tables'}` : null,
    analyzed.chart ? 'Visual Chart' : null
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      {/* Top Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setMainMode('generic')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mainMode === 'generic'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Generic Viewer (Non-LLM)
          </button>
          <button
            type="button"
            onClick={() => setMainMode('ai_explainer')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mainMode === 'ai_explainer'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Explainer (LLM)
          </button>
        </div>

        <div className="flex items-center gap-2.5 text-[11px] text-slate-500">
          <span className="hidden sm:inline">{summaryParts.join(' · ')}</span>
          <button
            type="button"
            onClick={handleCopyRaw}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-[11px] font-medium whitespace-nowrap shrink-0"
            title="Copy raw payload"
          >
            {copiedRaw ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            {copiedRaw ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* GENERIC NON-LLM VIEWER */}
      {mainMode === 'generic' && (
        <div className="space-y-3">
          {/* Template Switcher Strip (3 Generic Templates + Raw) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex flex-wrap items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setActiveTemplate('summary')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTemplate === 'summary'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Summary &amp; Visuals
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('table')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTemplate === 'table'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                Data Table{analyzed.tables.length > 0 ? ` (${analyzed.tables.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('explorer')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTemplate === 'explorer'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                Human Explorer
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('raw')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTemplate === 'raw'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                Raw
              </button>
            </div>
          </div>

          {/* TEMPLATE 1: SUMMARY & VISUALS */}
          {activeTemplate === 'summary' && (
            <div className="space-y-3">
              {/* KPI Grid */}
              {analyzed.metrics.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {analyzed.metrics.slice(0, 12).map((m) => (
                    <div
                      key={m.path}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col justify-between gap-1"
                    >
                      <span className="text-[11px] font-medium text-slate-500 truncate" title={m.label}>
                        {m.label}
                      </span>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums break-words">
                          {m.formattedValue}
                        </span>
                        {m.numericDelta !== null && m.numericDelta !== undefined && Math.abs(m.numericDelta) > 1e-9 && (
                          <span
                            className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                              m.numericDelta > 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {m.numericDelta > 0 ? '+' : ''}
                            {formatNumber(m.numericDelta)}
                            {m.percentDelta !== null && m.percentDelta !== undefined
                              ? ` (${m.percentDelta > 0 ? '+' : ''}${m.percentDelta.toFixed(1)}%)`
                              : ''}
                          </span>
                        )}
                      </div>
                      {m.changed && m.previousFormatted !== undefined && (
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          Prev: {m.previousFormatted}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Visual Chart */}
              {analyzed.chart && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">{analyzed.chart.title}</div>
                  <div className="h-64 w-full relative">
                    {analyzed.chart.type === 'line' ? (
                      <Line
                        data={analyzed.chart.data}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { position: 'top' as const } },
                          ...(analyzed.chart.options || {})
                        }}
                      />
                    ) : analyzed.chart.type === 'pie' ? (
                      <Pie
                        data={analyzed.chart.data}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { position: 'top' as const } },
                          ...(analyzed.chart.options || {})
                        }}
                      />
                    ) : (
                      <Bar
                        data={analyzed.chart.data}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { position: 'top' as const } },
                          ...(analyzed.chart.options || {})
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Text / Narrative Section */}
              {analyzed.narrativeText && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <FormattedAnswerDisplay
                    content={analyzed.narrativeText}
                    compact
                    allowTableViewToggle={false}
                  />
                </div>
              )}

              {/* Top Table Preview when Summary has no chart or narrative (e.g. mixed payload) */}
              {!analyzed.chart && !analyzed.narrativeText && analyzed.tables.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      {analyzed.tables[0].title} · {analyzed.tables[0].rows.length} rows
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTemplate('table')}
                      className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Open full Data Table
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-60 border border-slate-200 rounded">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                          {analyzed.tables[0].headers.map((h, idx) => (
                            <th key={idx} className="px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">
                              {humanizeKey(h)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analyzed.tables[0].rows.slice(0, 8).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            {row.map((cell, cIdx) => {
                              const isNum = toNumericIfClean(cell) !== null;
                              return (
                                <td
                                  key={cIdx}
                                  className={`px-2.5 py-1.5 text-slate-800 ${
                                    isNum ? 'text-right tabular-nums font-medium' : ''
                                  }`}
                                >
                                  {formatScalarValue(cell)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Empty fallback inside Summary -> steer to Explorer */}
              {analyzed.metrics.length === 0 &&
                !analyzed.chart &&
                !analyzed.narrativeText &&
                analyzed.tables.length === 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <JsonTreeNode
                      nodeKey="__root__"
                      value={analyzed.normalized}
                      previousValue={analyzed.previousNormalized}
                      depth={0}
                      searchQuery=""
                      expandSignal={{ version: 0, expand: true }}
                    />
                  </div>
                )}
            </div>
          )}

          {/* TEMPLATE 2: DATA TABLE */}
          {activeTemplate === 'table' && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
              {!activeTable ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  No tabular structure detected in this payload. Try <strong>Human Explorer</strong> or{' '}
                  <strong>Summary &amp; Visuals</strong>.
                </div>
              ) : (
                <>
                  {/* Multi-table selector if > 1 table */}
                  {analyzed.tables.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100">
                      {analyzed.tables.map((t, idx) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTableIdx(idx);
                            setSortConfig(null);
                            setTableFilter('');
                          }}
                          className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                            idx === selectedTableIdx
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {t.title} ({t.rows.length})
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Toolbar: Filter + Row count + CSV Export */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                        placeholder="Filter table rows..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {filteredAndSortedRows.length} of {activeTable.rows.length} rows
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDownloadCsv(activeTable)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                      </button>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-md">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          {activeTable.headers.map((header, colIdx) => {
                            const isSorted = sortConfig?.colIdx === colIdx;
                            return (
                              <th
                                key={colIdx}
                                onClick={() => handleToggleSort(colIdx)}
                                className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 transition-colors"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <span>{humanizeKey(header)}</span>
                                  {isSorted ? (
                                    sortConfig?.dir === 'asc' ? (
                                      <ArrowUp className="w-3 h-3 text-blue-600" />
                                    ) : (
                                      <ArrowDown className="w-3 h-3 text-blue-600" />
                                    )
                                  ) : (
                                    <ArrowUpDown className="w-3 h-3 text-slate-300" />
                                  )}
                                </span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredAndSortedRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={activeTable.headers.length}
                              className="px-3 py-6 text-center text-slate-400"
                            >
                              No matching rows.
                            </td>
                          </tr>
                        ) : (
                          filteredAndSortedRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50">
                              {row.map((cell, cIdx) => {
                                const isNum = toNumericIfClean(cell) !== null;
                                return (
                                  <td
                                    key={cIdx}
                                    className={`px-3 py-2 text-slate-800 ${
                                      isNum ? 'text-right tabular-nums font-medium' : 'max-w-xs break-words'
                                    }`}
                                  >
                                    {formatScalarValue(cell)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TEMPLATE 3: HUMAN EXPLORER */}
          {activeTemplate === 'explorer' && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
              {typeof analyzed.normalized === 'string' ? (
                <FormattedAnswerDisplay
                  content={analyzed.normalized}
                  compact
                  allowTableViewToggle
                />
              ) : typeof analyzed.normalized !== 'object' || analyzed.normalized === null ? (
                <div className="py-3 px-2 text-sm font-semibold text-slate-900 tabular-nums">
                  {formatScalarValue(analyzed.normalized)}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={explorerSearch}
                        onChange={(e) => setExplorerSearch(e.target.value)}
                        placeholder="Search fields or values..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandSignal((s) => ({ version: s.version + 1, expand: true }))}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Expand All
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandSignal((s) => ({ version: s.version + 1, expand: false }))}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto pr-1">
                    <JsonTreeNode
                      nodeKey="__root__"
                      value={analyzed.normalized}
                      previousValue={analyzed.previousNormalized}
                      depth={0}
                      searchQuery={explorerSearch}
                      expandSignal={expandSignal}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* RAW VIEW */}
          {activeTemplate === 'raw' && (
            <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-3">
              <pre className="text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap break-words">
                {analyzed.rawText}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* AI EXPLAINER (ON-DEMAND LLM) */}
      {mainMode === 'ai_explainer' && (
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
          {/* Persona Selector */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Audience Persona{previousResult !== undefined && previousResult !== null ? ' · Comparing New vs. Previous Result' : ''}
              </span>
              <button
                type="button"
                onClick={() => void runAiExplainer(true)}
                disabled={explainerLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${explainerLoading ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {DOSSIER_PERSONAS.map((persona) => {
                const isSelected = persona.id === selectedPersonaId;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    onClick={() => setSelectedPersonaId(persona.id)}
                    title={persona.description}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {persona.shortLabel}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">{activePersona.description}</p>
          </div>

          {/* Explainer Output */}
          <div className="pt-2 border-t border-slate-100">
            {explainerLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-xs text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>
                  Tailoring explanation for <strong>{activePersona.shortLabel}</strong>
                  {previousResult !== undefined && previousResult !== null ? ' and comparing changes...' : '...'}
                </span>
              </div>
            ) : explainerError ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{explainerError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void runAiExplainer(true)}
                  className="px-2.5 py-1 rounded bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 text-xs font-medium whitespace-nowrap shrink-0"
                >
                  Retry
                </button>
              </div>
            ) : explainerText ? (
              <div className="space-y-2">
                <FormattedAnswerDisplay
                  content={explainerText}
                  compact
                  allowTableViewToggle
                />
                {explainerModelUsed && (
                  <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                    Explained as {activePersona.shortLabel} · Model: {explainerModelUsed}
                    {label ? ` · ${label}` : ''}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
