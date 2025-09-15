import { createHash } from 'node:crypto';

export type EmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large';

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export function textHash(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export async function embedTexts(
  texts: string[],
  model: EmbeddingModel = 'text-embedding-3-small',
  apiKey = process.env.OPENAI_API_KEY as string,
): Promise<number[][]> {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for embeddings');
  const body = { model, input: texts } as const;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embeddings failed: ${res.status} ${res.statusText} - ${t}`);
  }
  const json = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return json.data.map((d) => d.embedding);
}

