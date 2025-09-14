import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export const sheetsCsvTool = createTool({
  id: 'append-to-sheet',
  description:
    'Append rows to a local CSV (stand-in for Google Sheets MCP). Creates file if missing.',
  inputSchema: z.object({
    sheetName: z.string().default('runvc_sheet'),
    columns: z.array(z.string()).describe('Column headers, in order'),
    rows: z
      .array(z.record(z.any()))
      .describe('Array of row objects; keys should match columns'),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    appended: z.number(),
  }),
  execute: async ({ context }) => {
    const { sheetName, columns, rows } = context;
    const dir = join(process.cwd(), 'data');
    const file = join(dir, `${sheetName}.csv`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Write header if file doesn't exist
    if (!existsSync(file)) {
      appendFileSync(file, columns.map(escapeCsv).join(',') + '\n', 'utf8');
    }

    let appended = 0;
    for (const row of rows) {
      const line = columns.map((c) => escapeCsv(row[c])).join(',') + '\n';
      appendFileSync(file, line, 'utf8');
      appended += 1;
    }

    return { filePath: file, appended };
  },
});

