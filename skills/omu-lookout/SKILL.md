---
name: omu-lookout
description: Pre-flight danger scan with UiPath-aware signal detection
argument-hint: "[--brief <text>]"
---

# Lookout — Pre-Flight Danger Scan

Advisory-only scan of a task brief and workspace before unattended execution.

## Signals Detected

### Standard (from OMC)
- 🚨 Force operations (`rm -rf`, `git push --force`)
- 🚨 Database destructive (`DROP TABLE`, `DELETE FROM`, `TRUNCATE`)
- ⚠️ Protected branch pushes
- ⚠️ CI/CD changes
- ⚠️ Deployment changes

### UiPath-Specific
- 🚨 Orchestrator destructive operations (`uip or queues delete`, `uip or robots delete`, `uip or jobs stop`)
- 🚨 Tenant-wide admin operations (`uip admin ... delete`)
- ⚠️ Solution deactivation (`uip solution deactivate`)
- ⚠️ Credential/secret references (`UIPATH_PAT`, `clientSecret`, `--secret`, `--password`)
- ⚠️ Asset deletion (`uip or assets delete`)
- ⚠️ Machine deletion (`uip or machines delete`)

## Design Principles

- **Advisory only** — never blocks, never mutates; no skip-file backdoor
- **High-confidence signals only** — mechanically checkable, regex-anchored, no bare substring matches
- **Prefer misses over false positives** — the cries-wolf failure mode is worse than a missed warning
- **Silence is a feature-level decision** — disable the whole feature, not individual rules

## Report Shape

```json
{
  "scannedAt": "2026-10-31T15:00:00Z",
  "briefSource": "...",
  "findings": [
    {
      "id": "lookout.brief.uipath-destructive",
      "title": "UiPath destructive operation",
      "severity": "high",
      "confidence": "high",
      "actionable": true,
      "evidence": ["uip or queues delete"],
      "advice": "Run with --dry-run first, or use checkpointing."
    }
  ],
  "summary": {
    "counts": { "high": 1, "medium": 0, "low": 0, "info": 0 },
    "verdict": "review-recommended"
  }
}
```

Verdicts: `clear` (0 findings) → `advisory` (medium only) → `review-recommended` (any high).

## Usage

```
omu lookout --brief "uip or queues delete --id 42"
omu lookout --brief "Build and deploy the workflow" --json
```

Pairs with: `omu autopilot` (auto-runs lookout before execution), `omu ralph afk` (lookout gates unattended runs).
