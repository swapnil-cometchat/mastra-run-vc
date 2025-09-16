Mastra Run VC Minimal Agent

What’s included (final minimal scope)
- Prebuilt run.vc website Q&A: `prebuilt-runvc-qa` (answers strictly from indexed site chunks)
- Portfolio company Q&A: `portfolio-static` (static JSON list)
- FAQ Sheet Q&A: `faq-sheets-qa` (Google Sheet tab)
- Minimal pitch intake (CSV append only): `pitch-intake`

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

Answering behavior
- Portfolio questions: use portfolio static data (list or details). If not found, reply "Not found on run.vc. Please check the Portfolio page." (as configured in agent instructions).
- FAQ-style questions: try FAQ sheet; if low match or missing, fallback to website index.
- General run.vc questions: website index.
- Pitch intent: trigger minimal pitch intake flow (see below).

Pre-crawl and index (website data)
- Crawl run.vc and build a local vector index:
  - `npm run crawl:runvc` — fetches pages into `data/runvc_pages.json`
  - `npm run index:runvc` — builds embeddings index into `data/runvc_index.json`
- The agent tool `prebuilt-runvc-qa` uses this index to answer questions strictly from run.vc content.
- You can re-run these commands whenever the site changes.
- Auto-run on agent start: `npm run dev` and `npm start` will run `src/mastra/scripts/ensure-index.mjs` first.
  - It builds the index if missing or older than `RUNVC_INDEX_TTL_HOURS` (default 24h).
  - Override: set `RUNVC_INDEX_TTL_HOURS=0` to force rebuild every run, or increase to reduce frequency.

 

Minimal pitch intake (strict)
The agent collects at most 3 short items ONLY when the user clearly expresses intent to pitch:
1. Startup name (if not already given)
2. One-line description
3. Contact email
Optional: website ONLY if explicitly provided already; not a separate question.
After required fields present it appends a row to `data/pitch_intakes.csv` with: id,timestamp,startupName,oneLiner,contactEmail,website(optional) and replies exactly: `Thanks! We will be in touch`.
No pitch generation, no extended questionnaire, no emailing.

Removed / deprecated (intentionally not present anymore)
- Email tooling & outbound pitch emails
- Rich multi-question startup submission (`submit-startup`)
- Middleware prototypes (question limiting / description capture)
- JSON submission mirroring (CSV only now)

Environment variables in use
- `OPENAI_API_KEY` - required for embeddings & model
- `RUNVC_FAQ_SHEET_URL` - public/shareable Google Sheet link
- `RUNVC_FAQ_TTL_MINUTES` - optional cache TTL (default 10)
Optional / can remove if present: legacy email vars (`EMAIL_PROVIDER`, `SENDGRID_API_KEY`, `EMAIL_FROM`, `RUNVC_PITCH_TO`).

Regenerating site index
Commands remain the same:
`npm run crawl:runvc` -> updates `data/runvc_pages.json`
`npm run index:runvc` -> updates `data/runvc_index.json`
Index tool looks for `data/runvc_index.json`. Override path with `RUNVC_INDEX_PATH`.

Development
`npm install`
`npm run dev` (agent playground) or `npm run web` (embed demo page)

Data files summary
- `data/runvc_index.json` (website chunks + embeddings)
- `data/runvc_pages.json` (raw crawled pages)
- `data/runvc_portfolio.json` (portfolio companies)
- `data/pitch_intakes.csv` (minimal pitch submissions)

License: Internal / experimental.
