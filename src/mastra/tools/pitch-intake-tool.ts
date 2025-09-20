import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { google, sheets_v4 } from 'googleapis';

// Expanded pitch intake: capture the targeted set of fields gathered by the agent.
const PitchIntakeSchema = z.object({
  startupName: z.string().min(1, 'startupName required'),
  oneLiner: z.string().min(5, 'Provide a short one-liner'),
  contactEmail: z.string().email('Valid contactEmail required'),
  website: z.string().url().optional(),
  description: z.string().optional(),
  companyStage: z.string().min(2, 'Provide a brief company stage').optional(),
  traction: z.string().min(2, 'Share a short traction highlight').optional(),
});

type PitchRecord = {
  kind: 'pitch-intake';
  id: string;
  submittedAt: string;
  startupName: string;
  oneLiner: string;
  contactEmail: string;
  website?: string;
  description?: string;
  companyStage?: string;
  traction?: string;
};

const SHEETS_SCOPE = ['https://www.googleapis.com/auth/spreadsheets'];

type SheetsConfig = {
  credentials: Record<string, unknown>;
  spreadsheetId: string;
  tabName: string;
};

let cachedConfig: SheetsConfig | null | undefined;
let cachedSheetsClient: Promise<sheets_v4.Sheets> | null = null;

function loadSheetsConfig(): SheetsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const spreadsheetId = process.env.RUNVC_PITCH_SHEET_ID;
  if (!rawKey || !spreadsheetId) {
    cachedConfig = null;
    return cachedConfig;
  }
  try {
    const decoded = Buffer.from(rawKey, 'base64').toString('utf8');
    const credentials = JSON.parse(decoded) as Record<string, unknown>;
    const tabName = process.env.RUNVC_PITCH_TAB_NAME?.trim() || 'Sheet1';
    cachedConfig = { credentials, spreadsheetId, tabName };
    return cachedConfig;
  } catch (error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be base64-encoded JSON credentials.');
  }
}

async function getSheetsClient(config: SheetsConfig): Promise<sheets_v4.Sheets> {
  if (!cachedSheetsClient) {
    cachedSheetsClient = (async () => {
      const auth = new google.auth.GoogleAuth({
        credentials: config.credentials,
        scopes: SHEETS_SCOPE,
      });
      const authClient = await auth.getClient();
      return google.sheets({ version: 'v4', auth: authClient });
    })();
  }
  return cachedSheetsClient;
}

async function appendCsv(record: PitchRecord): Promise<string> {
  try {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const csvPath = join(dir, 'pitch_intakes.csv');
    const headers = [
      'id',
      'submittedAt',
      'startupName',
      'oneLiner',
      'contactEmail',
      'website',
      'description',
      'companyStage',
      'traction',
    ];
    if (!existsSync(csvPath)) {
      await writeFile(csvPath, headers.join(',') + '\n', 'utf8');
    }
    const esc = (v: unknown) => {
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
      record.description || '',
      record.companyStage || '',
      record.traction || '',
    ]
      .map(esc)
      .join(',') + '\n';
    await appendFile(csvPath, row, 'utf8');
    return csvPath;
  } catch {
    throw new Error('Failed to persist pitch intake to CSV');
  }
}

async function appendToGoogleSheet(record: PitchRecord) {
  const config = loadSheetsConfig();
  if (!config) return null;
  const sheets = await getSheetsClient(config);
  const range = `${config.tabName}!A:I`;
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          record.id,
          record.submittedAt,
          record.startupName,
          record.oneLiner,
          record.contactEmail,
          record.website || '',
          record.description || '',
          record.companyStage || '',
          record.traction || '',
        ],
      ],
    },
  });
  return { spreadsheetId: config.spreadsheetId, range };
}

export const pitchIntakeTool = createTool({
  id: 'pitch-intake',
  description:
    'Store a pitch intake (startupName, oneLiner, contactEmail, optional website/description/companyStage/traction) for Run VC follow-up.',
  inputSchema: PitchIntakeSchema,
  outputSchema: z.object({
    id: z.string(),
    csvPath: z.string(),
    sheet: z
      .object({
        spreadsheetId: z.string(),
        range: z.string(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    const id = `pitch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: PitchRecord = {
      kind: 'pitch-intake',
      id,
      submittedAt: new Date().toISOString(),
      ...context,
    };

    const csvPath = await appendCsv(record);
    let sheet: { spreadsheetId: string; range: string } | null = null;
    try {
      sheet = await appendToGoogleSheet(record);
    } catch (error) {
      // surface configuration errors so they can be fixed quickly
      throw error instanceof Error
        ? new Error(`Google Sheets append failed: ${error.message}`)
        : new Error('Google Sheets append failed.');
    }

    return sheet ? { id: record.id, csvPath, sheet } : { id: record.id, csvPath };
  },
});
