# OMC Architecture (Reverse-Engineered)

> This document captures the architecture of oh-my-claudecode as discovered through REA analysis.

## Overview

oh-my-claudecode (OMC) is a multi-agent orchestration layer for Claude Code. It provides:

- A **CLI** (`omc`) for terminal use
- A **Claude Code plugin** for in-session skills (`/...`)
- A **setup** flow that registers skills, agents, and configuration

## Surfaces

| Surface | Entry | Runtime |
|---------|-------|---------|
| Terminal CLI | `omc <command>` | Node.js process |
| In-session skill | `/skill-name` | Claude Code plugin |
| Ask providers | `omc ask <provider>` / `/ask <provider>` | Routed through advisor flow |
| Team | `omc team` (tmux) / `/team` (native) | Different runtimes |

## Key Patterns

### Autopilot Pipeline
Stages: `ralplan → execution → [ralph] → [qa]`
- ralplan: Planning stage
- execution: Implementation stage
- ralph: Autonomous review/refinement
- qa: Quality assurance

Named profiles configured in `.claude/omc.jsonc` (project) or `~/.config/claude-omc/config.jsonc` (user).

### Team Orchestration
- CLI: Launches tmux workers
- In-session: Native team workflow

### Ask Providers
Supported: claude, codex, gemini, antigravity, grok, cursor, muse

### Skill Registration
- Plugin marketplace install: `/plugin marketplace add <url>` → `/plugin install <name>`
- npm install: `npm i -g oh-my-claude-sisyphus@latest`
- Setup: `omc setup` or `/omc-setup`

## Analysis TODO

*To be filled by REA reverse-engineering:*

- [ ] Plugin registration mechanism (how skills are discovered and loaded)
- [ ] Skill file format and contract
- [ ] Agent configuration schema
- [ ] State management (autopilot state, cancel, resume)
- [ ] HUD (heads-up display) implementation
- [ ] Lookout scan logic
- [ ] Deep interview state machine
