# oh-my-UiPath-c

> ⚠️ **Research only.** This project is not production-certified.
>
> - **Not affiliated with UiPath.** This is an independent helper; UiPath names and feeds are referenced only for compatibility.
> - **No warranty.** You use this software at your own risk. The authors are not liable for damage, data loss, compliance issues, or failed restores.
> - **Network and licensing.** Downloads require **outbound HTTPS** to the feeds you use. You are responsible for **license terms** of each package and for **organizational policies** (proxy, firewall, export control, etc.).
> - **Resolution is heuristic.** Version selection uses a **lowest matching version** strategy per dependency edge. It is **not** a full NuGet graph solver; results may differ from Visual Studio or `dotnet restore`.
> - **Authenticated feeds** (private Azure Artifacts with PAT, etc.) are **not** built in; only **anonymous** NuGet v3 sources work unless you extend the code.

---

## Why oh-my-UiPath-c When Upstream Skills Already Exist?

UiPath ships [28 skills](https://github.com/UiPath/skills) that cover product knowledge, PDD→SDD planning, solution lifecycle, review, diagnosis, and project discovery. They also include a permission allowlist that prompts before side effects. So what does **oh-my-UiPath-c** add on top?

**Safety that actually understands your commands.**

The upstream allowlist is coarse-grained — it gates whole commands but doesn't parse *what* the command does or *where* it targets. oh-my-UiPath-c's **Lookout** is command-aware:

- **Tokenizes `uip` commands** into resource + verb + flags, then applies rules. `uip orchestrator queues delete --id 42` is flagged as destructive; "delete the queue after processing" (an English sentence in your design doc) is not. The upstream allowlist cannot make this distinction.
- **Environment-aware policy** — `.omu/lookout.yaml` lets you set allow/ask/deny per environment. Destructive ops on prod → **deny**. Same op on dev → **ask**. Dangerous flags (`--force`, `--yes`) on prod → **deny**. The upstream allowlist is binary: prompt or don't.
- **Secret detection in file writes** — before writing `.xaml`, `.cs`, `.json`, `.env` files, the Lookout scans for hardcoded credentials and suggests the Orchestrator Asset to use instead. Upstream doesn't inspect file content.
- **Preview skill warnings** — if you're about to use a Preview or In-development upstream skill against a prod environment, the Lookout warns you. Upstream has no environment × maturity cross-check.
- **Scope enforcement** — deploying without `--tenant` or `--folder` triggers a finding. The upstream allowlist doesn't check whether you've scoped your deployment.
- **Full audit trail** — every decision is logged to `.omu/lookout-audit.jsonl` with time, tool, command (redacted), findings, and decision. You get a safety history, not just a snapshot.

**Real parallel execution for speed.**

The upstream skills run one at a time. oh-my-UiPath-c's team orchestrator actually spawns workers in parallel and the autopilot pipeline runs independent stages concurrently. When ralplan produces 3 independent tasks, 3 workers execute simultaneously instead of sequentially.

**The principle: don't duplicate upstream — enforce safety around it and accelerate it.** oh-my-UiPath-c calls the real `uip` binary and the real upstream skills. It adds a safety layer that *understands* what you're doing and *refuses* what shouldn't be done, plus parallelism that makes the pipeline fast.

---

Multi-agent orchestration for **UiPath + Claude Code**, adapted from [oh-my-claudecode](https://github.com/anthropics/oh-my-claudecode) patterns.

## What It Does

oh-my-UiPath-c (omu-c) bridges Claude Code's multi-agent orchestration with UiPath's automation platform:

- **Autopilot pipeline** — ralplan → execution → ralph → qa, with UiPath-aware stages
- **Team orchestration** — spawn UiPath skill workers as sub-agents
- **Project discovery** — auto-detect UiPath project type (.xaml, .cs, .uipx, agent.json)
- **Solution lifecycle** — pack → publish → deploy → activate via uipathcli
- **Deep interview** — structured automation design interview → design document
- **Safety lookout** — scan for destructive ops, credential exposure, scope violations

## Quick Start

```bash
# Install
npm install -g oh-my-UiPath-c

# Or from source
git clone <repo> && cd RGA_Oh_My_UiPath
npm install && npm link

# Setup (checks Claude Code, uipathcli, uipath/skills)
omu-c setup

# Discover what kind of UiPath project you're in
omu-c discover

# Design an automation via deep interview
omu-c interview

# Run the lifecycle
omu-c lifecycle promote          # pack → publish → deploy → activate
omu-c lifecycle test-and-promote # test first, then promote if green

# Security scan
omu-c scan                        # scan current project directory
omu-c scan "uip or robots delete" # scan a command string
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `omu-c setup` | Install skills + configure Claude Code / UiPath |
| `omu-c discover [dir]` | Detect UiPath project type, suggest skills |
| `omu-c interview` | Deep interview for automation design |
| `omu-c lifecycle <step>` | Solution lifecycle (init/pack/publish/deploy/activate/promote) |
| `omu-c scan [target]` | UiPath-aware security + safety scan |
| `omu-c autopilot <task>` | Run full autopilot pipeline |
| `omu-c ask <provider> <prompt>` | Route question to a provider |
| `omu-c uip <args>` | Proxy uipathcli commands |
| `omu-c team <workers> [task]` | Multi-agent team orchestration |
| `omu-c lookout [brief]` | Pre-flight danger scan |
| `omu-c ralph <task>` | Autonomous coding loop |
| `omu-c config` | Show merged configuration |
| `omu-c version` | Print version |

## Skills (Claude Code Slash Commands)

| Skill | Slash Command | Description |
|-------|--------------|-------------|
| omu-setup | `/omu-setup` | Install and configure oh-my-UiPath-c |
| omu-autopilot | `/omu-autopilot` | Run the full UiPath-aware autopilot pipeline |
| omu-team | `/omu-team` | Multi-agent team with UiPath skill workers |
| omu-ask | `/omu-ask` | Route questions to providers (incl. uipath) |
| omu-ralph | `/omu-ralph` | Autonomous coding loop |
| omu-lookout | `/omu-lookout` | Pre-flight safety scan |

## Project Types Detected

omu-c discovers your UiPath project type and routes to the right skill:

| Type | Signal Files | Skill |
|------|-------------|-------|
| classic-rpa | `.xaml` | uipath-rpa |
| coded-automation | `.cs` (no agent.json) | uipath-coded-apps |
| coded-agent | `agent.json` + `.cs` | uipath-agents |
| cross-platform | `.uipx` | uipath-rpa |
| library | `.packages` | uipath-rpa |
| test-automation | Test Framework deps | uipath-test |
| data-service | Data Manager patterns | uipath-platform |
| maestro | Maestro BPMN/Case | uipath-maestro-flow |

## Architecture

```
src/
├── cli/              # CLI entry point (commander)
├── pipeline/         # Autopilot pipeline adapter + stages
│   ├── adapter.ts    # Pipeline runner + validation
│   └── stages/       # ralplan, execution, ralph, qa
├── team/             # Team orchestrator (sub-agent workers)
├── ask/              # Ask router + providers (claude, codex, uipath)
├── skills/           # Skill registry, frontmatter parser, sub-agent dispatcher
├── discovery/        # UiPath project type detection
├── lifecycle/        # Solution lifecycle (pack/publish/deploy/activate)
├── lookout/          # Base lookout + UiPath-aware danger scanner
├── interview/        # Deep interview for automation design
├── config/           # Config loader
├── uipathcli/        # Typed wrapper around `uip` CLI
└── hooks/            # Claude Code plugin hooks (pre/post-tool-use, notification)

skills/               # SKILL.md files for Claude Code
commands/             # Slash command markdown
docs/                 # Architecture docs, catalogs
```

## Plugin Hooks

When installed as a Claude Code plugin, omu-c provides:

- **pre-tool-use** — scans write/execute operations for dangerous UiPath commands, blocks or advises
- **post-tool-use** — re-discovers project type when UiPath files change
- **notification** — handles skill updates, orchestrator alerts, session-start discovery

## Deep Interview

The interview system walks through 8 categories of automation design:

1. **Process Scope** — name, trigger, volume, boundaries
2. **Data Contract** — inputs, outputs, transformations
3. **Error Handling** — strategy, notification
4. **Orchestrator** — queues, assets, environments
5. **Human-in-the-Loop** — approval steps, exception review
6. **Deployment** — robot type, runtime
7. **Testing** — strategy
8. **Security** — compliance, PII handling

For **coded-agent** projects, 4 additional questions cover agent-specific concerns (triggers, tools, memory, guardrails).

Completed interviews generate a **design document** and **autopilot pipeline input** (task + context + suggested skills).

## Safety Scanning

omu-c scans for:

- **Destructive operations** — delete robot/queue/process/folder, unpublish, purge
- **Production flags** — --force, --skip-confirmation, --yes
- **Secret exposure** — hardcoded passwords, API keys, tokens, AWS/GitHub keys
- **Scope violations** — prod without folder, deploy without tenant
- **Stale dependencies** — pre-release versions, outdated major versions

## License

MIT
