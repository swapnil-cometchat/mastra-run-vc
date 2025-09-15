import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToText, extractLinks } from '../tools/web-scraper-tool';

type Page = {
  url: string;
  text: string;
  fetchedAt: string;
};

type QueueItem = { url: string; depth: number };

function normalizeUrl(u: string): string {
  const url = new URL(u);
  url.hash = '';
  if (url.pathname.endsWith('/') && url.pathname.length > 1) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function sameOrigin(a: string, b: string) {
  const ua = new URL(a);
  const ub = new URL(b);
  return ua.origin === ub.origin;
}

async function fetchHtml(u: string): Promise<string> {
  const res = await fetch(u, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MastraCrawler/1.0)' },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return await res.text();
}

async function crawlRunVc() {
  const root = 'https://run.vc';
  const outDir = join(process.cwd(), 'data');
  const outFile = join(outDir, 'runvc_pages.json');
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const visited = new Set<string>();
  const queue: QueueItem[] = [];
  const base = new URL(root);
  const origin = base.origin;
  const seeds = [
    normalizeUrl(root),
    normalizeUrl(origin + '/portfolio'),
    normalizeUrl(origin + '/investments'),
    normalizeUrl(origin + '/companies'),
    normalizeUrl(origin + '/team'),
    normalizeUrl(origin + '/about'),
  ];
  for (const s of Array.from(new Set(seeds))) queue.push({ url: s, depth: 0 });

  const maxDepth = 2;
  const maxPages = 50;
  const pages: Page[] = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const html = await fetchHtml(url);
      let text = htmlToText(html);

      // No special portfolio handling; store raw page text only

      pages.push({ url, text, fetchedAt: new Date().toISOString() });
      if (depth < maxDepth) {
        const links = extractLinks(html, url);
        for (const l of links) {
          if (!sameOrigin(root, l)) continue;
          const n = normalizeUrl(l);
          if (!visited.has(n)) queue.push({ url: n, depth: depth + 1 });
        }
      }
      // eslint-disable-next-line no-console
      console.log(`Fetched: ${url}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Failed: ${url}`, e);
    }
  }

  await writeFile(outFile, JSON.stringify({ pages }, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Saved ${pages.length} pages to ${outFile}`);
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  crawlRunVc().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Enrich portfolio entries by fetching meta descriptions from their websites
async function enrichPortfolioDescriptions(
  items: { name: string; website: string; logo: string; description?: string }[],
) {
  for (const item of items) {
    try {
      const html = await fetchHtml(item.website);
      const desc = extractDescriptionFromHtml(html);
      if (desc) item.description = desc;
      // eslint-disable-next-line no-console
      console.log(`Description ✓ ${item.website}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Description ✗ ${item.website}`, e);
    }
  }
}

function extractDescriptionFromHtml(html: string): string | undefined {
  // Common meta tags
  const metas = [
    /<meta\s+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+name=["']twitter:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of metas) {
    const m = re.exec(html);
    if (m && m[1]) return trimDesc(m[1]);
  }
  // Fallback: take first non-empty paragraph-ish chunk from text
  const text = htmlToText(html);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (l.length > 60) return trimDesc(l);
  }
  return undefined;
}

function trimDesc(s: string, max = 300): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export { crawlRunVc };
