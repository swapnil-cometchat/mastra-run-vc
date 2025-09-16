import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SaveJsonOptions<T> {
  subDir: string;           // e.g. 'submissions' or 'pitch_submissions'
  prefix?: string;          // e.g. 'submission' or 'pitch'
  record: T;                // object to serialize
  id?: string;              // optional precomputed id
  fileName?: string;        // override filename (without dir)
}

export interface SaveJsonResult {
  id: string;
  savedPaths: string[];
  primaryPath: string;
}

export async function saveJsonRecord<T>(opts: SaveJsonOptions<T>): Promise<SaveJsonResult> {
  const { subDir, prefix, record } = opts;
  const id = opts.id || `${prefix || 'rec'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileBase = opts.fileName || `${id}.json`;

  const primaryDir = join(process.cwd(), 'data', subDir);
  const repoDir = resolve(process.cwd(), '..', '..', 'data', subDir);
  const dirs: string[] = [primaryDir];
  const repoDataParent = resolve(process.cwd(), '..', '..', 'data');
  if (existsSync(repoDataParent)) dirs.push(repoDir);

  const serialized = JSON.stringify(record, null, 2);
  const savedPaths: string[] = [];
  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const file = join(dir, fileBase);
      await writeFile(file, serialized, 'utf8');
      savedPaths.push(file);
    } catch {
      // ignore mirror write errors
    }
  }
  if (!savedPaths.length) throw new Error('Failed to persist record');
  return { id, savedPaths, primaryPath: savedPaths[0] };
}
