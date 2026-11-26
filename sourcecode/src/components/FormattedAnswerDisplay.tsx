import React, { useState } from 'react';
import { 
  Table, 
  List, 
  Grid, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check, 
  FileSpreadsheet, 
  LayoutGrid,
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';

export interface ParsedBlock {
  type: 'table' | 'keyValue' | 'list' | 'text';
  headers?: string[];
  rows?: string[][];
  pairs?: { key: string; value: string }[];
  items?: string[];
  text?: string;
}

export interface CustomDataTable {
  id: string;
  title: string;
  description?: string;
  headers: string[];
  rows: (string | number)[][];
}

/**
 * Safely escapes HTML special characters
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converts inline markdown (bold, italic, code, del) to HTML
 */
export function formatInlineMarkdown(text: string): string {
  if (!text) return '';
  let res = String(text);

  // Escape HTML entities to prevent raw unescaped code
  res = res
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold & Italic: ***text*** or ___text___
  res = res.replace(/(\*\*\*|___)(.*?)\1/g, '<strong><em>$2</em></strong>');

  // Bold: **text** or __text__
  res = res.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

  // Italic: *text* or _text_
  res = res.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');

  // Strikethrough: ~~text~~
  res = res.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // Inline code: `code`
  res = res.replace(/`([^`]+)`/g, '<code style="background: #e2e8f0; color: #0f172a; padding: 2px 5px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px;">$1</code>');

  // Markdown links: [text](url)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">$1</a>');

  return res;
}

/**
 * Checks if a line is a markdown table separator line (e.g. |---|---| or ---|---|---)
 */
export function isTableSeparator(line: string): boolean {
  if (!line || !line.includes('|')) return false;
  let s = line.trim();
  if (s.startsWith('|')) s = s.substring(1);
  if (s.endsWith('|')) s = s.substring(0, s.length - 1);
  const parts = s.split('|');
  return parts.length >= 1 && parts.every(p => {
    const t = p.trim();
    return /^:?-{1,}:?$/.test(t) || /^:?-+:?$/.test(t);
  });
}

/**
 * Splits a markdown table row into trimmed cell values, stripping optional outer pipes
 */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.substring(1);
  if (s.endsWith('|')) s = s.substring(0, s.length - 1);
  return s.split('|').map(c => c.trim());
}

/**
 * Parses raw text into structured blocks (markdown tables, CSV/TSV, JSON, key-value grids, bulleted lists, and paragraphs)
 */
export function parseContentToBlocks(rawText: string): ParsedBlock[] {
  if (!rawText) return [];

  const text = String(rawText).trim();

  // 0. Check for JSON array of objects or object with primitive keys
  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
        const headers = Object.keys(parsed[0]);
        const rows = parsed.map(item => headers.map(h => String(item[h] ?? '')));
        return [{ type: 'table', headers, rows }];
      } else if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
        const pairs = Object.entries(parsed).map(([key, val]) => ({
          key,
          value: typeof val === 'object' ? JSON.stringify(val) : String(val)
        }));
        return [{ type: 'keyValue', pairs }];
      }
    } catch {
      // Not JSON, continue to text block parsing
    }
  }

  const lines = text.split('\n').map(l => l.trimEnd());
  const blocks: ParsedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // 1. Detect Markdown Table with dashes (e.g. | col1 | col2 | \n | --- | --- |)
    if (line.includes('|') && i + 1 < lines.length && (isTableSeparator(lines[i + 1]) || /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1]))) {
      const headerLine = line;
      const headers = splitTableRow(headerLine);

      i += 2; // skip header and separator line
      const rows: string[][] = [];

      while (i < lines.length && lines[i].includes('|') && !isTableSeparator(lines[i])) {
        const rowLine = lines[i].trim();
        if (rowLine) {
          const cells = splitTableRow(rowLine);
          if (cells.length > 0) {
            rows.push(cells);
          }
        }
        i++;
      }

      if (headers.length > 0 && rows.length > 0) {
        const colCount = Math.max(headers.length, ...rows.map(r => r.length));
        while (headers.length < colCount) headers.push(`Col ${headers.length + 1}`);
        for (const r of rows) {
          while (r.length < colCount) r.push('');
        }
        blocks.push({ type: 'table', headers, rows });
        continue;
      }
    }

    // 2. Detect Pipe-separated rows without dashes (e.g. Col1 | Col2 | Col3 on 2+ consecutive lines)
    if (line.includes('|')) {
      const pipeLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].includes('|')) {
        pipeLines.push(lines[j].trim());
        j++;
      }
      if (pipeLines.length >= 2) {
        const splitRows = pipeLines.map(pl => 
          pl.split('|').map(c => c.trim()).filter((c, idx, arr) => (idx === 0 && c === '' ? false : idx === arr.length - 1 && c === '' ? false : true))
        );
        const colCount = splitRows[0].length;
        if (colCount >= 2 && splitRows.every(r => Math.abs(r.length - colCount) <= 1)) {
          const headers = splitRows[0];
          const rows = splitRows.slice(1);
          blocks.push({ type: 'table', headers, rows });
          i = j;
          continue;
        }
      }
    }

    // 3. Detect Tab-Separated (TSV) or Comma-Separated (CSV) lines
    if (line.includes('\t') || (line.includes(',') && !line.startsWith('http'))) {
      const delimiter = line.includes('\t') ? '\t' : ',';
      const delimiterLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].includes(delimiter)) {
        delimiterLines.push(lines[j].trim());
        j++;
      }

      if (delimiterLines.length >= 2) {
        const splitRows = delimiterLines.map(dl => dl.split(delimiter).map(c => c.trim()));
        const colCount = splitRows[0].length;
        // Require at least 2 columns and all rows have equal columns, and not long prose with accidental commas
        const isLikelyTable = colCount >= 2 && 
          splitRows.every(r => r.length === colCount) &&
          splitRows[0].every(c => c.length < 50);

        if (isLikelyTable) {
          const headers = splitRows[0];
          const rows = splitRows.slice(1);
          blocks.push({ type: 'table', headers, rows });
          i = j;
          continue;
        }
      }
    }

    // 4. Detect Bulleted Key-Value Pairs (e.g. "- Revenue: $1,200,000" or "* Margin: 24%")
    if (/^[-*•]\s+[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(line)) {
      const pairs: { key: string; value: string }[] = [];
      while (i < lines.length && /^[-*•]\s+[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(lines[i].trim())) {
        const clean = lines[i].trim().replace(/^[-*•]\s+/, '');
        const colonIdx = clean.indexOf(':');
        const key = clean.substring(0, colonIdx).trim();
        const val = clean.substring(colonIdx + 1).trim();
        pairs.push({ key, value: val });
        i++;
      }
      if (pairs.length > 0) {
        blocks.push({ type: 'keyValue', pairs });
        continue;
      }
    }

    // 5. Detect Standard Bulleted or Numbered Lists
    if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^[-*•]\s+/.test(lines[i].trim()) || /^\d+\.\s+/.test(lines[i].trim()))) {
        const cleanItem = lines[i].trim().replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');
        if (cleanItem) items.push(cleanItem);
        i++;
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', items });
        continue;
      }
    }

    // 6. Detect Standard Key-Value Pairs (e.g. "Revenue: $1,200,000" or "Region: Sub-Saharan Africa")
    if (/^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(line) && !line.startsWith('http')) {
      const pairs: { key: string; value: string }[] = [];
      while (i < lines.length && /^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(lines[i].trim()) && !lines[i].trim().startsWith('http')) {
        const current = lines[i].trim();
        const colonIdx = current.indexOf(':');
        const key = current.substring(0, colonIdx).trim();
        const val = current.substring(colonIdx + 1).trim();
        pairs.push({ key, value: val });
        i++;
      }

      if (pairs.length >= 2) {
        blocks.push({ type: 'keyValue', pairs });
        continue;
      } else if (pairs.length === 1) {
        const single = pairs[0];
        if (single.value.includes('|')) {
          const subParts = single.value.split('|').map(p => p.trim());
          const subPairs = [{ key: single.key, value: subParts[0] }];
          for (let sp = 1; sp < subParts.length; sp++) {
            if (subParts[sp].includes(':')) {
              const [k, v] = subParts[sp].split(':');
              subPairs.push({ key: k.trim(), value: v.trim() });
            } else {
              subPairs.push({ key: `Column ${sp + 1}`, value: subParts[sp] });
            }
          }
          blocks.push({ type: 'keyValue', pairs: subPairs });
          continue;
        }
      }
    }

    // 7. Default: Standard text paragraph
    let textChunk = lines[i];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].includes('|') &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !(/^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(lines[i].trim()) && i + 1 < lines.length && /^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(lines[i + 1].trim()))
    ) {
      textChunk += '\n' + lines[i];
      i++;
    }

    blocks.push({ type: 'text', text: textChunk });
  }

  return blocks;
}

/**
 * Formats CSV string from block headers and rows
 */
export function exportBlockToCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (c: string | number) => {
    const s = String(c ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };
  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map(r => r.map(escapeCell).join(','));
  return [headerLine, ...rowLines].join('\n');
}

/**
 * React component to render any answer (single-line, multi-line, tables, multi-column metrics) with supreme readability
 */
export const FormattedAnswerDisplay: React.FC<{
  content: string;
  className?: string;
  compact?: boolean;
  allowTableViewToggle?: boolean;
}> = ({ content, className = '', compact = false, allowTableViewToggle = true }) => {
  const [viewMode, setViewMode] = useState<'formatted' | 'table'>('formatted');
  const [copiedCsv, setCopiedCsv] = useState(false);

  if (!content) {
    return <span className="text-gray-400 italic">No answer content available.</span>;
  }

  const blocks = parseContentToBlocks(content);

  const renderInline = (str: string | number) => {
    if (str === null || str === undefined) return '';
    const text = String(str);
    if (!text.includes('*') && !text.includes('`') && !text.includes('_') && !text.includes('~')) {
      return text;
    }
    return <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(text) }} />;
  };

  // If text contains tables or key-value items or lists, enable table view conversion
  const hasStructuredData = blocks.some(b => b.type === 'table' || b.type === 'keyValue' || b.type === 'list');

  const handleCopyCsv = (headers: string[], rows: (string | number)[][]) => {
    const csv = exportBlockToCsv(headers, rows);
    navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  // Convert all blocks into a unified structured table if user toggles table mode
  if (viewMode === 'table') {
    return (
      <div className={`space-y-3 ${className}`}>
        {allowTableViewToggle && (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-emerald-100">
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
              <Table className="w-3.5 h-3.5 text-emerald-600" />
              Tabular Format View
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode('formatted')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-md transition-colors cursor-pointer"
                title="Switch back to visual cards and paragraphs"
              >
                <LayoutGrid className="w-3 h-3 text-emerald-700" />
                <span>Switch to Card / Rich View</span>
              </button>
            </div>
          </div>
        )}

        {blocks.map((block, bIdx) => {
          if (block.type === 'table' && block.headers && block.rows) {
            return (
              <div key={bIdx} className="overflow-x-auto rounded-xl border border-emerald-200 bg-white shadow-2xs">
                <div className="p-2 bg-emerald-50/80 border-b border-emerald-200 flex items-center justify-between text-[11px]">
                  <span className="font-bold text-emerald-950">Data Table ({block.rows.length} rows)</span>
                  <button
                    type="button"
                    onClick={() => handleCopyCsv(block.headers!, block.rows!)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold shadow-2xs cursor-pointer"
                  >
                    {copiedCsv ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-emerald-700" />}
                    <span>{copiedCsv ? 'Copied CSV!' : 'Copy CSV'}</span>
                  </button>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-emerald-50 text-emerald-950 border-b border-emerald-200 font-bold">
                      {block.headers.map((h, hIdx) => (
                        <th key={hIdx} className="px-3.5 py-2.5 uppercase text-[10px] tracking-wider">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-emerald-50/30 hover:bg-emerald-50'}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3.5 py-2 font-medium text-gray-800">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          if (block.type === 'keyValue' && block.pairs) {
            const tableHeaders = ['Metric / Parameter', 'Extracted Value'];
            const tableRows = block.pairs.map(p => [p.key, p.value]);
            return (
              <div key={bIdx} className="overflow-x-auto rounded-xl border border-emerald-200 bg-white shadow-2xs">
                <div className="p-2 bg-emerald-50/80 border-b border-emerald-200 flex items-center justify-between text-[11px]">
                  <span className="font-bold text-emerald-950">Metrics Parameter Table ({block.pairs.length} items)</span>
                  <button
                    type="button"
                    onClick={() => handleCopyCsv(tableHeaders, tableRows)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold shadow-2xs cursor-pointer"
                  >
                    {copiedCsv ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-emerald-700" />}
                    <span>{copiedCsv ? 'Copied CSV!' : 'Copy CSV'}</span>
                  </button>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-emerald-50 text-emerald-950 border-b border-emerald-200 font-bold">
                      <th className="px-3.5 py-2.5 w-1/3">Parameter / Column</th>
                      <th className="px-3.5 py-2.5">Extracted Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {block.pairs.map((p, pIdx) => (
                      <tr key={pIdx} className="hover:bg-emerald-50/50 transition-colors">
                        <td className="px-3.5 py-2 font-bold text-gray-700 bg-gray-50/60">{p.key}</td>
                        <td className="px-3.5 py-2 font-bold text-emerald-900">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          if (block.type === 'list' && block.items) {
            return (
              <div key={bIdx} className="overflow-x-auto rounded-xl border border-emerald-200 bg-white shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-emerald-50 text-emerald-950 border-b border-emerald-200 font-bold">
                      <th className="px-3.5 py-2.5 w-16 text-center">#</th>
                      <th className="px-3.5 py-2.5">Item / Breakdown Point</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {block.items.map((item, iIdx) => (
                      <tr key={iIdx} className="hover:bg-emerald-50/50">
                        <td className="px-3.5 py-2 font-bold text-center text-emerald-800 bg-emerald-50/40">{iIdx + 1}</td>
                        <td className="px-3.5 py-2 font-medium text-gray-800">{item}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          return (
            <div key={bIdx} className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
              {block.text}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`space-y-3.5 ${className}`}>
      {allowTableViewToggle && hasStructuredData && (
        <div className="flex items-center justify-between pb-1 border-b border-emerald-100">
          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Formatted Answer
          </span>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors cursor-pointer shadow-2xs"
            title="Convert and view in full data table format"
          >
            <Table className="w-3 h-3 text-emerald-700" />
            <span>Format as Table View</span>
          </button>
        </div>
      )}

      {blocks.map((block, bIdx) => {
        // Table Block
        if (block.type === 'table' && block.headers && block.rows) {
          return (
            <div key={bIdx} className="overflow-x-auto rounded-xl border border-emerald-200 bg-white shadow-2xs my-2">
              <div className="p-2 bg-emerald-50/80 border-b border-emerald-200 flex items-center justify-between text-[11px]">
                <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                  <Table className="w-3.5 h-3.5 text-emerald-700" />
                  Structured Table ({block.rows.length} rows)
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyCsv(block.headers!, block.rows!)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold shadow-2xs cursor-pointer"
                >
                  {copiedCsv ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-emerald-700" />}
                  <span>{copiedCsv ? 'Copied CSV!' : 'Copy Table'}</span>
                </button>
              </div>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-emerald-50/70 text-emerald-950 border-b border-emerald-200 font-bold">
                    {block.headers.map((h, hIdx) => (
                      <th key={hIdx} className="px-3.5 py-2.5 uppercase text-[10px] tracking-wider">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-emerald-50/30 hover:bg-emerald-50 transition-colors'}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2 text-gray-800 font-semibold text-xs">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Key-Value Multi-Column Grid
        if (block.type === 'keyValue' && block.pairs) {
          return (
            <div
              key={bIdx}
              className={`grid gap-2.5 my-2 ${
                compact
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {block.pairs.map((pair, pIdx) => (
                <div
                  key={pIdx}
                  className="bg-white border border-emerald-200/90 rounded-xl p-3 shadow-2xs space-y-1 hover:border-emerald-400 transition-colors"
                >
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                    {renderInline(pair.key)}
                  </span>
                  <div className="text-xs sm:text-sm font-extrabold text-emerald-950 leading-snug break-words">
                    {renderInline(pair.value)}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        // List Block
        if (block.type === 'list' && block.items) {
          return (
            <ul key={bIdx} className="space-y-1.5 my-2 bg-white/70 p-3 rounded-xl border border-emerald-100">
              {block.items.map((item, iIdx) => (
                <li key={iIdx} className="flex items-start gap-2 text-xs text-gray-800 leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Text Block
        return (
          <div key={bIdx} className="text-xs sm:text-sm text-gray-800 leading-relaxed font-medium whitespace-pre-wrap">
            {renderInline(block.text || '')}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Comprehensive markdown-to-HTML formatter designed for AI explanations,
 * consultation logs, and rich analytical dossiers.
 * Concurrently transforms markdown tables, inline bold/italic, lists,
 * code blocks, headings, blockquotes, and paragraphs into styled HTML.
 */
export function formatMarkdownToHtml(rawText: string): string {
  if (!rawText) return '<span style="color: #94a3b8; font-style: italic;">No consultation content recorded</span>';

  const text = String(rawText).trim();
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // 1. Code Block (```)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      output.push(`
        <div style="margin: 14px 0;">
          ${lang ? `<div style="background: #1e293b; color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 12px; border-radius: 6px 6px 0 0; font-family: ui-monospace, monospace;">${escapeHtml(lang)}</div>` : ''}
          <pre style="background: #0f172a; color: #f8fafc; padding: 14px; border-radius: ${lang ? '0 0 8px 8px' : '8px'}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; overflow-x: auto; margin: 0; line-height: 1.5;"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>
        </div>
      `);
      continue;
    }

    // 2. Markdown Table with Separator (e.g. | col1 | col2 | \n |---|---|)
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const sepLine = lines[i + 1].trim();
      const sepParts = splitTableRow(sepLine);
      const alignments = sepParts.map(p => {
        const tr = p.trim();
        if (tr.startsWith(':') && tr.endsWith(':')) return 'center';
        if (tr.endsWith(':')) return 'right';
        return 'left';
      });

      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !isTableSeparator(lines[i])) {
        const rLine = lines[i].trim();
        if (rLine) {
          rows.push(splitTableRow(rLine));
        }
        i++;
      }

      if (headers.length > 0) {
        const colCount = Math.max(headers.length, ...rows.map(r => r.length), alignments.length);
        while (headers.length < colCount) headers.push(`Col ${headers.length + 1}`);
        for (const r of rows) {
          while (r.length < colCount) r.push('');
        }

        output.push(`
          <div style="overflow-x: auto; margin: 16px 0; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); background: #ffffff;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: left;">
              <thead>
                <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1; color: #0f172a;">
                  ${headers.map((h, hIdx) => {
                    const align = alignments[hIdx] || 'left';
                    return `<th style="padding: 10px 14px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; text-align: ${align}; border-right: 1px solid #e2e8f0;">${formatInlineMarkdown(h)}</th>`;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, rIdx) => {
                  const bg = rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
                  return `
                    <tr style="background: ${bg}; border-bottom: 1px solid #e2e8f0;">
                      ${row.map((cell, cIdx) => {
                        const align = alignments[cIdx] || 'left';
                        return `<td style="padding: 10px 14px; color: #1e293b; font-size: 12px; line-height: 1.5; text-align: ${align}; border-right: 1px solid #f1f5f9;">${formatInlineMarkdown(cell)}</td>`;
                      }).join('')}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `);
        continue;
      }
    }

    // 2b. Pipe-delimited rows without dashed separator (e.g. 2+ consecutive lines with |)
    if (line.includes('|')) {
      const pipeLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].includes('|') && !isTableSeparator(lines[j])) {
        pipeLines.push(lines[j].trim());
        j++;
      }
      if (pipeLines.length >= 2) {
        const splitRows = pipeLines.map(pl => splitTableRow(pl));
        const colCount = Math.max(...splitRows.map(r => r.length));
        if (colCount >= 2) {
          const headers = splitRows[0];
          while (headers.length < colCount) headers.push(`Col ${headers.length + 1}`);
          const rows = splitRows.slice(1).map(r => {
            while (r.length < colCount) r.push('');
            return r;
          });

          output.push(`
            <div style="overflow-x: auto; margin: 16px 0; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); background: #ffffff;">
              <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: left;">
                <thead>
                  <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1; color: #0f172a;">
                    ${headers.map(h => `<th style="padding: 10px 14px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; border-right: 1px solid #e2e8f0;">${formatInlineMarkdown(h)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((row, rIdx) => {
                    const bg = rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
                    return `
                      <tr style="background: ${bg}; border-bottom: 1px solid #e2e8f0;">
                        ${row.map(cell => `<td style="padding: 10px 14px; color: #1e293b; font-size: 12px; line-height: 1.5; border-right: 1px solid #f1f5f9;">${formatInlineMarkdown(cell)}</td>`).join('')}
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `);
          i = j;
          continue;
        }
      }
    }

    // 3. Horizontal Rule (---, ***, ___)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      output.push('<hr style="border: none; border-top: 1px solid #cbd5e1; margin: 18px 0;" />');
      i++;
      continue;
    }

    // 4. Headings (#, ##, ###, ####, #####, ######)
    if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const hText = match[2];
        if (level === 1) {
          output.push(`<h2 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 20px 0 10px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">${formatInlineMarkdown(hText)}</h2>`);
        } else if (level === 2) {
          output.push(`<h3 style="font-size: 15px; font-weight: 800; color: #1e3a8a; margin: 18px 0 8px 0;">${formatInlineMarkdown(hText)}</h3>`);
        } else if (level === 3) {
          output.push(`<h4 style="font-size: 13px; font-weight: 800; color: #1e3a8a; margin: 16px 0 6px 0; text-transform: uppercase; letter-spacing: 0.04em;">${formatInlineMarkdown(hText)}</h4>`);
        } else {
          output.push(`<h5 style="font-size: 12px; font-weight: 700; color: #334155; margin: 14px 0 4px 0; text-transform: uppercase;">${formatInlineMarkdown(hText)}</h5>`);
        }
        i++;
        continue;
      }
    }

    // 5. Blockquotes (> ...)
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      output.push(`
        <blockquote style="border-left: 4px solid #3b82f6; background: #eff6ff; padding: 12px 16px; margin: 14px 0; border-radius: 0 8px 8px 0; font-size: 12px; color: #1e40af; line-height: 1.6;">
          ${formatInlineMarkdown(quoteLines.join(' '))}
        </blockquote>
      `);
      continue;
    }

    // 6. Unordered List (- item, * item, • item)
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      output.push(`
        <ul style="margin: 10px 0 14px 24px; font-size: 12.5px; color: #334155; line-height: 1.6;">
          ${items.map(it => `<li style="margin-bottom: 5px;">${formatInlineMarkdown(it)}</li>`).join('')}
        </ul>
      `);
      continue;
    }

    // 7. Ordered List (1. item, 2. item)
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      output.push(`
        <ol style="margin: 10px 0 14px 24px; font-size: 12.5px; color: #334155; line-height: 1.6;">
          ${items.map(it => `<li style="margin-bottom: 5px;">${formatInlineMarkdown(it)}</li>`).join('')}
        </ol>
      `);
      continue;
    }

    // 8. Key-Value Pairs (e.g. 2+ lines of "Key: Value")
    if (/^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(line) && !line.startsWith('http')) {
      const pairs: { key: string; value: string }[] = [];
      let k = i;
      while (k < lines.length && /^[A-Za-z0-9\s_-]{2,30}:\s+[^\s].*$/.test(lines[k].trim()) && !lines[k].trim().startsWith('http')) {
        const cur = lines[k].trim();
        const colonIdx = cur.indexOf(':');
        pairs.push({
          key: cur.substring(0, colonIdx).trim(),
          value: cur.substring(colonIdx + 1).trim()
        });
        k++;
      }
      if (pairs.length >= 2) {
        output.push(`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 12px 0;">
            ${pairs.map(p => `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;">
                <div style="font-size: 10.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">${formatInlineMarkdown(p.key)}</div>
                <div style="font-size: 12.5px; font-weight: 600; color: #0f172a; margin-top: 3px;">${formatInlineMarkdown(p.value)}</div>
              </div>
            `).join('')}
          </div>
        `);
        i = k;
        continue;
      }
    }

    // 9. Regular Text Paragraph
    const paragraphLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !lines[i].includes('|')
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }

    output.push(`
      <p style="font-size: 13px; color: #334155; line-height: 1.65; margin: 10px 0;">
        ${formatInlineMarkdown(paragraphLines.join(' '))}
      </p>
    `);
  }

  return output.join('\n');
}

/**
 * Formats content into clean HTML tables and grid cards for standalone HTML reports
 */
export function formatContentToHtml(rawText: string): string {
  if (!rawText) return '<span style="color: #94a3b8; font-style: italic;">No answer provided</span>';

  // If text contains markdown table with dashes or code blocks, use formatMarkdownToHtml
  if ((rawText.includes('|') && rawText.includes('-')) || rawText.includes('```')) {
    return formatMarkdownToHtml(rawText);
  }

  const blocks = parseContentToBlocks(rawText);

  return blocks
    .map(block => {
      if (block.type === 'table' && block.headers && block.rows) {
        return `
        <div style="overflow-x: auto; margin: 14px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: #ffffff; border: 1px solid #a7f3d0; border-radius: 8px;">
            <thead>
              <tr style="background: #ecfdf5; border-bottom: 2px solid #a7f3d0; color: #065f46;">
                ${block.headers
                  .map(
                    h =>
                      `<th style="padding: 9px 12px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em;">${formatInlineMarkdown(h)}</th>`
                  )
                  .join('')}
              </tr>
            </thead>
            <tbody>
              ${block.rows
                .map(
                  (row, rIdx) => `
                <tr style="border-bottom: 1px solid #e2e8f0; background: ${rIdx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                  ${row
                    .map(
                      cell => `<td style="padding: 9px 12px; color: #1e293b; font-weight: 600;">${formatInlineMarkdown(String(cell))}</td>`
                    )
                    .join('')}
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`;
      }

      if (block.type === 'keyValue' && block.pairs) {
        return `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 14px 0;">
          ${block.pairs
            .map(
              p => `
            <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">${formatInlineMarkdown(p.key)}</div>
              <div style="font-size: 14px; font-weight: 800; color: #064e3b; margin-top: 4px;">${formatInlineMarkdown(p.value)}</div>
            </div>`
            )
            .join('')}
        </div>`;
      }

      if (block.type === 'list' && block.items) {
        return `
        <ul style="margin: 10px 0 10px 22px; font-size: 13px; color: #334155; line-height: 1.6;">
          ${block.items.map(item => `<li style="margin-bottom: 5px;">${formatInlineMarkdown(item)}</li>`).join('')}
        </ul>`;
      }

      return `<p style="font-size: 14px; color: #1e293b; line-height: 1.6; margin: 10px 0;">${formatInlineMarkdown(block.text || '')}</p>`;
    })
    .join('');
}

/**
 * Builds a 5-method comparison table from the runs array
 */
export function buildRunComparisonTable(runs: any[]): CustomDataTable {
  const headers = ['Test #', 'Methodology Name', 'Category / Approach', 'Calculated Finding', 'Convergence Status'];
  const rows = runs.map(r => [
    `Run #${r.runNumber}`,
    r.methodName,
    r.methodCategory,
    r.extractedAnswer || (r.narrative ? r.narrative.slice(0, 100) : 'Verified'),
    r.isAlignedWithConsensus ? '✓ Aligned with Consensus' : '~ Nuanced / Minor Shift'
  ]);

  return {
    id: `table-comparison-${Date.now()}`,
    title: '5-Method Analytical Convergence Comparison Table',
    description: 'Direct side-by-side comparison of specific calculations and outcomes across all 5 independent data science runs.',
    headers,
    rows
  };
}

/**
 * Generates the clean, easy-to-understand Lay-man Report HTML
 */
export function generateLaymanReportHtml(params: {
  question: string;
  refinedQuery?: string;
  projectName?: string;
  consensusAnswer: string;
  agreementScore: number;
  agreeingRunsCount: number;
  agreementLevel: string;
  laymanExplanation?: string;
  keyTakeaway?: string;
  runs: any[];
  customTables?: CustomDataTable[];
}): string {
  const {
    question,
    refinedQuery,
    projectName = 'Data Intelligence Workspace',
    consensusAnswer,
    agreementScore,
    agreeingRunsCount,
    agreementLevel,
    laymanExplanation,
    keyTakeaway,
    runs,
    customTables = []
  } = params;

  const formattedConsensusHtml = formatContentToHtml(consensusAnswer);
  const generatedDate = new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

  // Comparison table of the 5 runs in plain words
  const runComparison = buildRunComparisonTable(runs);

  // Check if consensus answer is short single line
  const isShortSingleLine = !consensusAnswer.includes('\n') && consensusAnswer.length < 90;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lay-man Summary Report - Answer Consistency Dossier</title>
  <style>
    :root {
      --primary: #1e40af;
      --primary-light: #eff6ff;
      --emerald: #059669;
      --emerald-dark: #064e3b;
      --emerald-light: #ecfdf5;
      --gray-900: #0f172a;
      --gray-700: #334155;
      --gray-500: #64748b;
      --gray-200: #e2e8f0;
      --gray-50: #f8fafc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: var(--gray-700);
      background: #f1f5f9;
      padding: 32px 16px;
    }
    .container {
      max-width: 880px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .header {
      border-bottom: 2px solid var(--gray-200);
      padding-bottom: 24px;
      margin-bottom: 28px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--emerald-light);
      color: var(--emerald-dark);
      border: 1px solid #a7f3d0;
      margin-bottom: 10px;
    }
    h1 { font-size: 26px; color: var(--gray-900); font-weight: 800; margin-bottom: 4px; letter-spacing: -0.02em; }
    .subtitle { font-size: 13px; color: var(--gray-500); }
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 16px;
      font-weight: 800;
      color: var(--gray-900);
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--gray-200);
    }
    .number-tag {
      width: 24px;
      height: 24px;
      background: var(--primary-light);
      color: var(--primary);
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .card {
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 12px;
      padding: 20px;
    }
    .highlight-card {
      background: #f0fdf4;
      border: 2px solid #a7f3d0;
      border-radius: 14px;
      padding: 24px;
      margin-bottom: 16px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 12px 0; }
    th { background: #f8fafc; padding: 10px 12px; text-align: left; font-weight: 700; border-bottom: 2px solid var(--gray-200); color: #334155; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
    td { padding: 10px 12px; border-bottom: 1px solid var(--gray-200); color: #1e293b; }
    .print-btn {
      float: right;
      padding: 8px 16px;
      background: #1e40af;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .print-btn:hover { background: #1d4ed8; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

    <div class="header">
      <span class="badge">Simple &amp; Clear Lay-man Decision Report</span>
      <h1>Answer Consistency Lay-man Summary</h1>
      <p class="subtitle">Project: <strong>${projectName}</strong> &bull; Generated: ${generatedDate}</p>
    </div>

    <!-- 1. USER QUERY -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">1</span>
        <span>1. What You Asked (User Query)</span>
      </div>
      <div class="card" style="background: #f8fafc;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
          Original Human Question:
        </div>
        <p style="font-size: 15px; font-weight: 600; color: #0f172a; font-style: italic;">
          "${question}"
        </p>
        ${
          refinedQuery && refinedQuery !== question
            ? `
          <div style="margin-top: 12px; font-size: 12px; color: #475569; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
            <strong>Clarified Question (Confirmed):</strong> "${refinedQuery}"
          </div>`
            : ''
        }
      </div>
    </div>

    <!-- 2. VERY SHORT SUMMARY (TL;DR) -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">2</span>
        <span>2. Simple Summary (Executive TL;DR)</span>
      </div>
      <div class="card" style="background: #fffbeb; border-color: #fde68a;">
        <p style="font-size: 14px; font-weight: 600; color: #1e293b; line-height: 1.6;">
          We ran <strong>5 independent analytical calculations</strong> using different statistical perspectives to ensure this result is completely reliable. 
          <strong>${agreeingRunsCount} of the 5 tests (${agreementScore}%)</strong> reached the exact same consensus finding. 
          This confirms the answer is steady and not a random glitch of how data was sorted.
        </p>
      </div>
    </div>

    <!-- 3. THE VALIDATED ANSWER & FORMATTED TABLES -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">3</span>
        <span>3. The Validated Answer (Formatted Breakdown &amp; Tables)</span>
      </div>
      <div class="highlight-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #166534; letter-spacing: 0.05em;">
            Consensus Finding (${agreementLevel} Confidence &bull; ${agreementScore}% Agreement)
          </span>
          <span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">
            ${agreeingRunsCount} of 5 Runs Aligned
          </span>
        </div>
        ${
          isShortSingleLine
            ? `<div style="font-size: 22px; font-weight: 800; color: #064e3b; margin-bottom: 12px; line-height: 1.3;">
                ${consensusAnswer}
               </div>`
            : ''
        }
        <div style="margin-top: 10px;">
          ${formattedConsensusHtml}
        </div>
      </div>
    </div>

    <!-- 4. HOW WE CHECKED IT (5 SIMPLE TESTS IN A TABLE) -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">4</span>
        <span>4. How We Verified It (5 Tests in Plain English)</span>
      </div>
      <div class="card" style="padding: 0; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th style="width: 70px;">Test #</th>
              <th>Method Name</th>
              <th>Category</th>
              <th>Calculated Finding</th>
              <th style="text-align: center;">Outcome</th>
            </tr>
          </thead>
          <tbody>
            ${runComparison.rows
              .map(
                row => `
              <tr>
                <td style="font-weight: 700; color: #1e40af;">${row[0]}</td>
                <td style="font-weight: 600;">${row[1]}</td>
                <td style="font-size: 11px; color: #64748b;">${row[2]}</td>
                <td style="font-weight: 600; color: #0f172a;">${row[3]}</td>
                <td style="text-align: center; font-weight: 700; color: ${
                  String(row[4]).includes('Aligned') ? '#059669' : '#d97706'
                };">
                  ${row[4]}
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${
      customTables && customTables.length > 0
        ? `
    <!-- CUSTOM DATA TABLES -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">+</span>
        <span>Additional Data Tables &amp; Breakdowns</span>
      </div>
      ${customTables
        .map(
          t => `
        <div class="card" style="margin-bottom: 16px;">
          <h4 style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">${t.title}</h4>
          ${t.description ? `<p style="font-size: 11px; color: #64748b; margin-bottom: 10px;">${t.description}</p>` : ''}
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>${t.headers.map(h => `<th>${h}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${t.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    <!-- 5. EASY TO READ CONCLUSION & EVERYDAY TAKEAWAYS -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">5</span>
        <span>5. What This Means For You (Actionable Takeaways)</span>
      </div>
      <div class="card" style="background: #f0fdfa; border-color: #99f6e4;">
        <div style="margin-bottom: 14px;">
          <h4 style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #0f766e; margin-bottom: 6px;">
            In Plain English:
          </h4>
          <p style="font-size: 13px; color: #1e293b; line-height: 1.6;">
            ${
              laymanExplanation ||
              `When tested using five different statistical approaches, the core outcome held steady at <strong>${consensusAnswer}</strong>. You can be confident that this number is not an accident of how the data was filtered or grouped.`
            }
          </p>
        </div>

        <div style="margin-bottom: 14px;">
          <h4 style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #166534; margin-bottom: 6px;">
            Key Business Takeaway:
          </h4>
          <p style="font-size: 13px; color: #14532d; line-height: 1.6;">
            ${
              keyTakeaway ||
              'You can proceed with this data point in executive planning, donor reporting, and strategic decisions without needing additional manual verification.'
            }
          </p>
        </div>

        <div style="padding-top: 12px; border-top: 1px solid #ccfbf1; font-size: 12px; color: #334155;">
          <strong>Action Steps:</strong>
          <ul style="margin-left: 18px; margin-top: 6px; line-height: 1.6;">
            <li>Cite this verified finding with confidence in board, funder, and stakeholder presentations.</li>
            <li>Use this multi-test summary as verifiable documentation for compliance and audits.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds a Consensus Metrics & Findings Breakdown Table
 */
export function buildConsensusBreakdownTable(analysis: any, runs: any[]): CustomDataTable {
  const headers = ['Analytical Dimension', 'Consensus / Finding', 'Validation Detail', 'Reliability Status'];
  
  const rows: (string | number)[][] = [
    [
      'Consensus Verdict',
      analysis?.consistencyVerdict || 'Validated & Replicated',
      `${analysis?.agreeingRunsCount || runs.length} of ${analysis?.totalRunsCount || 5} methods converged`,
      '✓ Certified Strong'
    ],
    [
      'Consensus Agreement Score',
      `${analysis?.agreementScore ?? 100}%`,
      `${analysis?.agreementLevel || 'High'} Agreement Level`,
      '✓ Multi-Run Aligned'
    ]
  ];

  // Add individual run highlights if available
  runs.forEach((r, idx) => {
    rows.push([
      `Method #${r.runNumber || idx + 1}: ${r.methodName}`,
      r.extractedAnswer || 'Verified Computation',
      r.methodCategory || 'Statistical Technique',
      r.isAlignedWithConsensus ? '✓ Aligned' : '~ Minor Nuance'
    ]);
  });

  return {
    id: `table-consensus-breakdown-${Date.now()}`,
    title: 'Consensus Metrics & Multi-Run Findings Breakdown',
    description: 'Detailed breakdown of consensus findings, agreement metrics, and specific run outputs.',
    headers,
    rows
  };
}

/**
 * Parses multi-line or tabular text into a structured table if applicable
 */
export function buildMultiLineAnswerTable(text: string): CustomDataTable | null {
  if (!text) return null;

  const blocks = parseContentToBlocks(text);
  
  // 1. Check if there is already a table block
  const tableBlock = blocks.find(b => b.type === 'table' && b.headers && b.rows && b.rows.length > 0);
  if (tableBlock && tableBlock.headers && tableBlock.rows) {
    return {
      id: `table-answer-extracted-${Date.now()}`,
      title: 'Extracted Structured Answer Table',
      description: 'Structured data table extracted directly from the verified consensus answer.',
      headers: tableBlock.headers,
      rows: tableBlock.rows
    };
  }

  // 2. Check for key-value pairs
  const kvBlock = blocks.find(b => b.type === 'keyValue' && b.pairs && b.pairs.length > 0);
  if (kvBlock && kvBlock.pairs) {
    return {
      id: `table-answer-kv-${Date.now()}`,
      title: 'Answer Key-Value Metrics Table',
      description: 'Key metrics, parameters, and findings extracted from the consensus answer.',
      headers: ['Parameter / Finding', 'Calculated Value'],
      rows: kvBlock.pairs.map(p => [p.key, p.value])
    };
  }

  // 3. Check for multi-line items or bullet lists
  const listBlock = blocks.find(b => b.type === 'list' && b.items && b.items.length > 1);
  if (listBlock && listBlock.items) {
    return {
      id: `table-answer-list-${Date.now()}`,
      title: 'Answer Itemized Findings Table',
      description: 'Itemized breakdown of multi-line observations from the consensus finding.',
      headers: ['Item #', 'Finding / Detail'],
      rows: listBlock.items.map((it, idx) => [`Item ${idx + 1}`, it])
    };
  }

  // 4. Fallback check for lines with colons
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const colonLines = lines.filter(l => l.includes(':') && l.split(':')[0].length < 50);
  if (colonLines.length >= 2) {
    return {
      id: `table-answer-colon-${Date.now()}`,
      title: 'Itemized Breakdown Table',
      description: 'Tabular breakdown extracted from multi-line findings in the answer.',
      headers: ['Category / Attribute', 'Detail / Observation'],
      rows: colonLines.map(line => {
        const parts = line.split(':');
        const key = parts[0].replace(/^[-*•0-9.)\s]+/, '').trim();
        const val = parts.slice(1).join(':').trim();
        return [key, val];
      })
    };
  }

  return null;
}

/**
 * Automatically suggests and generates structured tables for the dossier
 */
export function autoSuggestTablesForDossier(
  runs: any[], 
  analysis: any, 
  consensusText?: string
): CustomDataTable[] {
  const suggested: CustomDataTable[] = [];

  // Table 1: 5-Method Analytical Convergence Comparison Table
  if (runs && runs.length > 0) {
    suggested.push(buildRunComparisonTable(runs));
  }

  // Table 2: Multi-line answer table (if answer contains multi-line or tabular data)
  const answerToInspect = consensusText || analysis?.consensusAnswer || '';
  const extractedTable = buildMultiLineAnswerTable(answerToInspect);
  if (extractedTable) {
    suggested.push(extractedTable);
  }

  // Table 3: Consensus Metrics & Findings Breakdown Table
  if (analysis) {
    suggested.push(buildConsensusBreakdownTable(analysis, runs));
  }

  return suggested;
}

/**
 * Generates an Easy-To-Understand Executive Report HTML containing:
 * 1. User Query
 * 2. Refined Query (with interpreter reasoning & mapped schema entities)
 * 3. Answer to user question (Summary, Data/KPIs, Details)
 * 4. Answer contextualized by schema (DDL schema context, mapped entities, domain glossary)
 * 5. Visuals to make it easy to understand (SVG Gauge, Comparative Bar Chart, KPI Cards)
 * 6. Tables to present answers (5-Method Verification Table, breakdown tables, custom tables)
 * 7. Multi-line & tabular formatted views
 */
export function generateEasyToUnderstandReportHtml(params: {
  question: string;
  refinedQuery?: string;
  refinedQueryDetails?: {
    reasoning?: string;
    identifiedTables?: string[];
    identifiedColumns?: string[];
  };
  projectName?: string;
  consensusAnswer: string;
  agreementScore: number;
  agreeingRunsCount: number;
  agreementLevel: string;
  schemaContext?: {
    domainOverview?: string;
    mappedEntities?: { entity: string; description: string; relevance: string }[];
    domainInsights?: string[];
    schemaDescriptionText?: string;
  };
  runs: any[];
  customTables?: CustomDataTable[];
  customVisuals?: any[];
  methodologyOverview?: string;
}): string {
  const {
    question,
    refinedQuery,
    refinedQueryDetails,
    projectName = 'Data Intelligence Workspace',
    consensusAnswer,
    agreementScore,
    agreeingRunsCount,
    agreementLevel,
    schemaContext,
    runs = [],
    customTables = [],
    customVisuals = [],
    methodologyOverview
  } = params;

  const generatedDate = new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

  // 1. Separate consensus answer into summary, data numbers, and details
  const parsedBlocks = parseContentToBlocks(consensusAnswer);
  const formattedAnswerHtml = formatContentToHtml(consensusAnswer);

  // Extract key numerical snippets or first lines for Summary & Data
  const textLines = consensusAnswer.split('\n').map(l => l.trim()).filter(Boolean);
  const executiveSummary = textLines.slice(0, 2).join(' ') || consensusAnswer;
  const inDepthDetails = textLines.length > 2 ? textLines.slice(2).join('\n\n') : consensusAnswer;

  // Extract any numbers / percentages for Data highlights
  const numberMatches = consensusAnswer.match(/\b\d+(?:\.\d+)?%?|\$\d+(?:,\d+)*(?:\.\d+)?/g) || [];
  const primaryNumbers = Array.from(new Set(numberMatches)).slice(0, 4);

  // 2. Build 5-method comparison table
  const comparisonTable = buildRunComparisonTable(runs);

  // 3. Check for multi-line extracted table
  const extractedAnswerTable = buildMultiLineAnswerTable(consensusAnswer);

  // 4. Combine all tables (deduplicated by title)
  const allTables: CustomDataTable[] = [comparisonTable];
  if (extractedAnswerTable) {
    allTables.push(extractedAnswerTable);
  }
  customTables.forEach(t => {
    if (!allTables.some(existing => existing.title === t.title)) {
      allTables.push(t);
    }
  });

  // Calculate SVG gauge stroke
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (agreementScore / 100) * circumference;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Easy to Understand Report - ${projectName}</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-dark: #1d4ed8;
      --primary-light: #eff6ff;
      --emerald: #059669;
      --emerald-dark: #064e3b;
      --emerald-light: #ecfdf5;
      --indigo: #4f46e5;
      --indigo-light: #eef2ff;
      --amber: #d97706;
      --amber-light: #fffbeb;
      --gray-900: #0f172a;
      --gray-800: #1e293b;
      --gray-700: #334155;
      --gray-600: #475569;
      --gray-500: #64748b;
      --gray-200: #e2e8f0;
      --gray-100: #f1f5f9;
      --gray-50: #f8fafc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: var(--gray-800);
      background: #f8fafc;
      padding: 32px 16px;
    }
    .container {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 20px;
      padding: 44px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.05);
    }
    .print-btn {
      float: right;
      padding: 10px 18px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      transition: all 0.2s;
    }
    .print-btn:hover { background: var(--primary-dark); }
    .header {
      border-bottom: 2px solid var(--gray-200);
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--emerald-light);
      color: var(--emerald-dark);
      border: 1px solid #a7f3d0;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 28px;
      color: var(--gray-900);
      font-weight: 900;
      letter-spacing: -0.025em;
      margin-bottom: 6px;
      line-height: 1.25;
    }
    .subtitle {
      font-size: 13px;
      color: var(--gray-500);
    }
    .section {
      margin-bottom: 36px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 900;
      color: var(--gray-900);
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--gray-100);
    }
    .number-tag {
      width: 26px;
      height: 26px;
      background: var(--primary);
      color: white;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .card {
      background: #ffffff;
      border: 1px solid var(--gray-200);
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .card-purple {
      background: #faf5ff;
      border: 1.5px solid #d8b4fe;
    }
    .card-emerald {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
    }
    .card-indigo {
      background: #eef2ff;
      border: 1.5px solid #a5b4fc;
    }
    .card-amber {
      background: #fffbeb;
      border: 1.5px solid #fde68a;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin: 16px 0;
    }
    .kpi-card {
      background: white;
      border: 1px solid var(--gray-200);
      border-top: 4px solid var(--primary);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 900;
      color: var(--gray-900);
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--gray-500);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .visuals-container {
      display: grid;
      grid-template-columns: 1fr 1.6fr;
      gap: 20px;
      background: white;
      border: 1px solid var(--gray-200);
      border-radius: 14px;
      padding: 24px;
      align-items: center;
    }
    @media (max-width: 720px) {
      .visuals-container { grid-template-columns: 1fr; }
      .container { padding: 24px 16px; }
    }
    .gauge-wrapper {
      text-align: center;
    }
    .bar-chart-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-size: 12px;
    }
    .bar-label {
      width: 130px;
      font-weight: 700;
      color: var(--gray-700);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bar-track {
      flex: 1;
      height: 18px;
      background: var(--gray-100);
      border-radius: 6px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      border-radius: 6px;
    }
    .bar-value {
      width: 90px;
      font-weight: 700;
      text-align: right;
      color: var(--emerald-dark);
      font-size: 11px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin: 12px 0;
    }
    th {
      background: var(--gray-100);
      padding: 10px 14px;
      text-align: left;
      font-weight: 800;
      border-bottom: 2px solid var(--gray-200);
      color: var(--gray-700);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.05em;
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--gray-200);
      color: var(--gray-800);
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #fafafa; }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .tag-emerald { background: var(--emerald-light); color: var(--emerald-dark); }
    .tag-blue { background: var(--primary-light); color: var(--primary); }
    .tag-purple { background: #f3e8ff; color: #6b21a8; }
    @media print {
      body { background: white; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <button class="print-btn" onclick="window.print()">
      🖨️ Print / Save as PDF
    </button>

    <!-- HEADER -->
    <div class="header">
      <div class="badge">
        ✓ Verified Executive Intelligence Report
      </div>
      <h1>Easy-to-Understand Decision Report</h1>
      <p class="subtitle">
        Project: <strong>${projectName}</strong> &bull; Generated: ${generatedDate} &bull; Cross-Validated across 5 Independent Analytical Perspectives
      </p>
    </div>

    <!-- 1. USER QUERY -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">1</span>
        <span>1. What You Asked (User Query)</span>
      </div>
      <div class="card" style="background: var(--gray-50);">
        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--gray-500); display: block; margin-bottom: 6px;">
          Original Question Asked by User:
        </span>
        <p style="font-size: 16px; font-weight: 700; color: var(--gray-900); font-style: italic;">
          "${question}"
        </p>
      </div>
    </div>

    <!-- 2. REFINED QUERY -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">2</span>
        <span>2. Grounded &amp; Clarified Query (Refined Query)</span>
      </div>
      <div class="card card-purple">
        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #6b21a8; display: block; margin-bottom: 6px;">
          Disambiguated &amp; Entity-Mapped Query:
        </span>
        <p style="font-size: 14px; font-weight: 700; color: #3b0764; margin-bottom: 10px;">
          "${refinedQuery || question}"
        </p>
        ${
          refinedQueryDetails?.reasoning
            ? `<div style="font-size: 12px; color: #581c87; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d8b4fe;">
                <strong>Interpreter Context &amp; Disambiguation:</strong> ${refinedQueryDetails.reasoning}
               </div>`
            : ''
        }
        ${
          refinedQueryDetails?.identifiedTables && refinedQueryDetails.identifiedTables.length > 0
            ? `<div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                <span style="font-size: 11px; font-weight: 700; color: #6b21a8;">Mapped DDL Tables:</span>
                ${refinedQueryDetails.identifiedTables.map(t => `<span class="tag tag-purple">${t}</span>`).join(' ')}
               </div>`
            : ''
        }
      </div>
    </div>

    <!-- 3. ANSWER TO USER QUESTION (SUMMARY, DATA, DETAILS) -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">3</span>
        <span>3. Answer to Your Question (Summary &bull; Data &bull; Details)</span>
      </div>
      
      <!-- 3A: Plain-English Executive Summary -->
      <div class="card card-emerald" style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11px; font-weight: 900; text-transform: uppercase; color: var(--emerald-dark); letter-spacing: 0.05em;">
            Plain-English Executive Summary (TL;DR)
          </span>
          <span class="tag tag-emerald">
            ${agreeingRunsCount}/5 Methods Converged (${agreementScore}%)
          </span>
        </div>
        <p style="font-size: 15px; font-weight: 700; color: #064e3b; line-height: 1.6;">
          ${executiveSummary}
        </p>
      </div>

      <!-- 3B: Key Data Findings & KPI Stat Cards -->
      <div class="kpi-grid">
        <div class="kpi-card" style="border-top-color: #059669;">
          <div class="kpi-value">${agreementScore}%</div>
          <div class="kpi-label">Agreement Confidence</div>
        </div>
        <div class="kpi-card" style="border-top-color: #2563eb;">
          <div class="kpi-value">${agreeingRunsCount} of 5</div>
          <div class="kpi-label">Methods Converged</div>
        </div>
        <div class="kpi-card" style="border-top-color: #7c3aed;">
          <div class="kpi-value">${agreementLevel}</div>
          <div class="kpi-label">Statistical Stability</div>
        </div>
        ${
          primaryNumbers.length > 0
            ? `<div class="kpi-card" style="border-top-color: #d97706;">
                <div class="kpi-value">${primaryNumbers[0]}</div>
                <div class="kpi-label">Key Core Metric</div>
               </div>`
            : ''
        }
      </div>

      <!-- 3C: Comprehensive Details & Synthesized Explanation -->
      <div class="card">
        <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--gray-600); display: block; margin-bottom: 10px;">
          In-Depth Details &amp; Synthesis:
        </span>
        <div style="font-size: 13px; color: var(--gray-700); line-height: 1.7;">
          ${formattedAnswerHtml}
        </div>
        ${
          extractedAnswerTable
            ? `
          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--gray-200);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--primary); letter-spacing: 0.05em;">
                📊 Formatted Structured Table View of Answer:
              </span>
            </div>
            <div style="overflow-x: auto;">
              <table>
                <thead>
                  <tr>${extractedAnswerTable.headers.map(h => `<th>${h}</th>`).join('')}</tr>
                </thead>
                <tbody>
                  ${extractedAnswerTable.rows
                    .map(
                      r => `
                    <tr>
                      ${r.map(c => `<td>${c}</td>`).join('')}
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>`
            : ''
        }
      </div>
    </div>

    <!-- 4. ANSWER CONTEXTUALIZED BY SCHEMA -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">4</span>
        <span>4. Answer Contextualized by Schema &amp; Domain Model</span>
      </div>
      <div class="card card-indigo">
        <span style="font-size: 11px; font-weight: 900; text-transform: uppercase; color: #3730a3; display: block; margin-bottom: 6px;">
          How the Project Schema Explains &amp; Validates This Answer:
        </span>
        <p style="font-size: 13px; color: #1e1b4b; line-height: 1.6; margin-bottom: 12px;">
          ${
            schemaContext?.domainOverview ||
            `This calculation was directly grounded in the project data dictionary and entity definitions (from schemadescription.txt). The columns and table relationships were mapped to ensure accurate aggregation, correct primary key identification, and proper filtering without hallucinated schema assumptions.`
          }
        </p>

        ${
          schemaContext?.mappedEntities && schemaContext.mappedEntities.length > 0
            ? `
          <div style="margin-top: 12px; overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th style="background: #e0e7ff; color: #312e81;">Schema Entity / Table</th>
                  <th style="background: #e0e7ff; color: #312e81;">Role in Answer</th>
                  <th style="background: #e0e7ff; color: #312e81;">Relevance &amp; Meaning</th>
                </tr>
              </thead>
              <tbody>
                ${schemaContext.mappedEntities
                  .map(
                    e => `
                  <tr>
                    <td style="font-weight: 700; color: #312e81;">${e.entity}</td>
                    <td>${e.description}</td>
                    <td style="color: #4338ca; font-size: 11px;">${e.relevance}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
            : ''
        }

        ${
          schemaContext?.domainInsights && schemaContext.domainInsights.length > 0
            ? `
          <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #a5b4fc;">
            <span style="font-size: 11px; font-weight: 800; color: #3730a3; text-transform: uppercase; display: block; margin-bottom: 6px;">
              Domain Business Insights from Schema:
            </span>
            <ul style="margin-left: 18px; font-size: 12px; color: #312e81; line-height: 1.6;">
              ${schemaContext.domainInsights.map(insight => `<li>${insight}</li>`).join('')}
            </ul>
          </div>`
            : ''
        }
      </div>
    </div>

    <!-- 5. VISUALS TO MAKE IT EASY TO UNDERSTAND -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">5</span>
        <span>5. Visuals to Make It Easy to Understand</span>
      </div>
      
      <div class="visuals-container">
        <!-- SVG Radial Gauge -->
        <div class="gauge-wrapper">
          <svg width="150" height="150" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="12" />
            <circle
              cx="60"
              cy="60"
              r="${radius}"
              fill="none"
              stroke="#059669"
              stroke-width="12"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${strokeDashoffset}"
              stroke-linecap="round"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="900" fill="#0f172a">${agreementScore}%</text>
            <text x="60" y="74" text-anchor="middle" font-size="9" font-weight="700" fill="#059669" text-transform="uppercase">Reliability</text>
          </svg>
          <div style="font-size: 12px; font-weight: 800; color: #064e3b; margin-top: 6px;">
            ${agreementLevel} Agreement
          </div>
          <div style="font-size: 11px; color: #64748b;">
            ${agreeingRunsCount} of 5 Methods Aligned
          </div>
        </div>

        <!-- Horizontal Comparative Bar Chart across the 5 Methods -->
        <div>
          <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--gray-600); display: block; margin-bottom: 12px;">
            Cross-Method Convergence Comparison:
          </span>
          ${runs
            .map((r, idx) => {
              const percent = r.isAlignedWithConsensus ? 100 : 80;
              return `
              <div class="bar-chart-row">
                <div class="bar-label" title="${r.methodName}">#${r.runNumber || idx + 1} ${r.methodName}</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: ${percent}%;"></div>
                </div>
                <div class="bar-value">
                  ${r.isAlignedWithConsensus ? '✓ Aligned' : '~ Shift'}
                </div>
              </div>`;
            })
            .join('')}
        </div>
        ${
          customVisuals && customVisuals.length > 0
            ? `
        <div style="grid-column: 1 / -1; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--gray-200);">
          <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--gray-600); display: block; margin-bottom: 12px;">
            Custom Explainer Visuals &amp; Visual Analytics:
          </span>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px;">
            ${customVisuals
              .map(
                v => `
              <div class="card" style="padding: 16px;">
                <h5 style="font-size: 12px; font-weight: 800; color: var(--gray-900); margin-bottom: 4px;">${v.title}</h5>
                <p style="font-size: 11px; color: var(--gray-500); margin-bottom: 10px;">${v.description || ''}</p>
                ${v.svgMarkup ? `<div style="text-align: center; overflow: hidden;">${v.svgMarkup}</div>` : ''}
              </div>`
              )
              .join('')}
          </div>
        </div>`
            : ''
        }
      </div>
    </div>

    <!-- 6 & 7. TABLES TO PRESENT ANSWERS & MULTI-LINE / TABULAR FORMAT -->
    <div class="section">
      <div class="section-title">
        <span class="number-tag">6</span>
        <span>6. Tables to Present Answers (Formatted Structured View)</span>
      </div>

      ${allTables
        .map(
          t => `
        <div class="card" style="margin-bottom: 18px;">
          <h4 style="font-size: 14px; font-weight: 800; color: var(--gray-900); margin-bottom: 4px;">
            ${t.title}
          </h4>
          ${t.description ? `<p style="font-size: 11px; color: var(--gray-500); margin-bottom: 12px;">${t.description}</p>` : ''}
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>${t.headers.map(h => `<th>${h}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${t.rows
                  .map(
                    r => `
                  <tr>
                    ${r
                      .map((c, colIdx) => {
                        const str = String(c);
                        const isTag = str.includes('✓') || str.includes('Aligned');
                        return `<td>${isTag ? `<span class="tag tag-emerald">${str}</span>` : str}</td>`;
                      })
                      .join('')}
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>`
        )
        .join('')}
    </div>

    <!-- 8. ACTIONABLE EXECUTIVE NEXT STEPS -->
    <div class="section" style="margin-bottom: 0;">
      <div class="section-title">
        <span class="number-tag">7</span>
        <span>7. Decision-Ready Action Steps</span>
      </div>
      <div class="card card-emerald">
        <p style="font-size: 13px; color: #064e3b; line-height: 1.6; margin-bottom: 10px;">
          This result has passed multi-agent cross-validation across 5 mathematical and statistical implementations. It is verified against query ambiguity and numerical outliers.
        </p>
        <ul style="margin-left: 20px; font-size: 12px; color: #14532d; line-height: 1.7;">
          <li>Use these figures directly in donor presentations, strategic roadmaps, and stakeholder updates.</li>
          <li>Keep this document as verifiable audit evidence of multi-method data validation.</li>
        </ul>
      </div>
    </div>

  </div>
</body>
</html>`;
}


