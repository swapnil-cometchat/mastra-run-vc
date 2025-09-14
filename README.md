Mastra Run VC Agent

What’s included
- Run VC website agent that can crawl https://run.vc and answer questions grounded in site content.
- Tools: `scrape-webpage`, `website-qa`, `append-to-sheet` (CSV stand-in for Google Sheets MCP).
- Weather sample agent preserved.

Getting started
- Prereq: Node 20+, set `OPENAI_API_KEY` in `.env`.
- Run dev server: `npm run dev`.
- Open the Playground URL shown in the console and select `Run VC Website Agent`.

Using the agent
- Ask questions like: “What is Run VC?”, “How do I pitch my startup?”, “What is on the run.vc homepage?”
- The agent crawls a bounded number of pages and cites sources.
- For a pitch request, it will gather details then produce a 1‑sentence, 30‑second, and 3‑minute pitch.
- To log results to a sheet, ask “Log this to a sheet named ‘runvc_leads’”. The tool appends rows to `data/runvc_leads.csv`.

Embed in an iframe
- After `npm run dev`, the Playground is available locally. You can embed it in your site with an iframe, for example:
  <iframe src="http://localhost:8787/playground" style="width:100%;height:700px;border:0;" title="Run VC Agent"></iframe>
- Tip: You can constrain the UI via your container (e.g., hide headers) if you want a minimal look.

Google Sheets via MCP
- This repo ships a CSV-based stand-in tool (`append-to-sheet`) to avoid extra setup.
- To use Google Sheets via MCP in production, swap the tool with an MCP client that connects to a Google Sheets MCP server and maps calls to your spreadsheet.
- Suggested schema for rows: `{ timestamp, userPrompt, responseType, summary, sources[] }`.

Notes
- Network access is required for crawling. The crawl is origin-bound by default and limited by `maxPages` and `maxDepth`.
- Keep within the website’s robots and terms.

