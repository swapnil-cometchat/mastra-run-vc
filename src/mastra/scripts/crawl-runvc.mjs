import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// Minimal HTML helpers
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

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const html = await fetchHtml(url);
      let text = htmlToText(html);

      // no special portfolio handling; store raw text only

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

  await writeFile(outFile, JSON.stringify({ pages }, null, 2), 'utf8');
  console.log(`Saved ${pages.length} pages to ${outFile}`);
}


if (import.meta.url === `file://${process.argv[1]}`) {
  crawlRunVc().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { crawlRunVc };
