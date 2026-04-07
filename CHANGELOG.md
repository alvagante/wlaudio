# Changelog

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
