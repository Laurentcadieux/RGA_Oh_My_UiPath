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

## Phase 2 — UiPath-Specific Features

- [ ] UiPath project discovery agent (detect .xaml, .cs, .uipx, agent.json)
- [ ] Solution lifecycle integration (init/pack/publish/deploy/activate)
- [ ] UiPath-aware lookout (scan for dangerous Orchestrator changes, credential exposure)
- [ ] Deep interview adapter for UiPath automation design

## Phase 3 — Plugin & Distribution

- [ ] Package as Claude Code plugin
- [ ] Setup/install command (`/omu-setup` or `omc-uipath setup`)
- [ ] Documentation and examples
- [ ] CI/CD for skill updates

## Open Questions

- Should this be a **fork/adaptation** of OMC or a **new project** that mirrors its patterns?
- How to handle OMC's tmux dependency for team orchestration on Windows?
- Should uipath skills be **bundled** or **referenced** (lazy-loaded via `uip skills install`)?
- Integration with `@uipath/cli` (Coding Agents CLI) vs `uipathcli` (Platform CLI) — both?
