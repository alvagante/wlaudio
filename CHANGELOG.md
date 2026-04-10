# Changelog

## v0.5.0

### Terminal page (`/terminal.html`)

- **New PTY-backed terminal** — spawn interactive login shells directly in the browser using [`node-pty`](https://github.com/microsoft/node-pty) and [xterm.js](https://xtermjs.org/) (v5.5.0 + FitAddon)
- **Multi-tab** — open as many terminal instances as you like; each tab shows the project directory name and a close button
- **Project selector** — choose a working directory from your existing projects or type any path directly; also accepts a `?cwd=` query param so Projects page can deep-link straight to a terminal for that project
- **Auto-launch** — each new terminal automatically runs `claude` after the shell has initialised
- **Resize support** — the terminal reflows to fill available space and notifies the PTY of new dimensions
- **Reconnect restore** — on WebSocket reconnect, existing terminal tabs re-subscribe to output so no output is missed
- **Security** — terminal functionality is disabled by default; set `TERMINAL_ENABLED=1` (or `true`) to enable; `terminal:create` messages are rejected unless the HTTP `Origin` header is present and is a localhost origin (`localhost`, `127.0.0.1`, `::1`)
- **Runtime validation** — every terminal WebSocket message is validated before use; malformed payloads are silently dropped
- **Orphan cleanup** — when the last subscribed client disconnects, the underlying PTY process is killed automatically

### Shared sidebar layout

- **`public/shared.css`** — single source of truth for the High Contrast palette (`--bg`, `--text`, `--blue`, `--green`, `--overlay`, `--surface2`, etc.), sidebar layout, connection indicator, and common utility classes; all seven pages now import this one file instead of duplicating `:root` blocks
- **Left sidebar** — replaced the top navigation bar with a 200 px left sidebar across all pages; sidebar includes logo + version, nav links with active accent bar, connection indicator, and focus mode toggle (dashboard only)
- **Nav links** — sidebar now links all seven pages: Dashboard · Sessions · Analytics · Projects · Configs · Themes · Terminal

### Theme changes

- **High Contrast is the new default** — `theme.js` defaults to High Contrast (no `data-theme` needed); Catppuccin Mocha is now a named selectable theme
- **`themes.css`** — added explicit `[data-theme="high-contrast"]` and `[data-theme="mocha"]` selectors
- **Themes page** — High Contrast listed first in the picker

### Dashboard improvements

- CSS variables used throughout `dashboard.css` and `dashboard.js` so all 15+ themes propagate correctly to the hero card, waveform animation, stat glow effects, and Chart.js chart colours
- Waveform reads `--blue` at start time; hex-to-rgba conversion replaces the previously broken `color-mix()` in Canvas `fillStyle`
- Live session sidebar cards updated with improved badge and prompt display

### Backend

- **Orphan session meta** — `src/data.ts` now extracts `startTime` and `firstPrompt` from orphan session JSONL files so ended sessions appear with richer metadata in the sidebar
- **`src/terminal.ts`** — new `TerminalManager` class (EventEmitter) wrapping `node-pty`; exposes `create`, `write`, `resize`, `kill`, `killAll`, and `list`; PTY spawn falls back to `$HOME` when the requested `cwd` does not exist
- **New WebSocket message types** — `terminal:create`, `terminal:input`, `terminal:resize`, `terminal:close`, `terminal:output`, `terminal:exit`
- **New REST endpoint** — `GET /api/v1/terminals` lists running terminal sessions

---

## v0.4.0

### New pages

- **Sessions page** (`/sessions.html`) — dedicated full-page session browser with sidebar, live stats, sparkline, plans, and config panel; same detail view as the dashboard
- **Projects page** (`/projects.html`) — per-project aggregates: session count, total tokens, git commits, lines added/removed, languages, outcome doughnut chart, and a list of all sessions for the selected project; sortable by most recent / session count / commits / lines
- **Configs page** (`/configs.html`) — view global and per-project `settings.json` in one place: MCP servers, hooks (grouped by event), allow/deny permission rules, and model settings; project cards show hook/rule counts at a glance
- **Themes page** (`/themes.html`) — live theme switcher; pick from 17 colour schemes (Catppuccin Mocha/Macchiato/Frappe/Latte, Tokyo Night, Gruvbox, Nord, Dracula, Solarized, GitHub Light, Solarized Light, One Light, Rosé Pine Dawn, Everforest Light, Flexoki Light, B&W, and the default Mocha); choice persists in `localStorage`

### Navigation

- Top nav bar now links all five pages: Dashboard · Sessions · Analytics · Projects · Configs · Themes

### Backend

- New `/api/v1/projects` endpoint — aggregates session metadata by working directory
- New `/api/v1/configs` endpoint — reads global + per-project `settings.json` files
- `dashboard.js` extracted from `app.js` — dashboard-specific rendering split into its own module

### Theme system

- `theme.js` — applies saved theme before first paint (no flash)
- `themes.css` — 17 CSS variable overrides, one per theme

---

## v0.3.0

### Analytics page (`/analytics.html`)
- **New standalone page** linked from the dashboard header — cross-session insights at a glance
- **Summary cards** — total sessions, total messages, first-use date, longest session (duration + message count)
- **Activity by hour** — Chart.js bar chart of message frequency across all 24 hours sourced from `stats-cache.json hourCounts`
- **Session outcomes** — doughnut chart of achieved / mostly achieved / partial / not achieved across all sessions, with legend showing counts and percentages
- **Languages worked in** — horizontal bar chart of the top 12 languages by file count, aggregated across all `session-meta` files
- **Model usage & cost** — table of input/output/cache tokens and estimated cost per model with a grand total row
- New `/api/v1/analytics` backend endpoint aggregates all the above on demand

### Session detail improvements
- **First prompt card** — the opening user message of each session shown above the AI summary card; sourced from `session-meta.first_prompt`
- **Activity hours chart** — 24-slot proportional bar chart showing which hours the user sent messages during the session; sourced from `session-meta.message_hours`
- **Friction indicator** — if Claude took a wrong approach, a friction badge appears in the summary card alongside the outcome and helpfulness badges; friction detail text shown below the summary; sourced from `facets.friction_counts` and `facets.friction_detail`
- **Per-model cost breakdown** — the cost badge tooltip now shows a per-model cost breakdown for the current session before the static pricing table
- **Entrypoint and kind in header** — detail-meta line now shows `cli / interactive` (or `web / batch` etc.)

### Sidebar improvements
- **Outcome badge** — ended sessions show a coloured badge (green / yellow / orange / red) for achieved / mostly achieved / partial / not achieved
- **First prompt subtitle** — ended sessions show a truncated version of their opening message below the badge row

### Backend
- `SessionFacets` extended with `frictionCounts`, `frictionDetail`, `userSatisfactionCounts`
- `SessionMeta` extended with `messageHours`
- `GlobalStats` extended with `hourCounts`, `longestSession`, `firstSessionDate`

---

## v0.2.1
- **Recent sessions** — up to 15 recently ended sessions appear in the sidebar below active ones, separated by a "RECENT" label with an "ended" badge; sourced from `~/.claude/usage-data/session-meta/`
- **Recent session detail** — selecting a recent session shows its full detail view: code impact row, tool frequency chart, tool timeline, prompts, tasks, and files tab; token/cost metrics show "—" (not stored in metadata) while tool counts and duration remain accurate
- **CLAUDE FILES for ended sessions** — the CLAUDE FILES button now works for recently ended sessions, not just active ones
- **Full path in session files popup** — each config file entry now shows its complete filesystem path below the label

## v0.2.0
- **Tool detail popups** — click any bar in Top Tools to see all calls for that tool (input params, duration, full output); click any timeline row for that specific call
- **Session files viewer** — CLAUDE FILES button opens a two-panel popup listing every config file affecting the session (global + project `CLAUDE.md`, `settings.json`, `settings.local.json`) with presence indicators and full content view
- **AI summary card** — shows goal, outcome, helpfulness rating, brief summary and goal categories sourced from `~/.claude/usage-data/facets/` (written by Claude at session end)
- **Code impact row** — lines added/removed, files modified, git commits/pushes, languages, user interruptions sourced from `~/.claude/usage-data/session-meta/`
- **Files tab** — every file touched in the session; Edit operations show before/after diff blocks, Write shows full written content, Read shows params
- **Error count** — tool error count shown on the TOOLS CALLED metric card
- **Live meta updates** — `usage-data/` dirs are watched; summary card and impact row update automatically when a session ends

## v0.1.0
- Initial release: live token metrics, cost estimate, tool timeline, token doughnut, top tools chart, prompts, tasks, global stats sparkline
