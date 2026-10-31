---
name: omu-ralph
description: UiPath-aware autonomous coding loop with PRD-driven verification
argument-hint: "<task>"
---

# Ralph — UiPath Autonomous Refinement

PRD-driven iteration loop: implement until every acceptance criterion passes verification.

## The Loop

1. **PRD Setup** — auto-scaffold acceptance criteria from the task
   - Refine generic criteria into task-specific, testable ones
   - Order stories by risk class (architectural > integration > spike > standard; polish last)
2. **Feedback baseline** — run verification on current tree, fingerprint failures
   - Baseline failures = environment noise (never "fixed" mid-run)
   - `omc ralph verify --write-baseline --session <id>`
3. **Per story**: implement → verify → mark passes
   - Tiered executor delegation (parallel where independent)
   - `omc ralph verify --session <id>` exit code 0/1 is the gate (never hand-roll)
4. **Reviewer verification** — tiered review
   - STANDARD: sonnet floor / THOROUGH: opus for >20 files or security
   - Codex pass: acceptance criteria + optimality question + related-files review
5. **Deslop** — run ai-slop-cleaner on changed files (mandatory, skip only with `--no-deslop`)
6. **Regression re-verify** — full build + test cycle after deslop until exit 0
7. **Closeout** — append ≤3 factual lines to `.omu/notepads/ralph/problems.md`, then `/cancel`

## UiPath Verification Commands

| Skill | Verify Command |
|-------|---------------|
| uipath-rpa | `uip rpa build && uip rpa test` |
| uipath-agents | `uip codedagent eval` |
| uipath-solution | `uip solution pack && uip solution publish` |
| uipath-maestro-flow | `uip maestro flow validate` |
| uipath-coded-apps | `uip codedapp build` |
| uipath-api-workflow | `uip api-workflow run` |
| General | `npm test` or `dotnet test` |

## AFK Mode

```
omu ralph afk "Build the invoice workflow" --verify "uip rpa build && uip rpa test"
```

Spawns an isolated headless Claude session with scoped allowlist — exactly the declared verify commands, no general Bash.

## State

`ralph-state.json` at `.omu/state/` (session-scoped): `active`, `iteration`, `max_iterations`, `prd_mode`, `current_story_id`, `critic_mode`.
Cancel with `/cancel`. Three-strike halt drafts an incident work item.
