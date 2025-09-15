import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Very lightweight HTML -> text extraction without external deps.
// - Removes script/style
// - Preserves basic heading markers for better chunking
export function htmlToText(html: string): string {
  // strip script/style
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  // surface helpful attributes before tag stripping
  // 1) <img alt="...">
  cleaned = cleaned.replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' $1 ');
  // 2) Any aria-label
  cleaned = cleaned.replace(/<([a-z0-9:-]+)\b[^>]*\baria-label=["']([^"']+)["'][^>]*>/gi, ' $2 ');
  // 3) Anchors with title when no inner text
  cleaned = cleaned.replace(/<a\b[^>]*\btitle=["']([^"']+)["'][^>]*>\s*<\/a>/gi, ' $1 ');
  // 4) Common data-* name hints
  cleaned = cleaned.replace(/<([a-z0-9:-]+)[^>]*\bdata-(name|title)=["']([^"']+)["'][^>]*>/gi, ' $3 ');
  // 5) Basic OpenGraph meta
  cleaned = cleaned.replace(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/gi, '\n# $1\n');
  cleaned = cleaned.replace(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/gi, '\n$1\n');

  // mark headings to aid splitting
  cleaned = cleaned
    .replace(/<(h1)[^>]*>([\s\S]*?)<\/\1>/gi, '\n# $2\n')
    .replace(/<(h2)[^>]*>([\s\S]*?)<\/\1>/gi, '\n## $2\n')
    .replace(/<(h3)[^>]*>([\s\S]*?)<\/\1>/gi, '\n### $2\n')
    .replace(/<(h4)[^>]*>([\s\S]*?)<\/\1>/gi, '\n#### $2\n')
    .replace(/<(h5)[^>]*>([\s\S]*?)<\/\1>/gi, '\n##### $2\n')
    .replace(/<(h6)[^>]*>([\s\S]*?)<\/\1>/gi, '\n###### $2\n');

  // Convert breaks and paragraphs to line breaks
  cleaned = cleaned
    .replace(/<\/(p|div|section|article|header|footer)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n');

  // remove all remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // decode basic HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\n\s*/g, '\n').trim();

  return cleaned;
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const hrefs = new Set<string>();
  const re = /<a\b[^>]*href=["']?([^"'\s>#]+)["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1];
      const u = new URL(raw, baseUrl);
      hrefs.add(u.toString());
    } catch {
      // ignore invalid URLs
    }
  }
  return Array.from(hrefs);
}

export const webScraperTool = createTool({
  id: 'scrape-webpage',
  description: 'Fetch a URL and extract readable text and links',
  inputSchema: z.object({
    url: z.string().url().describe('URL to scrape'),
    includeLinks: z.boolean().default(true).describe('Whether to return discovered links'),
  }),
  outputSchema: z.object({
    url: z.string(),
    text: z.string(),
    links: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { url, includeLinks } = context;
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; MastraBot/1.0)' },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const text = htmlToText(html);
    const links = includeLinks ? extractLinks(html, url) : undefined;
    return { url, text, links };
  },
});

export type ScrapeResult = {
  url: string;
  text: string;
  links?: string[];
};
