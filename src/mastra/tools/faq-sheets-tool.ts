import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type FaqEntry = {
  question: string;
  answer: string;
  category?: string;
  raw?: Record<string, string>;
};

function parseSheetUrl(sheetUrl?: string): { docId: string; gid?: string } {
  const envUrl = process.env.RUNVC_FAQ_SHEET_URL;
  const url = sheetUrl || envUrl;
  if (!url) {
    throw new Error('FAQ sheet URL not provided. Set RUNVC_FAQ_SHEET_URL or pass sheetUrl.');
  }
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('Invalid Google Sheets URL. Expected /spreadsheets/d/<id>/...');
  const docId = m[1];
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : undefined;
  return { docId, gid };
}

function exportCsvUrl(docId: string, gid?: string) {
  const base = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

// Minimal CSV parser handling quoted fields and commas
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        cur.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && csv[i + 1] === '\n') i++;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.length > 0);
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapColumns(headers: string[]) {
  const norm = headers.map(normalizeHeader);
  const qIdx = norm.findIndex((h) => ['question', 'q', 'prompt', 'faq question'].includes(h));
  const aIdx = norm.findIndex((h) => ['answer', 'a', 'response', 'reply', 'faq answer', 'content', 'text'].includes(h));
  const cIdx = norm.findIndex((h) => ['category', 'section', 'tag', 'topic'].includes(h));
  return { qIdx, aIdx, cIdx };
}

function buildEntries(rows: string[][]): FaqEntry[] {
  if (!rows.length) return [];
  const headers = rows[0];
  const { qIdx, aIdx, cIdx } = mapColumns(headers);
  const entries: FaqEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const question = (r[qIdx] || '').trim();
    const answer = (r[aIdx] || '').trim();
    if (!question || !answer) continue;
    const category = cIdx >= 0 ? (r[cIdx] || '').trim() : undefined;
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => (raw[h] = r[idx] || ''));
    entries.push({ question, answer, category, raw });
  }
  return entries;
}

function relevanceScore(query: string, text: string): number {
  const toTerms = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  const q = new Set(toTerms(query));
  const t = toTerms(text);
  let score = 0;
  for (const term of t) if (q.has(term)) score += 1;
  return score / Math.sqrt(t.length + 1);
}

async function loadFaqEntries(sheetUrl?: string, gid?: string, ttlMinutes = 10): Promise<{ entries: FaqEntry[]; source: string }>
{
  const { docId, gid: parsedGid } = parseSheetUrl(sheetUrl);
  const g = gid || parsedGid;
  const url = exportCsvUrl(docId, g);
  const cacheDir = join(process.cwd(), 'data');
  const cacheFile = join(cacheDir, `faq_${docId}_${g || 'default'}.json`);
  const now = Date.now();

  try {
    if (existsSync(cacheFile)) {
      const st = await stat(cacheFile);
      const ageMin = (now - st.mtime.getTime()) / (1000 * 60);
      if (ageMin < ttlMinutes) {
        const raw = await readFile(cacheFile, 'utf8');
        const data = JSON.parse(raw) as { entries: FaqEntry[]; source: string };
        return data;
      }
    }
  } catch {}

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet CSV. Ensure the sheet is shared as 'Anyone with the link can view' or publish to web. HTTP ${res.status}`);
  }
  const csv = await res.text();
  const rows = parseCsv(csv);
  const entries = buildEntries(rows);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ entries, source: url }, null, 2), 'utf8');
  return { entries, source: url };
}

export const faqSheetsQaTool = createTool({
  id: 'faq-sheets-qa',
  description: 'Answer a question using FAQs from a Google Sheet (CSV export). Reads RUNVC_FAQ_SHEET_URL by default.',
  inputSchema: z.object({
    question: z.string(),
    sheetUrl: z.string().optional(),
    gid: z.union([z.string(), z.number()]).optional(),
    ttlMinutes: z.number().int().min(0).max(1440).default(10),
  }),
  outputSchema: z.object({
    answer: z.string(),
    matches: z.array(z.object({ question: z.string(), answer: z.string(), score: z.number() })),
    source: z.string(),
    usedEntries: z.number(),
  }),
  execute: async ({ context }) => {
    const { question, sheetUrl, gid, ttlMinutes } = context;
    const { entries, source } = await loadFaqEntries(sheetUrl, gid ? String(gid) : undefined, ttlMinutes);
    if (!entries.length) {
      return { answer: 'No FAQs found in the sheet.', matches: [], source, usedEntries: 0 };
    }
    const scored = entries.map((e) => ({ ...e, score: relevanceScore(question, e.question + ' ' + e.answer) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const best = top[0];
    if (!best || best.score < 0.05) {
      return {
        answer: 'No close FAQ match found.',
        matches: top.map((m) => ({ question: m.question, answer: m.answer, score: Number(m.score.toFixed(4)) })),
        source,
        usedEntries: entries.length,
      };
    }
    return {
      answer: best.answer,
      matches: top.map((m) => ({ question: m.question, answer: m.answer, score: Number(m.score.toFixed(4)) })),
      source,
      usedEntries: entries.length,
    };
  },
});

