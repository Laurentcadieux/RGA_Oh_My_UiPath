---
name: omu-team
description: Multi-agent team orchestration with UiPath skill workers
argument-hint: "N:agent-type [task]"
---

# Team — UiPath Skill Worker Orchestration

Coordinate multiple agents to work on a task in parallel.

## Usage

```
/omu-team 3:uipath-rpa "Build and test the invoice processing workflow"
/omu-team 2:codex "Review the authentication module"
/omu-team 1:uipath-platform 2:uipath-rpa "Deploy to staging and run smoke tests"
```

## Worker Types

### Native (in-session)
- Spawned via Claude Code Task tool
- Share the session context
- Best for: code review, analysis, planning

### CLI (external)
- Spawned as `uip` CLI processes
- File-based mailboxes (`.omu/state/team/{name}/workers/{id}/inbox.md`, `outbox.md`)
- Best for: long-running builds, `uip rpa build`, `uip solution pack`

### UiPath Skill Workers
- Each worker is a `uip` skill invocation (e.g. `uip rpa`, `uip codedagent`)
- Workers auto-detect available skills on startup
- Task assignment writes to worker's inbox; results appear in outbox
- Heartbeat-based health monitoring with dead-worker recovery

## Coordination

- **Allocation policy**: tasks assigned to workers by skill match and availability
- **Merge coordinator**: worktree merges when workers touch different files
- **Phase routing**: stage → agent-type mapping (ralplan→architect, execution→executor, qa→critic)
- **Recovery**: dead workers detected by heartbeat timeout; tasks reassigned

## State

Team state lives at `.omu/state/team/{name}/`:
- `config.json` — team configuration (revisioned)
- `workers/{id}/status.json` — worker state
- `workers/{id}/inbox.md` / `outbox.md` — file-based mailboxes
- `tasks/{taskId}.json` — task assignments
- `shutdown.json` — shutdown marker
