import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { embedTexts, cosineSimilarity } from './embedding-util';

type IndexItem = { id: string; url: string; text: string; embedding: number[] };
type IndexFile = { model: string; createdAt: string; items: IndexItem[] };

let cache: { index?: IndexFile } = {};

async function loadIndex(): Promise<IndexFile> {
  if (cache.index) return cache.index;
  const path = join(process.cwd(), 'data', 'runvc_index.json');
  const raw = await readFile(path, 'utf8');
  const idx = JSON.parse(raw) as IndexFile;
  cache.index = idx;
  return idx;
}

export const prebuiltRunVcQa = createTool({
  id: 'prebuilt-runvc-qa',
  description: 'Retrieve relevant chunks from prebuilt run.vc index to answer questions.',
  inputSchema: z.object({
    question: z.string().describe('User question'),
    k: z.number().int().min(1).max(20).default(8),
  }),
  outputSchema: z.object({
    context: z.string(),
    sources: z.array(z.object({ url: z.string(), score: z.number() })),
    chunks: z.array(z.object({ url: z.string(), text: z.string(), score: z.number() })),
    indexedAt: z.string(),
  }),
  execute: async ({ context }) => {
    const { question, k } = context;
    const idx = await loadIndex();

    const [qEmb] = await embedTexts([question], idx.model as any);

    const scored = idx.items.map((it) => ({
      url: it.url,
      text: it.text,
      score: cosineSimilarity(qEmb, it.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    const contextStr = top
      .map((t, i) => `(${i + 1}) ${t.text}\nSource: ${t.url}`)
      .join('\n\n');

    const sourceMap = new Map<string, number>();
    for (const t of top) sourceMap.set(t.url, Math.max(sourceMap.get(t.url) || 0, t.score));

    return {
      context: contextStr || 'No relevant content found in the prebuilt index.',
      sources: Array.from(sourceMap.entries()).map(([url, score]) => ({ url, score: Number(score.toFixed(4)) })),
      chunks: top.map((t) => ({ url: t.url, text: t.text, score: Number(t.score.toFixed(4)) })),
      indexedAt: idx.createdAt,
    };
  },
});

