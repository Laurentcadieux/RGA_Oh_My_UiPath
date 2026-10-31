---
name: omu-autopilot
description: UiPath-aware multi-stage autopilot for building, testing, and deploying UiPath automations
argument-hint: "<task>"
pipeline: [ralplan, execution, ralph, qa]
---

# Autopilot — UiPath Multi-Stage Pipeline

Execute a task through the full autopilot pipeline with UiPath awareness.

## Stages

### 1. Ralplan (Planning)
- Explore the UiPath project structure
- Identify .xaml, .cs, .uipx, agent.json, .flow, .bpmn files
- Decompose the task and assign UiPath skills per step
- Write consensus plan to `.omu/plans/ralplan-plan.md`
- **Artifact shortcut**: existing ralplan plan or deep-interview spec skips this stage

### 2. Execution (Implementation)
- Execute each plan step using the assigned UiPath skills
- **Solo mode**: implement sequentially in the lead session
- **Team mode**: spawn workers for parallel implementation (`omu team N:uipath-rpa "task"`)
- Verify each step with build/test commands
- Route to the correct `uip` subcommand per skill:

| Skill | Commands |
|-------|----------|
| uipath-rpa | `uip rpa build/pack/run/test` |
| uipath-agents | `uip codedagent eval` |
| uipath-platform | `uip or` |
| uipath-solution | `uip solution init/pack/publish/deploy/activate` |
| uipath-maestro-flow | `uip maestro flow` |
| uipath-test | `uip tm` |

### 3. Ralph (Refinement)
- Review execution output for quality issues
- PRD-driven iteration with `uip` verification exit-code gates
- Risk-ordered: architectural > integration > spike > standard
- Deslop pass on changed files
- Regression re-verify after deslop

### 4. QA (Validation)
- Run full test suites across all touched UiPath projects
- Structural review via uipath-review
- Security review (hardcoded creds, exposed secrets)
- UiPath-specific: package integrity, dependency resolution, robot compatibility
- Max 5 QA cycles with 3-strike stop per issue

## Named Workflows

```
omu autopilot "task" --workflow quick    # ralplan → execution
omu autopilot "task" --workflow verify   # ralplan → execution → qa
omu autopilot "task" --workflow full     # ralplan → execution → ralph → qa (default)
```

## State

Pipeline state lives at `.omu/state/autopilot-state.json` (session-scoped under `.omu/state/sessions/{id}/`).
Resume by re-invoking `/omu-autopilot`. Cancel with `/cancel`.

## Budget

`OMU_RUN_BUDGET_TOKENS` — 90% → finish current stage; 100% → stop with resumable state.
