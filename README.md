Mastra Run VC Web + Chat

What’s included
- Run VC website agent that pre-crawls https://run.vc and answers from that saved data.
- Tools: `prebuilt-runvc-qa` (website index), `faq-sheets-qa` (Google Sheet), `portfolio-static` (static JSON).

Getting started
- Prereq: Node 20+.
- Option A — Mastra playground (agents): `npm run dev` (unchanged; for reference only).
- Option B — Website + CometChat widget page: `npm run web` then open `http://localhost:8080`.

Website + CometChat widget
- File: `public/embed.html` — Minimal page that:
  - Iframes any site (default `https://run.vc`, override with `?u=<url>`)
  - Mounts the CometChat Chat Embed widget for chat
- The page loads: `https://cdn.jsdelivr.net/npm/@cometchat/chat-embed@latest/dist/main.js`
- Configure inside `public/embed.html`:
  - `COMETCHAT_CREDENTIALS` (appID, appRegion, authKey)
  - `COMETCHAT_LAUNCH_OPTIONS` (targetElementID, isDocked, width/height, chatType, defaultChatID, variantID)
  - Provide the user UID via query param: `?uid=<yourUserUid>` or edit `COMETCHAT_USER_UID` placeholder
- Preview: `http://localhost:8080?u=https://run.vc&uid=<yourUserUid>`

Embed elsewhere
- You can embed `public/embed.html` itself in another site via iframe, or host it directly.
- Note: Some sites disallow iframing via `X-Frame-Options` or CSP `frame-ancestors`. If that happens, consider a proxy renderer approach; I can add a simple proxy mode if needed.

 

Notes
- This setup does not have the agent scraping; the page just displays the site and your CometChat widget handles Q&A.

FAQs from Google Sheets
- Set the env var in `.env`:
  - `RUNVC_FAQ_SHEET_URL=<your Google Sheet link>` (include `gid=` for the tab to use)
- Make the sheet accessible: Share with “Anyone with the link can view” or Publish to the web.
- The agent calls the `faq-sheets-qa` tool first for every question and uses its answer if a close match is found.
- Cache TTL: set `RUNVC_FAQ_TTL_MINUTES` (default 10). Set to `1` for near real-time updates as you edit the sheet.

Static portfolio data
- The agent can answer portfolio questions from a static file: `data/runvc_portfolio.json`.
- Format:
  {
    "companies": [ { "name": "Company", "website": "https://...", "logo": "(optional)", "description": "(optional)" } ]
  }
- Edit this file any time; no rebuild required. The `portfolio-static` tool reads it at runtime.
- If running via `mastra dev` where the working dir is `.mastra/output`, the tool looks in:
  - `.mastra/output/data/runvc_portfolio.json`, then `../data/runvc_portfolio.json` (repo root)
  - Or set `RUNVC_PORTFOLIO_PATH=/absolute/path/to/runvc_portfolio.json` to override.

Answering priority
- Company-specific questions: checks static portfolio data first (portfolio-static), then FAQs, then the website index.
- All other questions: checks FAQs first (faq-sheets-qa), then falls back to the website index (prebuilt-runvc-qa).

Pre-crawl and index (website data)
- Crawl run.vc and build a local vector index:
  - `npm run crawl:runvc` — fetches pages into `data/runvc_pages.json`
  - `npm run index:runvc` — builds embeddings index into `data/runvc_index.json`
- The agent tool `prebuilt-runvc-qa` uses this index to answer questions strictly from run.vc content.
- You can re-run these commands whenever the site changes.
- Auto-run on agent start: `npm run dev` and `npm start` will run `src/mastra/scripts/ensure-index.mjs` first.
  - It builds the index if missing or older than `RUNVC_INDEX_TTL_HOURS` (default 24h).
  - Override: set `RUNVC_INDEX_TTL_HOURS=0` to force rebuild every run, or increase to reduce frequency.

 

Wiring to your chat backend
- If you want an HTTP endpoint to serve answers from the prebuilt index (for CometChat webhooks or extensions), I can add `POST /api/ask` that reads `data/runvc_index.json`, embeds the query, retrieves top-K, and returns `{ answer, sources }`.
Emailing pitches
- The agent can email a generated pitch using the `send-email` tool.
- Configure SendGrid (recommended):
  - `EMAIL_PROVIDER=sendgrid`
  - `SENDGRID_API_KEY=<your key>`
  - `EMAIL_FROM=<verified sender, e.g., no-reply@yourdomain>`
  - Optional default recipient: `RUNVC_PITCH_TO=swapnil.godambe@comechat.com`
- If SendGrid is not configured, emails are written to `data/outbox/email-*.json` for review.

Startup submissions (no pitch generation)
- The agent collects basic startup details conversationally and saves a JSON submission locally via `submit-startup`.
- Files are written to `.mastra/output/data/submissions/submission-<id>.json` and mirrored to `data/submissions/` at repo root if available.
- Minimum fields to submit: `startupName` and `contactEmail`. Optional fields: `website`, `oneLiner`, `problem`, `solution`, `targetCustomer`, `stageOrTraction`, `businessModel`, `goToMarket`, `competition`, `team`, `location`, `fundingAsk`, `deckUrl`, `notes`.
