import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Minimal pitch intake: only these fields.
const PitchIntakeSchema = z.object({
  startupName: z.string().min(1, 'startupName required'),
  oneLiner: z.string().min(5, 'Provide a short one-liner'),
  contactEmail: z.string().email('Valid contactEmail required'),
  website: z.string().url().optional(),
  description: z.string().optional(),
});

export const pitchIntakeTool = createTool({
  id: 'pitch-intake',
  description: 'Store a minimal pitch intake (startupName, oneLiner, contactEmail, optional website/description) for Run VC follow-up.',
  inputSchema: PitchIntakeSchema,
  outputSchema: z.object({ id: z.string(), savedPaths: z.array(z.string()), primaryPath: z.string() }),
  execute: async ({ context }) => {
    const id = `pitch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record = { id, submittedAt: new Date().toISOString(), ...context };

    const primaryDir = join(process.cwd(), 'data', 'pitch_submissions');
    const repoDir = resolve(process.cwd(), '..', '..', 'data', 'pitch_submissions');

    const dirs: string[] = [primaryDir];
    const repoDataParent = resolve(process.cwd(), '..', '..', 'data');
    if (existsSync(repoDataParent)) dirs.push(repoDir);

    const savedPaths: string[] = [];
    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        const file = join(dir, `${id}.json`);
        await writeFile(file, JSON.stringify(record, null, 2), 'utf8');
        savedPaths.push(file);
      } catch {}
    }

    if (!savedPaths.length) throw new Error('Failed to persist pitch intake.');
    return { id, savedPaths, primaryPath: savedPaths[0] };
  },
});
