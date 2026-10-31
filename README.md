# RGA_Oh_My_UiPath

**Oh My UiPath** — Multi-agent orchestration for UiPath + Claude, reverse-engineered from oh-my-claudecode using REA.

## Vision

oh-my-claudecode gives Claude Code teams-first multi-agent orchestration with zero learning curve. This project brings that same experience to **UiPath + Claude** — wiring in `uipathcli` for platform API automation and `uipath/skills` for domain knowledge, so you can build, run, test, and deploy UiPath automations through natural language orchestration.

## Source Repos

| Repo | Purpose |
|------|---------|
| [oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode) | Reference architecture — autopilot, team, ask, ralph, deep-interview, lookout |
| [rea](https://github.com/morluto/rea) | Reverse-engineering tool to analyze OMC's structure and behavior |
| [uipath/skills](https://github.com/uipath/skills) | UiPath agent skills (rpa, agents, platform, admin, test, troubleshoot, etc.) |
| [uipathcli](https://github.com/UiPath/uipathcli) | UiPath Platform CLI for API calls (Orchestrator, AI Center, Document Understanding) |

## What OMC Provides (to replicate + adapt)

- **Autopilot** — Multi-stage task execution (ralplan → execution → ralph/qa)
- **Team** — Multi-agent orchestration (tmux CLI workers / in-session native)
- **Ask** — Route questions to multiple providers (claude, codex, gemini, etc.)
- **Ralph** — Autonomous coding agent
- **Deep Interview** — Iterative research and refinement
- **Lookout** — Pre-flight danger scan for unattended runs

## What We Add (UiPath-specific)

- **uipathcli integration** — Platform API calls via `uip` CLI (auth, Orchestrator, assets, queues, jobs, triggers)
- **uipath/skills integration** — Domain skills wired as sub-agents:
  - `uipath-rpa` — Workflow authoring (.xaml, .cs)
  - `uipath-agents` — AI agents (LangGraph, LlamaIndex, OpenAI Agents)
  - `uipath-platform` — Platform operations
  - `uipath-admin` — Identity, authorization, governance
  - `uipath-test` — Test management
  - `uipath-troubleshoot` — Root-cause investigation
  - And all other stable/preview skills
- **UiPath-aware autopilot** — Stages that understand UiPath project structure, .uipx solutions, and deployment targets

## Architecture Approach

1. **Reverse-engineer OMC** using REA to understand its orchestration patterns, skill structure, and CLI/ plugin mechanics
2. **Adapt the orchestration core** — keep the multi-agent patterns (autopilot, team, ask) but rewire the execution layer for UiPath
3. **Bridge uipathcli + skills** — expose `uip` commands and skill invocations as first-class tools within the orchestration
4. **Surface as a Claude Code plugin** — matching OMC's plugin model so it works as drop-in for Claude Code + UiPath users

## Project Status

🚧 **Phase 0 — Research & Reverse Engineering** (current)

## License

MIT
