# Docker Hub — lab42it/wlaudio

## Short Description

> Paste this into the "Short Description" field on Docker Hub (99 characters):

```
Real-time browser dashboard for monitoring Claude Code sessions. No API calls — reads ~/.claude/ directly.
```

---

## Full Overview

> Paste everything below this line into the "Overview" tab on Docker Hub.

---

# Wlaudio

Real-time browser dashboard for monitoring Claude Code sessions. Mount your `~/.claude/` directory, open a browser, and watch your sessions live — tokens, costs, tool calls, commits, diffs, and more.

No API keys. No instrumentation. No agents. Just a read-only mount and a port.

## Quick Start

```bash
docker run --rm -p 4242:4242 \
  -v "${HOME}/.claude:/root/.claude:ro" \
  -e HOME=/root \
  lab42it/wlaudio:latest
```

Then open **http://localhost:4242**

### With Docker Compose

```yaml
services:
  wlaudio:
    image: lab42it/wlaudio:latest
    ports: ["4242:4242"]
    volumes: ["${HOME}/.claude:/root/.claude:ro"]
    environment:
      - HOME=/root
      - TERMINAL_ENABLED=0
```

## Pages

| Page | URL | What it shows |
|------|-----|---------------|
| Session Dashboard | `/` | Live tokens, cost estimate, tool call timeline, AI summary, code impact, activity hours, files diff, prompts, tasks |
| Session Timeline | `/timeline.html` | Chronological stream of every user message and tool call, filterable |
| Analytics | `/analytics.html` | Cross-session stats: activity by hour, session outcomes, languages, model cost table |
| Projects | `/projects.html` | Per-project aggregates: sessions, tokens, commits, lines, outcome chart |
| Configs | `/configs.html` | Global and per-project `settings.json`; MCP servers, hooks, permissions, model overrides; file browser for CLAUDE.md, hook scripts, skills |
| Themes | `/themes.html` | 17 themes: Catppuccin, Tokyo Night, Gruvbox, Nord, Dracula, Solarized, GitHub Light, and more |
| Terminal | `/terminal.html` | PTY-backed browser terminal; auto-runs `claude` on open. **Disabled in Docker mode** (PTY can't reach host shell) |
| MDD Dashboard | `/mdd.html` | Manual-First Development docs viewer (requires MDD installed globally) |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4242` | HTTP listening port |
| `HOME` | system | Set to `/root` in container — this is where `.claude` is mounted |
| `TERMINAL_ENABLED` | `1` | Set to `0` or `false` to disable the PTY terminal feature |

The terminal page requires access to the host shell and PATH, which is not available inside a container. Set `TERMINAL_ENABLED=0` when running via Docker.

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Current stable release |
| `0.6.0`, `0.5.0`, ... | Pinned version tags |

## Source & Docs

GitHub: https://github.com/alvagante/wlaudio
