import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Company = { name: string; website?: string; logo?: string; description?: string };

export const portfolioStaticTool = createTool({
  id: 'portfolio-static',
  description: 'Return static portfolio companies from data/runvc_portfolio.json',
  inputSchema: z.object({
    query: z.string().optional().describe('Optional filter; matches name or website'),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  outputSchema: z.object({
    companies: z.array(
      z.object({
        name: z.string(),
        website: z.string().optional(),
        logo: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
    count: z.number(),
    source: z.string(),
  }),
  execute: async ({ context }) => {
    const { query, limit } = context;
    const override = process.env.RUNVC_PORTFOLIO_PATH;
    const candidates = Array.from(
      new Set(
        [
          override ? resolve(override) : undefined,
          // When running under mastra dev, cwd is typically .mastra/output
          join(process.cwd(), 'data', 'runvc_portfolio.json'), // .mastra/output/data/runvc_portfolio.json
          resolve(process.cwd(), '..', '..', 'data', 'runvc_portfolio.json'), // repoRoot/data/runvc_portfolio.json
          // Fallback attempt (in case cwd is repo root already)
          resolve(process.cwd(), 'data', 'runvc_portfolio.json'),
        ].filter(Boolean) as string[],
      ),
    );

    const path = candidates.find((p) => existsSync(p));
    if (!path) {
      throw new Error(
        `Static portfolio file not found. Tried: ${candidates.join(', ')}. ` +
          `Set RUNVC_PORTFOLIO_PATH to an absolute path, or place runvc_portfolio.json under repoRoot/data or .mastra/output/data.`,
      );
    }

    const raw = await readFile(path!, 'utf8');
    const json = JSON.parse(raw) as { companies: Company[] };
    let list = json.companies || [];
    if (query && query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.website && c.website.toLowerCase().includes(q)),
      );
    }
    list = list.slice(0, limit);
    return { companies: list, count: list.length, source: path };
  },
});
