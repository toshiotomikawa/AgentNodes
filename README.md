# Agent Nodes

A local dashboard that shows which AI agent started which. It reads the sessions that Claude Code, Codex, OpenCode, Pi and Antigravity (the app and the agy terminal) keep on this PC and draws them as a tree: each session is a card, and its subagents hang below it.

Inspired by [this post](https://x.com/flohoeller/status/2112150373565612534). A scripted replica of that video is included as the Demo page.

## Run it

Use Node 24 or newer (including built-in TypeScript support for the tests and `node:sqlite`).

```bash
npm ci
npm run dev
```

Then open http://127.0.0.1:5199. The server listens on this PC only, because session titles and folders are private.

On Windows, `scripts/start-agent-notes.vbs` starts the server without a terminal window and opens your default browser. Repeated launches reuse port 5199. Startup logs stay in the ignored `.local/` folder. The launcher retains its historical Agent Notes filename.

For screenshots or a portfolio demonstration, open `http://127.0.0.1:5199/?mode=demo` directly. The scripted demo uses fictional sessions; the live page can display private titles, paths and message excerpts. Do not publish screenshots or exports of your live sessions.

The favicon is an original, simple node diagram in `public/favicon.svg`. No purchased icon, license receipt, private audit report or local session data is included in this repository. Fonts use the system fallbacks; the page does not load remote font stylesheets.

## What you see

- **Cards**: a blob in the model's color, name, model with its reasoning effort (for example Opus 5.5 (Medium)), task, estimated cost (including subagents), running time and status.
- **Status**: Running (active in the last 3 minutes), Waiting (a main session that is not running waits for you, with its clock still ticking), Done (finished subagents), Failed or Stopped. A main session that stays idle for 24 hours, or was last active before the PC restarted, moves to Closed.
- **Filter** (the funnel after the total): by app, by time window (since the PC was turned on, 1 hour, 6 hours, 24 hours or 7 days), and active sessions only.
- **Click a card** to see tokens, tools, folder and session id. The card widens to fit long values (up to two cards); anything longer is cut and shows in full on hover. Click any value to copy it, or use the Copy all icon.
- **Blobs** bounce once when the pointer enters a card and each time you click one.
- **Guardian review**: Codex starts a separate auto-review thread for every command it checks, so all of a session's reviews are folded into one card, with a Threads count in its details.
- **Double-click a card's name**, or choose Rename from its right-click menu, to rename it. A single title click does not edit it. An empty name restores the original.
- **Age sections:** Recent (under an hour), One hour (1–24 hours), One day (1–7 days), and One week (7 days or more) are separated by horizontal rules. Sessions move automatically according to their latest activity, so one you just talked to sits under Recent however long ago it started; each parent keeps its subagents together. Empty sections are hidden. Sessions you close in their own app or terminal (Claude Code and Codex) move to a Closed section at the bottom, as do sessions you close or mark as closed here. Closed cards are tinted gray with a gray Closed pill, and still count in the estimated total. Company badges sit beside the model name without covering the blob. Trees pack into the columns that free up first, so short trees leave no gaps. Each card shows a small permanent number, such as #007, so you can refer to it.
- **Mark as done** in the right-click menu sets a local completion override. It does not stop the real agent; **Undo mark as done** restores the live status.
- **Change color** offers eight presets and a custom hex color for the blob and card border. **Use model color** restores the default.
- Appearance settings, filters, names, hidden cards, completion overrides and custom colors are saved in this browser's local storage. Demo speed and autopilot are saved too; the demo timeline and page choice remain temporary.
- Expanded live cards show matched model specifications from [Models.dev](https://models.dev), including context and output limits. API IDs remain unchanged. The server caches the public catalogue in `.local/models-dev.json`, refreshes it daily, and uses the last valid copy offline. It never sends session data to Models.dev. Pricing estimates still use the existing pricing logic.
- **Uptime**: when turned on in More settings, how long this PC has been running, at the bottom right.
- **Right-click a card**, or click the faint X near its top right corner, to close it. A menu setting decides whether Close only hides the card (the default) or also stops the real agent.

Costs are **estimates at API list prices** from token usage. On a subscription they are not what you pay. Hover over or click the total to see this note on the page.

## Menu

The menu at the top right holds the theme (System, Light or Dark), the Demo page, a link to this repository and Quit, which stops the local server. Its "More settings" page holds the close setting, whether blobs show and their shape (Jelly, Gumdrop or Amoeba), whether animations run, and whether the uptime timer shows.

## Privacy and safety

- Every database is opened read-only. Agent Nodes never writes to another tool's data.
- Session collection does not read credential stores such as `~/.codex/auth.json` or OpenCode account tables. If you explicitly stop an OpenCode session, the stop handler reads the local service connection file to authenticate to the loopback service; its credential is not returned to the browser.
- API routes validate the loopback connection, Host, browser origin and a custom request header. Cross-origin CORS access is disabled in development and preview. These are local browser protections, not authentication against programs running as your user.
- The dashboard reads session titles, folder paths and message excerpts. If secrets were pasted into an agent conversation, they can appear in the live dashboard. Keep it on loopback; do not expose it through a public tunnel, reverse proxy or `--host` override.
- Model catalogue refreshes contact Models.dev for public metadata. Session contents are not sent with those requests. See [SECURITY.md](SECURITY.md).

## Build

```bash
npm run build
```

This runs the type check and builds into `dist/`. `npm run preview` serves the build, live data included.

## Tests

```bash
npm test
npm run build
```

Tests use synthetic fixtures and do not stop real agents or collect real sessions.

## License

[MIT](LICENSE). Copyright (c) 2026 toshiotomikawa. Dependencies retain their respective licenses.
