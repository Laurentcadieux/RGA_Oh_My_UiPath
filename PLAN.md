# Project Plan

## Phase 0 — Research & Reverse Engineering

- [ ] Clone and explore oh-my-claudecode source structure
- [ ] Use REA to reverse-engineer OMC's orchestration patterns:
  - [ ] Skill/plugin registration mechanism
  - [ ] Autopilot stage pipeline (ralplan → execution → ralph/qa)
  - [ ] Team orchestration (tmux workers + in-session native)
  - [ ] Ask provider routing
  - [ ] Ralph autonomous agent loop
  - [ ] Deep interview workflow
  - [ ] Lookout danger scan
  - [ ] CLI vs in-session skill surface mapping
- [ ] Document OMC's architecture in `docs/omc-architecture.md`
- [ ] Catalog uipath/skills structure and SKILL.md patterns
- [ ] Catalog uipathcli command surface and auth flows

## Phase 1 — Core Orchestration Adapter

- [ ] Define the plugin/skill registration contract for UiPath
- [ ] Build the orchestration adapter that maps OMC patterns to UiPath context:
  - [ ] UiPath-aware autopilot stages
  - [ ] Team orchestration with UiPath skill sub-agents
  - [ ] Ask provider with uipathcli as a provider
- [ ] Wire uipathcli commands as first-class tools
- [ ] Wire uipath/skills as sub-agent invocations

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
