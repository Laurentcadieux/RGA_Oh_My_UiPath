---
name: omu-setup
description: Install oh-my-UiPath skills and configure Claude Code + UiPath integration
argument-hint: "[--skip-uipath]"
---

# Setup — Install & Configure

Install oh-my-UiPath and configure it for Claude Code + UiPath.

## Steps

1. **Check UiPath CLI** — verify `uip` is installed and accessible
   - If missing: guide user to `curl -fsSL https://download.uipath.com/uipath-cli/install.sh | bash`
2. **Install UiPath skills** — run `uip skills install` to wire skills into Claude Code
   - This adds all 31 UiPath skills as Claude Code plugin skills
3. **Configure auth** — ensure UiPath CLI is authenticated (`uip config`)
4. **Write project config** — create `.omu/config.jsonc` with UiPath profile settings
5. **Install oh-my-UiPath skills** — copy bundled skills to `.claude/skills/`
6. **Restart** — prompt user to restart Claude Code

## UiPath Skills Installed

When `uip skills install` runs, it adds skills for all 31 UiPath skill areas including:
- **uipath-rpa** — .xaml/.cs workflow authoring
- **uipath-agents** — AI agent scaffolding
- **uipath-platform** — Orchestrator operations
- **uipath-admin** — Identity & governance
- **uipath-solution** — .uipx lifecycle
- **uipath-maestro-flow** — Flow authoring
- **uipath-test** — Test management

## What This Plugin Adds On Top

On top of the individual UiPath skills, oh-my-UiPath adds orchestration:
- **omu-autopilot** — Multi-stage pipeline (ralplan → execution → ralph → qa)
- **omu-team** — Multi-agent team with UiPath skill workers
- **omu-ralph** — Autonomous PRD-driven refinement loop
- **omu-ask** — Provider routing including uipathcli as a provider
- **omu-lookout** — Pre-flight danger scan with UiPath-specific signals
