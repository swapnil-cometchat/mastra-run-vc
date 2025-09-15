import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { htmlToText, extractLinks } from './web-scraper-tool';

type QueueItem = { url: string; depth: number };

function sameOrigin(a: string, b: string) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    // drop trailing slash for normalization
    if (url.pathname.endsWith('/') && url.pathname.length > 1) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return u;
  }
}

function chunkText(text: string, maxChars = 1200): string[] {
  // try to split on headings or paragraph-like breaks first
  const blocks = text.split(/\n(?=#{1,6} )|\n{2,}/g).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      chunks.push(block);
    } else {
      // soft-split long blocks on sentence boundaries
      const sentences = block.split(/(?<=[.!?])\s+/);
      let current = '';
      for (const s of sentences) {
        if ((current + ' ' + s).trim().length > maxChars) {
          if (current.trim()) chunks.push(current.trim());
          current = s;
        } else {
          current = (current + ' ' + s).trim();
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }
  return chunks;
}

// Very simple relevance score based on overlapping keywords
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
  for (const term of t) {
    if (q.has(term)) score += 1;
  }
  // weight density a bit
  return score / Math.sqrt(t.length + 1);
}

export const websiteQaTool = createTool({
  id: 'website-qa',
  description:
    'Crawl a website (bounded) and return relevant context snippets for a question',
  inputSchema: z.object({
    url: z.string().url().describe('Root URL (e.g., https://run.vc)'),
    question: z.string().describe('User question to answer using the website'),
    maxPages: z.number().int().min(1).max(50).default(8),
    maxDepth: z.number().int().min(0).max(5).default(2),
    sameOriginOnly: z.boolean().default(true),
  }),
  outputSchema: z.object({
    context: z.string().describe('Concise, relevant snippets to ground an answer'),
    sources: z.array(z.object({ url: z.string(), score: z.number() })),
  }),
  execute: async ({ context }) => {
    const { url, question, maxPages, maxDepth, sameOriginOnly } = context;

    const visited = new Set<string>();
    const queue: QueueItem[] = [];
    // Seed likely portfolio/investments pages first for better recall
    try {
      const base = new URL(url);
      const origin = base.origin;
      const seeds = [
        normalizeUrl(url),
        normalizeUrl(origin + '/portfolio'),
        normalizeUrl(origin + '/investments'),
        normalizeUrl(origin + '/companies'),
        normalizeUrl(origin + '/portfolio/companies'),
      ];
      const uniq = Array.from(new Set(seeds));
      for (const s of uniq) queue.push({ url: s, depth: 0 });
    } catch {
      queue.push({ url: normalizeUrl(url), depth: 0 });
    }
    const results: { url: string; text: string; links?: string[] }[] = [];

    while (queue.length && results.length < maxPages) {
      const { url: u, depth } = queue.shift()!;
      if (visited.has(u)) continue;
      visited.add(u);
      try {
        const res = await fetch(u, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; MastraBot/1.0)' },
        });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const html = await res.text();
        const text = htmlToText(html);
        const links = extractLinks(html, u);
        const r = { url: u, text, links };
        results.push(r);

        if (links && depth < maxDepth) {
          for (const link of links) {
            const n = normalizeUrl(link);
            if (visited.has(n)) continue;
            if (sameOriginOnly && !sameOrigin(url, n)) continue;
            queue.push({ url: n, depth: depth + 1 });
          }
        }
      } catch {
        // ignore fetch/parse errors and continue
      }
    }

    // Build chunks and score them
    type Scored = { url: string; text: string; score: number };
    const scored: Scored[] = [];
    for (const r of results) {
      const chunks = chunkText(r.text);
      for (const c of chunks) {
        let s = relevanceScore(question, c) + (c.startsWith('#') ? 0.1 : 0); // slight boost for headings
        // Boost pages likely to contain companies/portfolio info
        if (/\/portfolio|\/companies|\/investments/i.test(r.url)) s += 0.25;
        if (s > 0) scored.push({ url: r.url, text: c, score: s });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 8);
    const contextBlocks = top.map((t, i) => `(${i + 1}) ${t.text}\nSource: ${t.url}`).join('\n\n');

    return {
      context: contextBlocks || 'No relevant content found.',
      sources: top.map((t) => ({ url: t.url, score: Number(t.score.toFixed(4)) })),
    };
  },
});
