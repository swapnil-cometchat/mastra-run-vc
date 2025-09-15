import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type Provider = 'sendgrid' | 'file';

async function sendViaSendgrid(args: {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  from: string;
  apiKey: string;
}) {
  const body = {
    personalizations: [{ to: args.to.map((e) => ({ email: e })) }],
    from: { email: args.from },
    subject: args.subject,
    content: [
      args.html ? { type: 'text/html', value: args.html } : undefined,
      args.text ? { type: 'text/plain', value: args.text } : undefined,
    ].filter(Boolean),
  } as any;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${t}`);
  }
}

async function writeToOutbox(args: {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  from: string;
}) {
  const dir = join(process.cwd(), 'data', 'outbox');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `email-${ts}.json`);
  await writeFile(
    file,
    JSON.stringify({
      provider: 'file',
      to: args.to,
      from: args.from,
      subject: args.subject,
      text: args.text || '',
      html: args.html || '',
      createdAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  );
  return file;
}

export const emailTool = createTool({
  id: 'send-email',
  description: 'Send an email via SendGrid (if configured) or write to a local outbox file as a fallback.',
  inputSchema: z.object({
    to: z.union([z.string(), z.array(z.string())]).describe('Recipient email(s). Comma separated or array.'),
    subject: z.string().default('Run VC Agent Message'),
    text: z.string().optional(),
    html: z.string().optional(),
  }),
  outputSchema: z.object({
    provider: z.enum(['sendgrid', 'file']),
    message: z.string(),
    outboxPath: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const toList = Array.isArray(context.to)
      ? context.to
      : String(context.to)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    if (!toList.length) throw new Error('No recipients provided');

    const provider: Provider = (process.env.EMAIL_PROVIDER as Provider) || 'sendgrid';
    const from = process.env.EMAIL_FROM || 'no-reply@run.vc';

    if (provider === 'sendgrid') {
      const apiKey = process.env.SENDGRID_API_KEY;
      if (!apiKey) {
        // fall back to file when not configured
        const path = await writeToOutbox({ to: toList, subject: context.subject, text: context.text, html: context.html, from });
        return { provider: 'file' as const, message: `Email written to ${path}`, outboxPath: path };
      }
      await sendViaSendgrid({ to: toList, subject: context.subject, text: context.text, html: context.html, from, apiKey });
      return { provider: 'sendgrid' as const, message: 'Email sent via SendGrid' };
    }

    const path = await writeToOutbox({ to: toList, subject: context.subject, text: context.text, html: context.html, from });
    return { provider: 'file' as const, message: `Email written to ${path}`, outboxPath: path };
  },
});
