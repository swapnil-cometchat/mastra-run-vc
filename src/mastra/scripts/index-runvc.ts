import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { embedTexts, textHash } from '../tools/embedding-util';

type Page = { url: string; text: string; fetchedAt: string };

function chunkText(text: string, maxChars = 1000): string[] {
  const blocks = text.split(/\n(?=#{1,6} )|\n{2,}/g).map((b) => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      chunks.push(block);
    } else {
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

async function buildIndex() {
  const inFile = join(process.cwd(), 'data', 'runvc_pages.json');
  const outFile = join(process.cwd(), 'data', 'runvc_index.json');
  const raw = await readFile(inFile, 'utf8');
  const { pages } = JSON.parse(raw) as { pages: Page[] };

  const items: { id: string; url: string; text: string }[] = [];
  for (const p of pages) {
    const chunks = chunkText(p.text);
    chunks.forEach((text, i) => {
      const id = `${textHash(p.url)}_${i}`;
      items.push({ id, url: p.url, text });
    });
  }

  const embeddings = await embedTexts(items.map((i) => i.text));

  const index = {
    model: 'text-embedding-3-small',
    createdAt: new Date().toISOString(),
    items: items.map((it, i) => ({ ...it, embedding: embeddings[i] })),
  };

  await writeFile(outFile, JSON.stringify(index, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Saved index with ${items.length} chunks to ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildIndex().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { buildIndex };

