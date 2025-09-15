import { writeFile, mkdir, readFile } from 'node:fs/promises';
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
  const portfolioJson = join(outDir, 'runvc_portfolio.json');
  const portfolioCsv = join(outDir, 'runvc_portfolio.csv');
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
  const portfolio: { name: string; website: string; logo: string; description?: string }[] = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const html = await fetchHtml(url);
      let text = htmlToText(html);

      // If this is the Portfolio page, extract company data and append as structured text
      if (/\/portfolio\/?$/i.test(new URL(url).pathname)) {
        const companies = extractPortfolioCompaniesDetailed(html, url);
        if (companies.length) {
          // Append as readable text for indexing
          const listing = companies
            .map((c) => `- ${c.name} (${new URL(c.website).hostname.replace(/^www\./,'')})`)
            .join('\n');
          text += `\n\nPortfolio Companies (extracted):\n${listing}\n`;

          // Merge into global portfolio list (dedupe by website)
          const seen = new Set(portfolio.map((p) => p.website));
          for (const c of companies) {
            if (!seen.has(c.website)) {
              portfolio.push(c);
              seen.add(c.website);
            }
          }
        }
      }

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

  // Enrich portfolio entries with descriptions by visiting their sites
  if (portfolio.length) {
    await enrichPortfolioDescriptions(portfolio);
  }

  await writeFile(outFile, JSON.stringify({ pages }, null, 2), 'utf8');
  if (portfolio.length) {
    await writeFile(portfolioJson, JSON.stringify({ companies: portfolio }, null, 2), 'utf8');
    // Also write CSV
    const header = 'name,website,logo,description\n';
    const rows = portfolio
      .map((c) => {
        const esc = (s: string) => {
          const v = s ?? '';
          return /[\",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        };
        return `${esc(c.name)},${esc(c.website)},${esc(c.logo)},${esc(c.description || '')}`;
      })
      .join('\n');
    await writeFile(portfolioCsv, header + rows + (rows ? '\n' : ''), 'utf8');
  }
  // eslint-disable-next-line no-console
  console.log(`Saved ${pages.length} pages to ${outFile}`);
  if (portfolio.length) {
    console.log(`Saved ${portfolio.length} portfolio companies to ${portfolioJson} and ${portfolioCsv}`);
  }
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

// Heuristic extraction tailored to run.vc/portfolio markup
function extractPortfolioCompanies(html: string, baseUrl: string): { name: string; domain?: string }[] {
  const companies: { name: string; domain?: string }[] = [];
  const seen = new Set<string>();

  // 1) Collect external anchors in the portfolio grid
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*card-featured-wrapper[^"']*["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const domains: string[] = [];
  while ((m = anchorRe.exec(html)) !== null) {
    try {
      const raw = m[1];
      const u = new URL(raw, baseUrl);
      if (u.hostname.endsWith('run.vc')) continue;
      if (u.hostname.includes('website-files.com')) continue;
      const host = u.hostname.replace(/^www\./, '');
      if (!domains.includes(host)) domains.push(host);
    } catch {
      // ignore
    }
  }

  // 2) Collect brand hints from investment images
  const imgRe = /<img\b[^>]*class=["'][^"']*investment-img[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/gi;
  const namesFromImg: string[] = [];
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    const file = src.split('/').pop() || '';
    const base = file.split('?')[0];
    const stem = base.replace(/\.(png|jpg|jpeg|webp|svg)$/i, '');
    // Try to peel hashed prefixes e.g., 681516c28f7c_foo -> foo
    const parts = stem.split('_');
    const candidate = parts.length > 1 ? parts[parts.length - 1] : stem;
    let name = candidate
      .replace(/\b(logo|logos|official|master|full|id[a-z0-9-]+)\b/gi, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Title case
    if (name && /[a-z]/i.test(name)) {
      name = name
        .split(' ')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
      if (name.length > 1 && !namesFromImg.includes(name)) namesFromImg.push(name);
    }
  }

  // Merge into unified list, pairing domain->name when possible
  for (const host of domains) {
    const base = host.replace(/\.[a-z]{2,}$/i, ''); // remove TLD
    const core = base.replace(/^www\./, '');
    const parts = core.split('.');
    const last = parts[parts.length - 1];
    const derived = last
      .replace(/[-_]+/g, ' ')
      .replace(/\d+/g, (m) => m) // keep numerics like 401go
      .replace(/\b(app|ai|io|co|inc)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const name = derived
      ? derived
          .split(' ')
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
          .join(' ')
      : host;
    const key = `${name}|${host}`;
    if (!seen.has(key)) {
      companies.push({ name, domain: host });
      seen.add(key);
    }
  }

  // Add any names from images not already present
  for (const n of namesFromImg) {
    const exists = companies.some((c) => c.name.toLowerCase() === n.toLowerCase());
    if (!exists) companies.push({ name: n });
  }

  return companies;
}

// Detailed extraction: name, website, logo
function extractPortfolioCompaniesDetailed(
  html: string,
  baseUrl: string,
): { name: string; website: string; logo: string }[] {
  const out: { name: string; website: string; logo: string }[] = [];
  const seen = new Set<string>();

  const cardRe = /<a\b([^>]*?)class=["'][^"']*card-featured-wrapper[^"']*["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const aAttrs = `${m[1]} ${m[2]}`;
    const inner = m[3];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(aAttrs);
    if (!hrefMatch) continue;
    let website: string;
    try {
      website = new URL(hrefMatch[1], baseUrl).toString();
    } catch {
      continue;
    }
    const imgMatch = /<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/i.exec(inner) ||
      /<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/i.exec(inner);
    let logo: string | undefined;
    let alt: string | undefined;
    if (imgMatch) {
      if (imgMatch.length >= 3) {
        // Determine which group is src vs alt based on regex used
        if (imgMatch[0].indexOf('src=') < imgMatch[0].indexOf('alt=')) {
          logo = imgMatch[1];
          alt = imgMatch[2];
        } else {
          alt = imgMatch[1];
          logo = imgMatch[2];
        }
      }
    }
    if (!logo) {
      // fallback: any img src inside
      const anyImg = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i.exec(inner);
      if (anyImg) logo = anyImg[1];
    }
    if (!logo) continue;
    try {
      logo = new URL(logo, baseUrl).toString();
    } catch {}

    // Derive name: prefer alt text; else from domain; else from image filename
    let name = (alt || '').trim();
    if (!name || name.length < 2) {
      try {
        const h = new URL(website).hostname.replace(/^www\./, '');
        name = humanizeBrandFromHost(h);
      } catch {}
    }
    if (!name || name.length < 2) {
      const file = logo.split('/').pop() || '';
      const stem = file.split('?')[0].replace(/\.(png|jpg|jpeg|webp|svg)$/i, '');
      name = humanizeFileStem(stem);
    }
    if (!name) continue;

    const key = website; // dedupe per destination
    if (!seen.has(key)) {
      out.push({ name, website, logo });
      seen.add(key);
    }
  }
  return out;
}

function humanizeBrandFromHost(host: string): string {
  // remove common TLD level
  const parts = host.split('.');
  const core = parts.length > 2 ? parts.slice(-2, -1)[0] : parts[0];
  // special: keep numbers (401go), remove common suffix tokens
  const cleaned = core
    .replace(/[-_]+/g, ' ')
    .replace(/\b(inc|app)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return toTitleCase(cleaned || core);
}

function humanizeFileStem(stem: string): string {
  const cleaned = stem
    .replace(/\b(logo|logos|official|master|full|id[a-z0-9-]+)\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return toTitleCase(cleaned || stem);
}

function toTitleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();
}
