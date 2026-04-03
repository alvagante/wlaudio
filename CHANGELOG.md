
## Changelog

### v0.2.1
- **Recent sessions** — up to 15 recently ended sessions appear in the sidebar below active ones, separated by a "RECENT" label with an "ended" badge; sourced from `~/.claude/usage-data/session-meta/`
- **Recent session detail** — selecting a recent session shows its full detail view: code impact row, tool frequency chart, tool timeline, prompts, tasks, and files tab; token/cost metrics show "—" (not stored in metadata) while tool counts and duration remain accurate
- **CLAUDE FILES for ended sessions** — the CLAUDE FILES button now works for recently ended sessions, not just active ones
- **Full path in session files popup** — each config file entry now shows its complete filesystem path below the label

### v0.2.0
- **Tool detail popups** — click any bar in Top Tools to see all calls for that tool (input params, duration, full output); click any timeline row for that specific call
- **Session files viewer** — CLAUDE FILES button opens a two-panel popup listing every config file affecting the session (global + project `CLAUDE.md`, `settings.json`, `settings.local.json`) with presence indicators and full content view
- **AI summary card** — shows goal, outcome, helpfulness rating, brief summary and goal categories sourced from `~/.claude/usage-data/facets/` (written by Claude at session end)
- **Code impact row** — lines added/removed, files modified, git commits/pushes, languages, user interruptions sourced from `~/.claude/usage-data/session-meta/`
- **Files tab** — every file touched in the session; Edit operations show before/after diff blocks, Write shows full written content, Read shows params
- **Error count** — tool error count shown on the TOOLS CALLED metric card
- **Live meta updates** — `usage-data/` dirs are watched; summary card and impact row update automatically when a session ends

### v0.1.0
- Initial release: live token metrics, cost estimate, tool timeline, token doughnut, top tools chart, prompts, tasks, global stats sparkline

