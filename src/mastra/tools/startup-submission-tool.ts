import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SubmissionSchema = z.object({
  startupName: z.string().min(1, 'startupName is required'),
  contactEmail: z.string().email('valid contactEmail required'),
  website: z.string().url().optional(),
  oneLiner: z.string().optional(),
  problem: z.string().optional(),
  solution: z.string().optional(),
  targetCustomer: z.string().optional(),
  stageOrTraction: z.string().optional(),
  businessModel: z.string().optional(),
  goToMarket: z.string().optional(),
  competition: z.string().optional(),
  team: z.string().optional(),
  location: z.string().optional(),
  fundingAsk: z.string().optional(),
  deckUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const startupSubmissionTool = createTool({
  id: 'submit-startup',
  description:
    'Save a startup submission to local storage for Run VC review. Writes JSON to data/submissions and returns a reference id.',
  inputSchema: SubmissionSchema,
  outputSchema: z.object({
    id: z.string(),
    savedPaths: z.array(z.string()),
    primaryPath: z.string(),
  }),
  execute: async ({ context }) => {
    // Build submission record
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      submittedAt: new Date().toISOString(),
      ...context,
    };

    // Primary path: when running under mastra, cwd is typically .mastra/output
    const primaryDir = join(process.cwd(), 'data', 'submissions');
    const repoDir = resolve(process.cwd(), '..', '..', 'data', 'submissions'); // repo root mirror

    const toCreate: string[] = [primaryDir];
    // Only add repoDir if the parent likely exists (avoid permissions issues)
    const repoDataParent = resolve(process.cwd(), '..', '..', 'data');
    if (existsSync(repoDataParent)) {
      toCreate.push(repoDir);
    }

    const savedPaths: string[] = [];
    for (const dir of toCreate) {
      try {
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        const file = join(dir, `submission-${id}.json`);
        await writeFile(file, JSON.stringify(record, null, 2), 'utf8');
        savedPaths.push(file);
      } catch {
        // ignore write errors for non-primary mirrors
      }
    }

    if (!savedPaths.length) {
      throw new Error('Failed to save submission to any target path.');
    }

    return { id, savedPaths, primaryPath: savedPaths[0] };
  },
});

