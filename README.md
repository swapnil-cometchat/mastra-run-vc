Mastra Run VC Web + Chat

What’s included
- Run VC website agent that can crawl https://run.vc and answer questions grounded in site content.
- Tools: `scrape-webpage`, `website-qa`, `append-to-sheet` (CSV stand-in for Google Sheets MCP).
- Weather sample agent preserved.

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

Google Sheets via MCP
- This repo ships a CSV-based stand-in tool (`append-to-sheet`) to avoid extra setup.
- To use Google Sheets via MCP in production, swap the tool with an MCP client that connects to a Google Sheets MCP server and maps calls to your spreadsheet.
- Suggested schema for rows: `{ timestamp, userPrompt, responseType, summary, sources[] }`.

Notes
- This setup does not have the agent scraping; the page just displays the site and your CometChat widget handles Q&A.

Pre-crawl and index (recommended for QA)
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
