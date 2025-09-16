import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { saveJsonRecord } from './storage-util';

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
    const record = { kind: 'pitch-intake', id, submittedAt: new Date().toISOString(), ...context };
    const res = await saveJsonRecord({ subDir: 'pitch_submissions', prefix: 'pitch', record, id, fileName: `${id}.json` });
    return { id: res.id, savedPaths: res.savedPaths, primaryPath: res.primaryPath };
  },
});
