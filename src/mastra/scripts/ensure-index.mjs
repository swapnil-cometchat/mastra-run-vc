import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { crawlRunVc } from './crawl-runvc.mjs';
import { buildIndex } from './index-runvc.mjs';

function hours(ms) { return ms / (1000 * 60 * 60); }

async function ensureIndex() {
  const ttlHours = Number(process.env.RUNVC_INDEX_TTL_HOURS || '24');
  const idxPath = join(process.cwd(), 'data', 'runvc_index.json');
  const pagesPath = join(process.cwd(), 'data', 'runvc_pages.json');
  let needsBuild = false;

  if (!existsSync(idxPath) || !existsSync(pagesPath)) {
    needsBuild = true;
  } else {
    try {
      const st = await stat(idxPath);
      const ageHrs = hours(Date.now() - st.mtime.getTime());
      if (ageHrs >= ttlHours) needsBuild = true;
    } catch {
      needsBuild = true;
    }
  }

  if (!needsBuild) {
    console.log(`[ensure-index] Using existing index at ${idxPath}`);
    return;
  }

  console.log(`[ensure-index] Building index (TTL ${ttlHours}h)…`);
  await crawlRunVc();
  await buildIndex();
  console.log('[ensure-index] Done');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureIndex().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { ensureIndex };

