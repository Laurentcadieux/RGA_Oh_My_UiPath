# Project Plan

## Phase 0 — Research & Reverse Engineering ✅

- [x] Clone and explore oh-my-claudecode source structure
- [x] Use REA to reverse-engineer OMC's orchestration patterns
- [x] Document OMC's architecture in `docs/omc-architecture.md`
- [x] Catalog uipath/skills structure and SKILL.md patterns
- [x] Catalog uipathcli command surface and auth flows

## Phase 1 — Core Orchestration Adapter ✅

- [x] Define the plugin/skill registration contract for UiPath
- [x] Build the orchestration adapter that maps OMC patterns to UiPath context
  - [x] UiPath-aware autopilot stages (ralplan, execution, ralph, qa)
  - [x] Team orchestration with UiPath skill sub-agents
  - [x] Ask provider with uipathcli as a provider
- [x] Wire uipathcli commands as first-class tools (`src/uipathcli/index.ts`)
- [x] Wire uipath/skills as sub-agent invocations (`src/skills/sub-agent.ts`)
- [x] CLI surface: setup, ask, uip, autopilot, ralph, team, lookout, config
- [x] Production SKILL.md files for all 6 omu skills
- [x] Plugin wiring (`.claude-plugin/plugin.json`)

## Phase 2 — UiPath-Specific Features ✅

- [x] UiPath project discovery agent (detect .xaml, .cs, .uipx, agent.json)
- [x] Solution lifecycle integration (init/pack/publish/deploy/activate)
- [x] UiPath-aware lookout (scan for dangerous Orchestrator changes, credential exposure)
- [x] Deep interview adapter for UiPath automation design

## Phase 3 — Plugin & Distribution ✅

- [x] Package as Claude Code plugin (hooks, config schema)
- [x] Setup/install command (`bin/omu-setup.js`)
- [x] Documentation and examples (README.md)
- [x] CI/CD for skill updates (`.github/workflows/ci.yml`)

## Open Questions (Resolved)

- **Fork vs new project?** → New project mirroring OMC patterns. Cleaner ownership, no upstream sync burden.
- **tmux on Windows?** → Phase 1 team orchestrator supports both tmux (Unix) and in-session native workers (cross-platform). Windows users use native mode.
- **Bundled vs lazy-loaded skills?** → Lazy-loaded via `uip skills install`. The registry probes `~/.agents/skills` at runtime. Bundled only the 6 omu-* meta-skills.
- **@uipath/cli vs uipathcli?** → Both. `src/uipathcli/` wraps the Platform CLI (`uip`). Coding Agents CLI (`@uipath/cli`) is invoked via the coded-agent skill when `agent.json` is detected.
