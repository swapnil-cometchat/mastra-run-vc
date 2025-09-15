import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// Minimal HTML helpers (duplicated to avoid TS import at runtime)
function htmlToText(html) {
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned
    .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' $1 ')
    .replace(/<([a-z0-9:-]+)\b[^>]*\baria-label=["']([^"']+)["'][^>]*>/gi, ' $2 ')
    .replace(/<a\b[^>]*\btitle=["']([^"']+)["'][^>]*>\s*<\/a>/gi, ' $1 ')
    .replace(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/gi, '\n# $1\n')
    .replace(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/gi, '\n$1\n');
  cleaned = cleaned
    .replace(/<(h1)[^>]*>([\s\S]*?)<\/\1>/gi, '\n# $2\n')
    .replace(/<(h2)[^>]*>([\s\S]*?)<\/\1>/gi, '\n## $2\n')
    .replace(/<(h3)[^>]*>([\s\S]*?)<\/\1>/gi, '\n### $2\n')
    .replace(/<(h4)[^>]*>([\s\S]*?)<\/\1>/gi, '\n#### $2\n')
    .replace(/<(h5)[^>]*>([\s\S]*?)<\/\1>/gi, '\n##### $2\n')
    .replace(/<(h6)[^>]*>([\s\S]*?)<\/\1>/gi, '\n###### $2\n');
  cleaned = cleaned
    .replace(/<\/(p|div|section|article|header|footer)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n');
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\n\s*/g, '\n').trim();
  return cleaned;
}

function extractLinks(html, baseUrl) {
  const hrefs = new Set();
  const re = /<a\b[^>]*href=["']?([^"'\s>#]+)["']?[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1];
      const u = new URL(raw, baseUrl);
      hrefs.add(u.toString());
    } catch {}
  }
  return Array.from(hrefs);
}

function normalizeUrl(u) {
  const url = new URL(u);
  url.hash = '';
  if (url.pathname.endsWith('/') && url.pathname.length > 1) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function sameOrigin(a, b) {
  const ua = new URL(a);
  const ub = new URL(b);
  return ua.origin === ub.origin;
}

async function fetchHtml(u) {
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

  const visited = new Set();
  const queue = [];
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
  const pages = [];
  const portfolio = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const html = await fetchHtml(url);
      let text = htmlToText(html);

      if (/\/portfolio\/?$/i.test(new URL(url).pathname)) {
        const companies = extractPortfolioCompaniesDetailed(html, url);
        if (companies.length) {
          const listing = companies
            .map((c) => `- ${c.name} (${new URL(c.website).hostname.replace(/^www\./, '')})`)
            .join('\n');
          text += `\n\nPortfolio Companies (extracted):\n${listing}\n`;

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
      console.log(`Fetched: ${url}`);
    } catch (e) {
      console.warn(`Failed: ${url}`, e);
    }
  }

  if (portfolio.length) {
    await enrichPortfolioDescriptions(portfolio);
  }

  await writeFile(outFile, JSON.stringify({ pages }, null, 2), 'utf8');
  if (portfolio.length) {
    await writeFile(portfolioJson, JSON.stringify({ companies: portfolio }, null, 2), 'utf8');
    const header = 'name,website,logo,description\n';
    const rows = portfolio
      .map((c) => {
        const esc = (s) => {
          const v = s ?? '';
          return /[\",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        };
        return `${esc(c.name)},${esc(c.website)},${esc(c.logo)},${esc(c.description || '')}`;
      })
      .join('\n');
    await writeFile(portfolioCsv, header + rows + (rows ? '\n' : ''), 'utf8');
  }
  console.log(`Saved ${pages.length} pages to ${outFile}`);
  if (portfolio.length) {
    console.log(`Saved ${portfolio.length} portfolio companies to ${portfolioJson} and ${portfolioCsv}`);
  }
}

async function enrichPortfolioDescriptions(items) {
  for (const item of items) {
    try {
      const html = await fetchHtml(item.website);
      const desc = extractDescriptionFromHtml(html);
      if (desc) item.description = desc;
      console.log(`Description ✓ ${item.website}`);
    } catch (e) {
      console.warn(`Description ✗ ${item.website}`, e);
    }
  }
}

function extractDescriptionFromHtml(html) {
  const metas = [
    /<meta\s+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+name=["']twitter:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of metas) {
    const m = re.exec(html);
    if (m && m[1]) return trimDesc(m[1]);
  }
  const text = htmlToText(html);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (l.length > 60) return trimDesc(l);
  }
  return undefined;
}

function trimDesc(s, max = 300) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function extractPortfolioCompaniesDetailed(html, baseUrl) {
  const out = [];
  const seen = new Set();

  const cardRe = /<a\b([^>]*?)class=["'][^"']*card-featured-wrapper[^"']*["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const aAttrs = `${m[1]} ${m[2]}`;
    const inner = m[3];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(aAttrs);
    if (!hrefMatch) continue;
    let website;
    try {
      website = new URL(hrefMatch[1], baseUrl).toString();
    } catch {
      continue;
    }
    const imgMatch = /<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/i.exec(inner) ||
      /<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/i.exec(inner);
    let logo;
    let alt;
    if (imgMatch) {
      if (imgMatch.length >= 3) {
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
      const anyImg = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i.exec(inner);
      if (anyImg) logo = anyImg[1];
    }
    if (!logo) continue;
    try { logo = new URL(logo, baseUrl).toString(); } catch {}

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

    const key = website;
    if (!seen.has(key)) {
      out.push({ name, website, logo });
      seen.add(key);
    }
  }
  return out;
}

function humanizeBrandFromHost(host) {
  const parts = host.split('.');
  const core = parts.length > 2 ? parts.slice(-2, -1)[0] : parts[0];
  const cleaned = core
    .replace(/[-_]+/g, ' ')
    .replace(/\b(inc|app)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return toTitleCase(cleaned || core);
}

function humanizeFileStem(stem) {
  const cleaned = stem
    .replace(/\b(logo|logos|official|master|full|id[a-z0-9-]+)\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return toTitleCase(cleaned || stem);
}

function toTitleCase(s) {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  crawlRunVc().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { crawlRunVc };
