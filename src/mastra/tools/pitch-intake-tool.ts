import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { saveJsonRecord } from './storage-util';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

    // Append to CSV (for external spreadsheet ingestion)
    try {
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const csvPath = join(dir, 'pitch_intakes.csv');
      const headers = ['id','submittedAt','startupName','oneLiner','contactEmail','website','description'];
      if (!existsSync(csvPath)) {
        await writeFile(csvPath, headers.join(',') + '\n', 'utf8');
      }
      const esc = (v: any) => {
        if (v === undefined || v === null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const row = [
        record.id,
        record.submittedAt,
        record.startupName,
        record.oneLiner,
        record.contactEmail,
        record.website || '',
        record.description || ''
      ].map(esc).join(',') + '\n';
      await appendFile(csvPath, row, 'utf8');
    } catch {
      // non-fatal
    }

    return { id: res.id, savedPaths: res.savedPaths, primaryPath: res.primaryPath };
  },
});
