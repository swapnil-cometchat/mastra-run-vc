import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ----------------------------
// Types
// ----------------------------
type FaqEntry = {
  id: number;                // stable row id
  question: string;
  answer: string;
  category?: string;
  raw?: Record<string, string>;
};

type FaqIndex = {
  // Minimal BM25 index
  df: Record<string, number>;          // document frequency(t)
  postings: Record<string, Array<[id: number, tfq: number, tfa: number]>>; // per-term postings with field TFs
  docLenQ: Record<number, number>;     // length (question field) by doc
  docLenA: Record<number, number>;     // length (answer field) by doc
  avgLenQ: number;
  avgLenA: number;
  N: number;
  vocabSize: number;
  // aux
  questionsLC: Record<number, string>; // lowercased qs for phrase boost
  answersLC: Record<number, string>;   // lowercased answers for phrase boost
  categories: Record<number, string | undefined>;
  entries: FaqEntry[];                 // keep original (for output)
  synonyms: Record<string, string[]>;  // optional synonym map
  builtAt: string;
  source: string;
};

// ----------------------------
// Config knobs (env or params)
// ----------------------------
const CFG = {
  k1: Number(process.env.FAQ_BM25_K1 ?? 1.2),
  bq: Number(process.env.FAQ_BM25_BQ ?? 0.75),       // BM25 b for question field
  ba: Number(process.env.FAQ_BM25_BA ?? 0.75),       // BM25 b for answer field
  boostQ: Number(process.env.FAQ_BOOST_Q ?? 2.0),    // field boost for question
  boostA: Number(process.env.FAQ_BOOST_A ?? 1.0),    // field boost for answer
  phraseBoost: Number(process.env.FAQ_PHRASE_BOOST ?? 1.5),
  catBoost: Number(process.env.FAQ_CATEGORY_BOOST ?? 1.25),
  typoMaxEdits: Number(process.env.FAQ_TYPO_EDITS ?? 1), // 0,1,2; 1 is cheap+useful
  topK: Number(process.env.FAQ_TOPK ?? 5),
  minScore: Number(process.env.FAQ_MIN_SCORE ?? 0.05),
  // semantic rerank (optional)
  semEnabled: /^(1|true)$/i.test(process.env.FAQ_SEMANTIC ?? '0'),
  semTopK: Number(process.env.FAQ_SEM_TOPK ?? 3),
  semWeight: Number(process.env.FAQ_SEM_WEIGHT ?? 0.35),
};

// ----------------------------
// URL helpers
// ----------------------------
function parseSheetUrl(sheetUrl?: string): { docId: string; gid?: string } {
  const envUrl = process.env.RUNVC_FAQ_SHEET_URL;
  const url = sheetUrl || envUrl;
  if (!url) throw new Error('FAQ sheet URL not provided. Set RUNVC_FAQ_SHEET_URL or pass sheetUrl.');
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

// ----------------------------
// CSV parsing (robust, quoted fields)
// ----------------------------
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* swallow; handle \r\n next loop */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.length > 0);
}

// ----------------------------
// Header mapping
// ----------------------------
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}
function mapColumns(headers: string[]) {
  const norm = headers.map(normalizeHeader);
  const qIdx = norm.findIndex(h => ['question','q','prompt','faq question','title'].includes(h));
  const aIdx = norm.findIndex(h => ['answer','a','response','reply','faq answer','content','text','body'].includes(h));
  const cIdx = norm.findIndex(h => ['category','section','tag','topic'].includes(h));
  return { qIdx, aIdx, cIdx };
}

// ----------------------------
// Text utils (tokenize, fold, stopwords, typos)
// ----------------------------
const STOP = new Set([
  'the','is','are','am','a','an','of','on','in','to','for','and','or','with','by','at','as','be','this','that','it','from','we','you','your','our','us','can','will','do','does','how','what','when','where','why'
]);

function fold(s: string): string {
  // lower, strip diacritics, collapse whitespace, strip punctuation (keep alnum + space)
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  const t = fold(s).split(' ').filter(w => w && w.length > 1 && !STOP.has(w));
  return t;
}

// Damerau-Levenshtein distance (bounded)
function editDistance1or2(a: string, b: string, maxEdits = 1): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxEdits) return maxEdits + 1;
  // Cheap O(n*m) with early exit since maxEdits small
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,        // del
        dp[i][j-1] + 1,        // ins
        dp[i-1][j-1] + cost,   // sub
      );
      if (i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2] + cost); // transposition
      }
    }
    // early stop if the entire row > maxEdits
    if (Math.min(...dp[i]) > maxEdits) return maxEdits + 1;
  }
  return dp[n][m];
}

// ----------------------------
// Build entries
// ----------------------------
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
    entries.push({ id: i, question, answer, category, raw });
  }
  return entries;
}

// ----------------------------
// Index builder (BM25 across Q & A fields)
// ----------------------------
function buildIndex(entries: FaqEntry[], source: string, synonyms: Record<string,string[]> = {}): FaqIndex {
  const df: FaqIndex['df'] = {};
  const postings: FaqIndex['postings'] = {};
  const docLenQ: FaqIndex['docLenQ'] = {};
  const docLenA: FaqIndex['docLenA'] = {};
  const questionsLC: Record<number,string> = {};
  const answersLC: Record<number,string> = {};
  const categories: Record<number,string|undefined> = {};

  const N = entries.length;
  let sumQ = 0, sumA = 0;

  const ensurePostings = (term: string) => (postings[term] ??= []);

  for (const e of entries) {
    const tq = tokens(e.question);
    const ta = tokens(e.answer);

    // synonym expansion into fields (lightweight)
    const expand = (arr: string[]) => {
      const out: string[] = [...arr];
      for (const tok of arr) {
        const syns = synonyms[tok];
        if (syns) out.push(...syns);
      }
      return out;
    };

    const tq2 = expand(tq);
    const ta2 = expand(ta);

    const tfq: Record<string, number> = {};
    const tfa: Record<string, number> = {};
    for (const t of tq2) tfq[t] = (tfq[t] ?? 0) + 1;
    for (const t of ta2) tfa[t] = (tfa[t] ?? 0) + 1;

    const seen = new Set<string>();
    for (const term of new Set([...Object.keys(tfq), ...Object.keys(tfa)])) {
      ensurePostings(term).push([e.id, tfq[term] ?? 0, tfa[term] ?? 0]);
      if (!seen.has(term)) { df[term] = (df[term] ?? 0) + 1; seen.add(term); }
    }

    docLenQ[e.id] = tq.length;
    docLenA[e.id] = ta.length;
    sumQ += tq.length; sumA += ta.length;

    questionsLC[e.id] = fold(e.question);
    answersLC[e.id]   = fold(e.answer);
    categories[e.id]  = e.category ? fold(e.category) : undefined;
  }

  return {
    df,
    postings,
    docLenQ,
    docLenA,
    avgLenQ: N ? sumQ / N : 0.0001,
    avgLenA: N ? sumA / N : 0.0001,
    N,
    vocabSize: Object.keys(df).length,
    questionsLC,
    answersLC,
    categories,
    entries,
    synonyms,
    builtAt: new Date().toISOString(),
    source,
  };
}

// ----------------------------
// Scoring (BM25 + boosts + typos + phrase + category hint)
// ----------------------------
function bm25Score(qt: string[], idx: FaqIndex, id: number): number {
  const { df, postings, N, k1, bq, ba, boostQ, boostA } = { 
    df: idx.df, postings: idx.postings, N: idx.N,
    k1: CFG.k1, bq: CFG.bq, ba: CFG.ba, boostQ: CFG.boostQ, boostA: CFG.boostA
  };
  let score = 0;

  for (const term of qt) {
    // direct term or typo-tolerant near matches
    const candTerms = [term];
    if (CFG.typoMaxEdits > 0) {
      // probe close neighbors (cheap heuristic: check existing vocab keys that share prefix)
      // To keep O(k) we only check exact; typo weight handled by term itself below (optional)
    }

    for (const t of candTerms) {
      const df_t = df[t];
      if (!df_t) continue;
      const idf = Math.log(1 + (N - df_t + 0.5) / (df_t + 0.5));

      const plist = postings[t];
      // binary search would be faster if sorted; list is small enough for linear scan
      const hit = plist.find(p => p[0] === id);
      if (!hit) continue;

      const [ , tfq, tfa ] = hit;
      // Fieldwise BM25
      const denomQ = tfq + k1 * (1 - bq + bq * (idx.docLenQ[id] / idx.avgLenQ));
      const denomA = tfa + k1 * (1 - ba + ba * (idx.docLenA[id] / idx.avgLenA));
      const partQ = tfq ? (idf * ((tfq * (k1 + 1)) / (denomQ))) * boostQ : 0;
      const partA = tfa ? (idf * ((tfa * (k1 + 1)) / (denomA))) * boostA : 0;
      score += partQ + partA;
    }
  }

  return score;
}

function phraseAndCategoryBoost(queryFold: string, idx: FaqIndex, id: number): number {
  let mult = 1;

  // phrase boost: if contiguous phrase of 2+ tokens appears in Q or A
  const bigram = queryFold.split(' ').filter(Boolean).slice(0, 6).join(' ');
  if (bigram.length > 3) {
    if (idx.questionsLC[id].includes(bigram) || idx.answersLC[id].includes(bigram)) {
      mult *= CFG.phraseBoost;
    }
  }

  // category hint: if user includes [category: foo] or “in <cat>”
  // lightweight heuristic—look for "in <word>" or "[cat: word]"
  const m1 = queryFold.match(/\[cat(?:egory)?:\s*([a-z0-9 ]+)\]/);
  const m2 = queryFold.match(/\bin\s+([a-z0-9 ]{3,})$/);
  const wanted = fold((m1?.[1] ?? m2?.[1] ?? '').trim());
  if (wanted && idx.categories[id] && idx.categories[id]!.includes(wanted)) {
    mult *= CFG.catBoost;
  }

  return mult;
}

// optional semantic rerank (requires an embedding fn)
async function semanticRerankIfEnabled(query: string, candidates: Array<{id:number, score:number}>, idx: FaqIndex) {
  if (!CFG.semEnabled || candidates.length === 0) return candidates;

  // Lazy import to keep tool self-contained if embeddings disabled
  const embed = async (text: string): Promise<number[]> => {
    // Plug in your favorite embeddings provider here; return a vector.
    // For a no-op fallback, return empty array
    return [];
  };

  const qv = await embed(query);
  if (!qv.length) return candidates; // embeddings off

  const sim = (a:number[], b:number[]) => {
    let dot = 0, na = 0, nb = 0;
    for (let i=0;i<a.length;i++){ dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
    return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
    };

  const withSem = await Promise.all(
    candidates.slice(0, CFG.semTopK).map(async c => {
      const text = `${idx.entries.find(e => e.id===c.id)?.question}\n${idx.entries.find(e => e.id===c.id)?.answer}`;
      const dv = await embed(text);
      const s = dv.length ? sim(qv, dv) : 0;
      return { ...c, score: c.score * (1 - CFG.semWeight) + s * CFG.semWeight };
    })
  );

  // replace topK head, keep tail
  const tail = candidates.slice(CFG.semTopK);
  const merged = [...withSem, ...tail].sort((a,b) => b.score - a.score);
  return merged;
}

// ----------------------------
// Cache + Conditional fetch
// ----------------------------
const buildCachePaths = (docId: string, gid?: string) => {
  const cacheDir = join(process.cwd(), 'data');
  const key = `faq_${docId}_${gid || 'default'}`;
  return {
    dir: cacheDir,
    csv: join(cacheDir, `${key}.csv`),
    meta: join(cacheDir, `${key}.meta.json`),
    index: join(cacheDir, `${key}.index.json`),
  };
};

async function fetchCsvWithCache(url: string, ttlMinutes: number, paths: ReturnType<typeof buildCachePaths>) {
  const now = Date.now();
  const ttlMs = ttlMinutes * 60 * 1000;

  let etag: string | undefined;
  let lastModified: string | undefined;

  if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true });

  // read meta if present
  if (existsSync(paths.meta)) {
    try {
      const m = JSON.parse(await readFile(paths.meta, 'utf8')) as { etag?: string; lastModified?: string; savedAt?: number };
      etag = m.etag; lastModified = m.lastModified;
      // Fresh enough? Short-circuit
      if (existsSync(paths.csv)) {
        const st = await stat(paths.csv);
        if (now - st.mtime.getTime() < ttlMs) {
          const csv = await readFile(paths.csv, 'utf8');
          return { csv, from: 'cache', etag, lastModified };
        }
      }
    } catch {}
  }

  // Conditional fetch
  const headers: Record<string,string> = {};
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const res = await fetch(url, { headers });
  if (res.status === 304 && existsSync(paths.csv)) {
    const csv = await readFile(paths.csv, 'utf8');
    return { csv, from: 'cache-validated', etag, lastModified };
  }
  if (!res.ok) {
    // fallback to stale cache if available
    if (existsSync(paths.csv)) {
      const csv = await readFile(paths.csv, 'utf8');
      return { csv, from: `stale(${res.status})`, etag, lastModified };
    }
    throw new Error(`Failed to fetch sheet CSV. Ensure link sharing enabled. HTTP ${res.status}`);
  }

  const csv = await res.text();
  const newEtag = res.headers.get('etag') || undefined;
  const newLastMod = res.headers.get('last-modified') || undefined;

  await writeFile(paths.csv, csv, 'utf8');
  await writeFile(paths.meta, JSON.stringify({ etag: newEtag, lastModified: newLastMod, savedAt: now }, null, 2), 'utf8');

  return { csv, from: 'network', etag: newEtag, lastModified: newLastMod };
}

// ----------------------------
// Load + (re)build index if needed
// ----------------------------
async function loadFaqIndex(sheetUrl?: string, gid?: string, ttlMinutes = 10): Promise<FaqIndex> {
  const { docId, gid: parsedGid } = parseSheetUrl(sheetUrl);
  const g = gid || parsedGid;
  const url = exportCsvUrl(docId, g);
  const paths = buildCachePaths(docId, g);

  // try to read existing index and respect TTL via meta/csv timestamp
  const envSynPath = process.env.FAQ_SYNONYMS_JSON || '';
  let synonyms: Record<string,string[]> = {};
  if (envSynPath && existsSync(envSynPath)) {
    try { synonyms = JSON.parse(await readFile(envSynPath, 'utf8')); } catch {}
  }

  try {
    // Ensure CSV is fresh
    const { csv } = await fetchCsvWithCache(url, ttlMinutes, paths);
    const rows = parseCsv(csv);
    const entries = buildEntries(rows);

    // if no entries, still write index for traceability
    const indexFresh = buildIndex(entries, url, synonyms);
    await writeFile(paths.index, JSON.stringify(indexFresh), 'utf8');
    return indexFresh;
  } catch (e) {
    // hard fallback: if we have an old index file, use it
    if (existsSync(paths.index)) {
      const idx = JSON.parse(await readFile(paths.index, 'utf8')) as FaqIndex;
      return idx;
    }
    throw e;
  }
}

// ----------------------------
// Query execution
// ----------------------------
function scoreCandidates(query: string, idx: FaqIndex) {
  const qFold = fold(query);
  const qt = tokens(query);

  // gather candidate doc ids by union of term postings (prunes work)
  const cset = new Set<number>();
  for (const term of qt) {
    const plist = idx.postings[term];
    if (plist) for (const [id] of plist) cset.add(id);

    // very cheap typo tolerant pass: try trimming 1 char if term is long and no hits
    if ((!plist || plist.length === 0) && CFG.typoMaxEdits > 0 && term.length >= 5) {
      for (const near in idx.df) {
        // fast prefix gate
        if (near[0] !== term[0]) continue;
        const d = editDistance1or2(term, near, 1);
        if (d <= 1) {
          const plist2 = idx.postings[near];
          if (plist2) for (const [id] of plist2) cset.add(id);
        }
      }
    }
  }

  // if query had no recognizable tokens, fall back to all docs (rare)
  if (cset.size === 0) idx.entries.forEach(e => cset.add(e.id));

  // score
  const prelim = Array.from(cset).map(id => {
    let s = bm25Score(qt, idx, id);
    s *= phraseAndCategoryBoost(qFold, idx, id);
    return { id, score: s };
  }).filter(r => r.score > 0);

  prelim.sort((a,b)=> b.score - a.score);
  return prelim.slice(0, Math.max(CFG.topK, 1));
}

// ----------------------------
// Public Tool
// ----------------------------
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
    const envTtl = process.env.RUNVC_FAQ_TTL_MINUTES ? Number(process.env.RUNVC_FAQ_TTL_MINUTES) : undefined;
    const effectiveTtl = Number.isFinite(envTtl) ? (envTtl as number) : ttlMinutes;

    const idx = await loadFaqIndex(sheetUrl, gid ? String(gid) : undefined, effectiveTtl);
    if (!idx.entries.length) {
      return { answer: 'No FAQs found in the sheet.', matches: [], source: idx.source, usedEntries: 0 };
    }

    let ranked = scoreCandidates(question, idx);
    ranked = await semanticRerankIfEnabled(question, ranked, idx);

    const top = ranked.slice(0, CFG.topK);
    if (!top.length || top[0].score < CFG.minScore) {
      return {
        answer: 'No close FAQ match found.',
        matches: top.map(r => {
          const e = idx.entries.find(x => x.id === r.id)!;
          return { question: e.question, answer: e.answer, score: Number(r.score.toFixed(4)) };
        }),
        source: idx.source,
        usedEntries: idx.entries.length,
      };
    }

    const best = top[0];
    const bestEntry = idx.entries.find(e => e.id === best.id)!;
    return {
      answer: bestEntry.answer,
      matches: top.map(r => {
        const e = idx.entries.find(x => x.id === r.id)!;
        return { question: e.question, answer: e.answer, score: Number(r.score.toFixed(4)) };
      }),
      source: idx.source,
      usedEntries: idx.entries.length,
    };
  },
});