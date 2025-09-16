import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { saveJsonRecord } from './storage-util';

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
    const id = `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { kind: 'startup-submission', id, submittedAt: new Date().toISOString(), ...context };
    const res = await saveJsonRecord({ subDir: 'submissions', prefix: 'submission', record, id });
    return { id: res.id, savedPaths: res.savedPaths, primaryPath: res.primaryPath };
  },
});

