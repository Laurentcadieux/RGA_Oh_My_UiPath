# UiPath Agent Skills — Repository Catalog

> Source: `RGA_Oh_My_UiPath/research/uipath-skills` (mirror of [github.com/UiPath/skills](https://github.com/UiPath/skills))
> Plugin version at time of cataloging: **1.206.0** (`skillsVersion` in `version-manifest.json`; CLI target `^1.206.0`)
> Cataloged: 2026-10-31 · 31 skills

## 1. Repository Overview

The repo ships **self-contained AI agent skills** that teach coding agents (Claude Code, Cursor, Codex, Copilot, and others) to build, run, test, and deploy UiPath automations and agents. Key top-level structure:

| Path | Purpose |
|------|---------|
| `skills/uipath-<name>/` | The 31 canonical skills (each with `SKILL.md`, `references/`, sometimes `assets/`, `scripts/`, `examples/`) |
| `assets/skill-status.json` | Lifecycle maturity per skill — single source of truth (§4) |
| `skills.sh.json` | Display grouping for the skills.sh catalog page (§4) |
| `.claude-plugin/` | Claude Code plugin + marketplace manifests (§5) |
| `hooks/` | Claude Code session hooks: `hooks.json` + Node `.mjs` scripts (§5.3) |
| `commands/install-permissions.md` | `/uipath:install-permissions` slash command (§5.4) |
| `.claude/` | Repo-maintenance rules, maintainer slash commands, `manage-skill-flavors` meta-skill |
| `CLAUDE.md` | Claude Code project rules (symlinked to `AGENTS.md` for Codex) |
| `skill-flavors/studioweb/` | Sparse per-flavor overrides for Studio Web environments (§6) |
| `preview/skills/` | Preview copies of in-development Maestro skills |
| `scripts/` | Build/validation tooling (`check-skill-status.py`, `check-skills-sh.py`, `compose-skill-flavor.mjs`, release gate, etc.) |
| `version-manifest.json` | `skillsVersion` + minimum `targetCli` for update coordination |
| `gemini-extension.json`, `.cursor-plugin/`, `.cursor/rules/`, `.agents/` | Multi-agent install targets (symlinks to `skills/` and `CLAUDE.md`/`AGENTS.md`) |

**Architecture rules** (from `CLAUDE.md`): skills are self-contained — a skill MUST NOT import, inline, or read another skill's files, but MAY **delegate at runtime** to a sibling skill (e.g. spawn a subagent handing an artifact to its owning skill) *provided the delegation degrades gracefully*. All cross-skill "dependencies" listed below are therefore **routing/delegation contracts**, not file imports.

---

## 2. Quick-Reference Table

| Skill | Status | Key Commands | Dependencies (routes to / from) | Description |
|-------|--------|--------------|----------------------------------|-------------|
| uipath-activity-migrator | In-development | `UiPath.Upgrade.exe`, `uip rpa build` (verify), SARIF triage | rpa, review, troubleshoot | Migrate Windows-Legacy RPA projects to Windows framework; rewrite classic activities to modern counterparts (Windows only) |
| uipath-admin | Stable | `uip admin` (identity, authorization, oms, ip, audit) | platform, rpa | Identity Server, custom roles, PDP/effective access, OMS org/tenant ops, IP restriction, audit logs & exclusion rules |
| uipath-agents | Stable | `uip codedagent`, `uip agent`, `uip eval`, `uip context-grounding` | functions, platform | End-to-end agent lifecycle: coded (LangGraph/LlamaIndex/OpenAI Agents) and low-code (`agent.json`); scaffold, run, eval, deploy, guardrails, memory |
| uipath-aops | Preview | `uip aops connection/repo/project/solution/pipeline/execution` | governance, platform, rpa | StudioAdmin AOps: source-control discovery + CI/CD pipeline create/save-and-run/log-follow |
| uipath-api-workflow | Stable | `uip api-workflow` (run, registry, pack, publish), evals | agents, coded-apps, maestro-flow, platform, rpa, troubleshoot | JSON-DSL API workflows: author Sequence/If/ForEach/TryCatch activities, HTTP & IS connector activities, TDD with eval sets |
| uipath-automationhub | Stable | `uip ah` (CLI-first) or AH Open API | (none) | Publish/read Automation Hub business processes + PDD/SDD docs via user cloud login (never admin OpenAPI token) |
| uipath-coded-apps | Stable | `uip codedapp` (scaffold/build/pack/publish/deploy/push/pull) | agents, functions, maestro-flow, rpa, solution | React/TS Coded Web & Action Apps with `@uipath/uipath-typescript` SDK; also generates Insights-backed analytics dashboards |
| uipath-connector-builder | In-development | `uip is connectors builder` (init, auth set, inspect, validate) | maestro-flow, platform | Integration Service connector authoring (REST+JSON): `element.json`, 19 auth types, activities, polling/webhook triggers |
| uipath-feedback | Stable | `uip feedback send` | troubleshoot | File bug reports / improvement suggestions for UiPath products, CLI, or skills |
| uipath-functions | Preview | `uip function new/init/serve/run/pack/publish` | agents, coded-apps | Deterministic Python or JS/TS coded functions (Pydantic models, `defineFunction`); invoked from Maestro, agents, Jobs API, HTTP |
| uipath-genome | Preview | No primary CLI — `*-genome.md` blueprints + `scripts/check-genome.py` | planner, review, activity-migrator + owning skills | Portable automation blueprint: extract from a project/solution, author from an idea, execute to build/migrate through owning skills |
| uipath-governance | Preview | `uip gov aops-policy`, `uip gov access-policy` | platform, agents, maestro-flow, rpa | Three governance layers: AOps product policies, Access ToolUsePolicy (workflow-as-tool allow/deny), ISO compliance standards |
| uipath-human-in-the-loop | Stable | `uip maestro` (HITL node authoring, design-time) | maestro-flow/bpmn/case, agents, tasks | Approval gates, escalations, write-back validation forms in Flow/Maestro/Case/coded agents (runtime task ops → uipath-tasks) |
| uipath-insights | Preview | `uip insights` (jobs, queues, machines, alerts, dashboards) | admin, platform, rpa, troubleshoot | Historical monitoring: job metrics & failure analysis, queue SLA, machine availability, alert definitions, Looker dashboards |
| uipath-ixp | Stable | `uip ixp` (projects, documents, taxonomy, predictions, models, deployments) | maestro-flow | Document Understanding: taxonomy authoring, prediction review, model publish/rollback, Orchestrator folder deployment |
| uipath-knowledge-bundles | Preview | `uip or kb` (download, read, publish, change-proposal) — prerelease CLI only | platform, solution | Versioned OKF markdown doc sets in Orchestrator folders that agents read as context; reviewed change-proposal publishing flow |
| uipath-maestro-bpmn | In-development | `uip maestro` (BPMN validate/package/operate) + `validator/` | maestro-flow, maestro-case, rpa, solution, agents, api-workflow | BPMN `.bpmn` process orchestration: registry-driven XML authoring, validation, packaging, operation, diagnosis |
| uipath-maestro-case | Preview | `uip maestro` (case ops, 27 mentions), `caseplan.case` authoring | planner, maestro-flow/bpmn, rpa, rules, agents, api-workflow | Case Management build from SDD: tenant resource resolution then direct caseplan authoring with phased build/validation |
| uipath-maestro-flow | Stable | `uip maestro` (flow) + `@uipath/maestro-builder-sdk` | ixp, agents, rpa, maestro-bpmn, maestro-case | `.flow`/`.flow.ts` authoring: nodes, triggers, schedules, connectors, IXP nodes, inline agents, HITL, evals; run/debug/publish/diagnose |
| uipath-mcp-servers | Preview | `uip agenthub mcp` / `uip agenthub mcp-tools` (30 mentions) | agents, platform | Agent Gateway MCP server registry: uipath/coded/command/remote/swagger/platform server types, connection checks, MCP URLs |
| uipath-planner | Stable | No primary CLI — PDD→SDD authoring + `TaskCreate` task derivation | routes to nearly all skills | Solution planner: PDD (or Confluence/SOP/BPMN/transcript) → SDD → executable multi-skill task list; sole case-SDD author |
| uipath-platform | Stable | `uip or` (Orchestrator), `uip df` (Data Fabric), `uip is`, `uip traces`, `uip login`, `uip skills` | admin, insights, troubleshoot, solution, planner, rpa, maestro-*, agents, test | Platform ops hub: auth, folders, assets, queues, jobs, IS connections, Data Fabric entities/records, BYO LLM/guardrail, traces, licensing, CLI bootstrap |
| uipath-process-mining | Preview | `uip pm` (templates, data-mapping, ingest, apps model) | platform, maestro-flow, ixp, admin | Process Mining app lifecycle from CSV/event log: dbt/Snowflake transforms, data-mapping fixes, field/data-kind model edits |
| uipath-review | Preview | Read-only — reuses other skills' commands | domain skills (audit only, never edits) | Structural/quality/best-practice review across .xaml/.cs, agents, .flow, .bpmn, coded apps, .uipx |
| uipath-rpa | Stable | `uip rpa` (24 mentions: build, pack, run, test, `uia` via package docs) | platform, solution, agents, maestro-flow, test, feedback | Core RPA: coded `.cs` + `.xaml` workflows, Object Repository selectors, live UI exploration, test authoring, IS activity calls |
| uipath-rules | In-development | `uip rules init/refresh/validate/debug` | maestro-bpmn, maestro-case, rpa, solution | Business Rules `.dmn` decision tables (DMN 1.5, FEEL) in `project.uiproj` — author from policy/spreadsheet, validate, debug |
| uipath-solution | Stable | `uip solution` (44 mentions: init/pack/publish/deploy/activate/upgrade/resources) | planner, platform, rpa, coded-apps, maestro-*, agents, troubleshoot | `.uipx` solution lifecycle + diagnosis: binding/resource errors, deploy error codes, collisions, feeds, upgrade flows |
| uipath-tasks | Stable | `uip tasks` (list, assign, complete; catalogs, comments, data) | human-in-the-loop, platform, coded-apps | Action Center human-task runtime ops: approve, reassign, task data get/save, labels, metadata |
| uipath-test | Preview | `uip tm` (90 mentions: projects, cases, sets, executions, defects) | platform, rpa | Test Manager: requirements, AI test-case generation, recurring schedules, CI package runs, load tests, Playwright suites, reports |
| uipath-troubleshoot | Preview | Investigation-first; `uip docsai`; other skills' inspection commands | platform, rpa + supplies diagnostics to all | Causal root-cause investigation across every product: faults, hangs, regressions, Assistant desktop logs (combined.log/Robot.log) |
| uipath-vertical-solutions | Preview | `uip vss deploy` (+ seed, status/resume/cancel) | solution, platform, admin, troubleshoot | Guided deploy of industry packages (FINS Loan Setup, Lending QA/QC): install/upgrade, Data Fabric seeding, role setup, access checks |

---

## 3. Per-Skill Detail

Each entry: maturity (from `assets/skill-status.json`), capability summary (from `SKILL.md` frontmatter + body), command surface, inter-skill routing, and notable files.

### 3.1 Authoring

**uipath-rpa — Stable** (707 files — the largest skill)
- Capabilities: create/edit/validate/build/pack/run/debug `.xaml` and coded `.cs` workflows (Modern or Legacy); UI automation with Object Repository selectors; live desktop/browser UI exploration; test-case authoring; Integration Service connector calls. Owns packing; routes `.uipx` deployment → solution.
- Commands: `uip rpa` (build, pack, run, test, ...); `uip rpa uia` subcommands are deliberately **not** encoded in the skill (see its `CLAUDE.md` boundary, §5.5) — they live in UIA package docs under `{PROJECT_DIR}/.local/docs/packages/UiPath.UIAutomation.Activities/`.
- Files: `agents/uipath-project-discovery-agent.md` (registered in plugin.json), `assets/` templates, `CLAUDE.md`, extensive `references/`.
- Routes to: platform, solution, agents, maestro-flow, test, feedback. **Always invoke for `.xaml`/`.cs`.**

**uipath-maestro-flow — Stable** (84 files)
- Capabilities: `.flow` / `.flow.ts` authoring via `@uipath/maestro-builder-sdk` (nodes, triggers, schedules, connectors, IXP document-extraction nodes, inline agents, HITL, chat/voice flows, bindings, brownfield edits); check/compile/validate loop; upload/publish/deploy; debug real runs; fault/incident diagnosis; eval sets & simulations.
- Commands: `uip maestro` (+ `uip solution`, `uip login`).
- Routes to: maestro-case (`caseplan.*`), maestro-bpmn (`.bpmn`), ixp (raw labeling), agents, rpa.

**uipath-agents — Stable** (85 files)
- Capabilities: full agent lifecycle — auth, design, scaffold, Studio Web sync, flow integration, editing, pack/deploy/version bump, eval, debug, tracing, guardrails, memory spaces, bindings, attachments. Covers coded agents (Python: LangGraph, LlamaIndex, OpenAI Agents) and low-code (`agent.json` / Agent Builder).
- Commands: `uip codedagent`, `uip agent`, `uip eval`, `uip context-grounding`, `uip solution`.
- Routes to: functions (deterministic coded functions — no agent runtime/LLM).

**uipath-maestro-bpmn — In-development** (26 files, own `validator/`)
- Capabilities: registry-driven `.bpmn` authoring, validation, packaging, operation, diagnosis for Maestro Process Orchestration.
- Commands: `uip maestro`, `uip is`, `uip solution`.

**uipath-maestro-case — Preview** (78 files)
- Capabilities: Case Management build from SDD — resolves tenant resources, then authors `caseplan.case`/`caseplan.json` directly (Write/Edit) with phased build and one-review confirmation. Sole case-SDD author is uipath-planner.
- Commands: `uip maestro` (heaviest solution interplay: `uip solution` ×10).
- Routes to: planner (SDD design), rpa, maestro-flow, maestro-bpmn, rules, agents, api-workflow.

**uipath-coded-apps — Stable** (56 files)
- Capabilities: scaffold/build/run/deploy Coded Web Apps and Coded Action Apps (React/TypeScript + `@uipath/uipath-typescript` SDK, OAuth-PKCE, push/pull to Studio Web); generate live analytics/governance dashboards from plain language via the Insights real-time API.
- Commands: `uip codedapp` (24 mentions — heaviest CLI surface after solution/tm), `uip or`, `uip login`, `uip solution`, `uip function`, `uip df`.

**uipath-api-workflow — Stable** (22 files)
- Capabilities: JSON-DSL API workflows (`Workflow.json`, project type "Api"): Sequence, Assign, JavaScript, If (`#Wrapper`/`#Then`/`#Else`), ForEach, DoWhile, Break, TryCatch, Wait, Response; file handling via `$helpers.file.*`/`serializeData()`/`--input-file`; HTTP & IS connector activities via registry; TDD with `evals/<scope>/eval-sets/`.
- Commands: `uip api-workflow` (run, registry, pack, publish), `uip is`.

**uipath-human-in-the-loop — Stable** (7 files)
- Capabilities: design-time HITL node authoring — approval gates, escalations, write-back validation, data-enrichment checkpoints in Flow, Maestro, Case Management, and coded agents; guided decision experience capturing reviewer corrections. Runtime task management → uipath-tasks.
- Commands: `uip maestro`, `uip agent`, `uip solution`.

**uipath-ixp — Stable** (6 files)
- Capabilities: Document Understanding via `uip ixp`: project creation (autopilot taxonomy suggestion / import / empty), document upload, taxonomy authoring with extraction instructions, prediction review/confirm, metrics & model versions, publish/tag/rollback, Orchestrator folder deployment (`deployments create/upgrade/list`).
- Boundary: discovering/listing IXP models for Maestro Flow and wiring IXP nodes belongs to **uipath-maestro-flow**, even when it sounds like IXP.

**uipath-connector-builder — In-development** (11 files)
- Capabilities: IS connector authoring on disk via `uip is connectors builder`: init shell, 19 auth types (`auth set`, incl. jwtOauth claims), activities with fields/params/methods/hooks, polling/webhook triggers, auth-system resources, validate, surgical file read/write via state. Import + publish on parent `uip is connectors`. Operating a published connector → uipath-platform.

**uipath-functions — Preview** (12 files)
- Capabilities: deterministic coded functions — Python (Pydantic Input/Output, lazy `UiPath()` SDK singleton) or JS/TS (`defineFunction` + `defineSchema<T>()`, `FunctionError`); invoked as Maestro Service Tasks, from agents, `POST /Jobs/StartJobs`, or HTTP. No LLM/agentic loop (→ uipath-agents).
- Commands: `uip function new -l py|ts|js`, `init`, `serve`, `run`, `pack`, `publish`.

**uipath-rules — In-development** (2 files — thinnest skill)
- Capabilities: `.dmn` business-rule decision tables (DMN 1.5, FEEL) in a `project.uiproj` BusinessRules project — author from policy/spreadsheet/description, review, validate, debug; list deployed rules.
- Commands: `uip rules init/refresh/validate/debug`.

**uipath-activity-migrator — In-development** (14 files)
- Capabilities: migrate Windows-Legacy projects (`targetFramework: Legacy`) to Windows framework with standalone `UiPath.Upgrade.exe` (Windows only): acquires tool, resolves target UIA line, runs analyze→upgrade into sibling folder, verifies with `uip rpa build`, triages SARIF. Covers classic→modern rewrites (UIA, Outlook→M365, GSuite, Microsoft.Activities.Extensions→Invoke Code) and post-migration expression-selector fixes. Third-party/custom packages only version-moved.
- Boundary: Maestro `instance migrate` → the Maestro skills; readiness review without running the tool → uipath-review.

### 3.2 Solution & Planning

**uipath-planner — Stable** (30 files)
- Capabilities: **always invoke for PDD/SDD files** (`pdd.md`, `*-sdd.md`); authors an SDD from a PDD or another process-knowledge source (Confluence, SOP, BPMN, meeting transcript), then derives a multi-skill/multi-project task list emitting live `TaskCreate` calls. Sole author of case SDDs. Ambiguous "what should I build" requests land here.
- Commands: no primary product CLI; uses `uip login`, `uip is` for discovery. Frontmatter allows `EnterPlanMode`/`ExitPlanMode`/`TaskCreate`/`TaskUpdate`/`TaskList`.
- Routes to: essentially every build skill (rpa, maestro-flow/bpmn/case, agents, solution, functions, coded-apps, connector-builder, human-in-the-loop, ixp, mcp-servers, rules, api-workflow, platform).

**uipath-solution — Stable** (12 files)
- Capabilities: `.uipx` lifecycle — `uip solution` init/download/restore/pack/publish/deploy/activate/upgrade/upload, projects add|import|remove, resources refresh|add|remove|edit, feeds list, `--feed`/`--personal-workspace`. Diagnosis: stale/missing bindings, unimported resources, deploy error codes (e.g. `[1009] Invalid argument Value`), name+version/processKey collisions, `deploy upgrade`, `--acknowledge-permanent-deletion` consent. Bundles RPA/Flow/Case/Agents/API-Workflow/AppV2 projects.
- Always invoke for `.uipx` files; runtime faulted **jobs** → uipath-troubleshoot.

**uipath-review — Preview** (25 files, read-only)
- Capabilities: audit structure, quality, and best practices across RPA (`.xaml`/`.cs`), agents, flows, BPMN, coded apps, solutions. **Does not edit files.** Building/editing → domain skills.

**uipath-genome — Preview** (40 files, includes `CLAUDE.md`, `scripts/check-genome.py`)
- Capabilities: portable markdown automation blueprints (`*-genome.md`, marker `<!-- UIPATH-AUTOMATION-GENOME`). EXTRACT a genome from a project/solution (`.xaml`/`.cs`, `.flow`, `.bpmn`, `agent.json`, `Workflow.json`, `caseplan.*`, `.uipx`) or another framework's export; AUTHOR from a described idea; EXECUTE to build/migrate through the owning skills. Always invoked **before** any skill it names. Covers transactional-shape analysis, source-defect markers/verification, Source Map traceability.
- No product CLI; ships its own Python validation script.

### 3.3 Platform & Operations

**uipath-platform — Stable** (59 files — the platform hub)
- Capabilities: any task hitting UiPath Cloud / Orchestrator / Studio Web / IS / Data Fabric / LLM Gateway; load before writing code that calls a UiPath API. Auth, folders, assets, queues, storage buckets, libraries, webhooks, triggers, processes, jobs, machines, users, roles, sessions, calendars; IS connectors/connections/activities; Data Fabric entities/records/files/choice-sets (incl. federated/virtual/zero-copy); BYO LLM + BYO guardrail (BYOG); context grounding; traces (spans + feedback/annotation); licensing. Also owns **CLI bootstrap**: "install UiPath CLI", "install UiPath skills", `uip` missing, Node/npm/Python/.NET missing.
- Commands: `uip or`, `uip df`, `uip is`, `uip traces`, `uip login`, `uip skills`.
- `uip mcp serve` (CLI-as-MCP-server) belongs here, not to mcp-servers.

**uipath-admin — Stable** (30 files)
- Capabilities: Identity Server (users, groups, robot accounts, external OAuth2 apps, secrets, PATs, SMTP), Authorization (custom roles, role assignments, permission catalog, `check-access` PDP), OMS (org read/update, tenant lifecycle, service provisioning, regions, async op polling), IP restriction (allowlist, enforcement, bypass, lockout safety), Audit (`uip admin audit`: sources, paginated queries, JSON-folder/CSV export, **exclusion rules**). Owns ALL org/tenant/identity audit — `uip admin audit`, not `uip or audit-logs`.

**uipath-aops — Preview** (6 files)
- Capabilities: StudioAdmin AOps source-control discovery (`aops connection`/`repo`/`project`/`solution`) plus CI/CD pipelines (compose a PipelineDto, `pipeline create`/`save-and-run`, `execution logs --follow`). **Replaces the retired `uip sc` and `uip cicd`.** AOps governance policies → uipath-governance.

**uipath-governance — Preview** (42 files)
- Capabilities: three policy layers via `uip gov`: AOps product policies (block/restrict/enforce Studio/StudioX/Assistant/Robot/AI Trust Layer/Agent Builder features; deploy to user/group/tenant), Access ToolUsePolicy (allow/deny workflow-invokes-workflow-as-tool across Agent→Agent/Maestro/Flow/RPA/API/Case, gated by tag/caller/actor), and ISO 42001/27001 compliance posture checks. Deployment precedence: user > group > tenant.

**uipath-tasks — Stable** (9 files)
- Capabilities: Action Center task runtime — list, assign, complete, reassign; task catalogs, comments, labels, metadata, task data get/save. HITL **node authoring** → uipath-human-in-the-loop. Not for general TaskCreate/TaskUpdate session tracking or DU validation.

**uipath-test — Preview** (14 files)
- Capabilities: Test Manager via `uip tm` (90 command mentions — the heaviest CLI surface): projects, requirements, cases, sets, executions, defects; recurring schedules; AI test-case generation from requirements, requirements evaluation, obsolete-case finding; run every test in an uploaded package from CI; load (performance) test scenarios; persona-tailored reports; package and run external Playwright suites.

**uipath-insights — Preview** (12 files; has a Confluence page_id `90824180832`)
- Capabilities: historical monitoring via `uip insights`: job metrics/failure analysis/process performance, queue totals/SLA risk/retry success, machine availability/fault ranking, filter discovery, alert definition/history/delivery/entitlement, Insights users/roles/groups, Maestro process dashboards, export destinations, Looker dashboard lists/embed URLs. Live records/job start-stop → uipath-platform.

**uipath-mcp-servers — Preview** (4 files)
- Capabilities: Agent Gateway MCP server registry via `uip agenthub mcp` / `mcp-tools`: register/update/refresh-tools/connection-check/list/get/delete servers of types uipath (Orchestrator processes, agents, agentic processes, API workflows as tools), coded (published `uipath-mcp` Python package), command (npx/uvx), remote (HTTP MCP URL, Relay), swagger (OpenAPI), platform (service operations); per-user connections; retrieve the client MCP URL.

**uipath-knowledge-bundles — Preview** (1 file — SKILL.md only)
- Capabilities: `uip or kb` — versioned Open Knowledge Format markdown doc sets living in an Orchestrator folder that agents read as context; download/read a version, publish a directory as version 1, diff local vs published, and publish content changes only through reviewed **change proposals** (`change-proposal`, review comments, merge). **Preview caveat:** commands exist only on a prerelease `uip` build and gated tenants; Step 0 probes availability and a miss means stop, not improvise.

### 3.4 Diagnostics & Feedback

**uipath-troubleshoot — Preview** (457 files — second largest; huge `references/` error encyclopedia)
- Capabilities: causal investigation across every product/runtime/activity package — faults, hangs, regressions, slowdowns, access loss, unexpected state, silent no-ops, raw errors. **Diagnostic intent outranks surface ownership**: invoke even when another skill owns the named resource; it correlates runtime, configuration, history, and source evidence. Also UiPath Assistant desktop failures from shared diagnostic archives (`combined.log`, `Robot.log`). A pasted raw stack with no other request implies this skill.
- Commands: investigation-first; `uip docsai`; reuses inspection commands from other skills.

**uipath-feedback — Stable** (1 file — SKILL.md only)
- Capabilities: `uip feedback send` for bugs and improvement suggestions; also fires on the `/uipath-feedback` slash command. Investigating an error → troubleshoot first.

### 3.5 Industry

**uipath-vertical-solutions — Preview** (5 files)
- Capabilities: guided deploy of industry solution packages via `uip vss deploy` — FINS Loan Setup (`fins.loan-setup`), Lending QA/QC (`fins.qaqc-uipath`): fresh install, upgrade/downgrade, deploy job status/resume/cancel, Data Fabric seeding (`uip vss deploy seed`), post-deploy setup (e.g. FINS role groups), tenant/folder access checks, refused/paused deploy diagnosis.

### 3.6 Business Process Capture

**uipath-automationhub — Stable** (9 files)
- Capabilities: publish/read Automation Hub business processes and their PDD/SDD documents via the Open API using the **user's cloud login** (never the admin `x-ah-openapi-auth` header). Publish approved processes (schema-driven payloads, base64 upload or link), get by id/search, list/download attached documents, change idea flow (idea → Business Process), read/post comments. CLI-first when the installed `uip` has `ah` commands; otherwise raw Open API flows.

---

## 4. Registration, Maturity Tracking, and Registries

### 4.1 Install mechanism — `uip skills install`

The installer lives in the **`@uipath/cli`** (`uip`), not in this repo. Two paths:

1. **Official onboarding installer** (recommended):
   - macOS/Linux: `curl -fsSL https://download.uipath.com/uipath-cli/install.sh | bash`
   - Windows: `irm https://download.uipath.com/uipath-cli/install.ps1 | iex`
   - Installs Node.js ≥ 20, `@uipath/cli`, the skills for detected agents, .NET SDK 8.0, and Python 3.11–3.14, then runs `uip skills install --no-interactive`.
2. **Manual / per-agent:** `uip skills install`, optionally `--agent <name>`; `--skip-skills --skip-runtimes` (macOS/Linux) / `-SkipSkills -SkipRuntimes` (Windows) for CI-only machines.

`uip skills install` **auto-detects** installed coding agents and keeps skills updated as the repo changes. Supported targets (`--agent` value): `claude` (Claude Code), `cursor`, `copilot` (GitHub Copilot), `codex` (OpenAI Codex CLI ≥ 0.142.0), `opencode`, `autopilot` (UiPath Autopilot), `kiro`, `windsurf`, `antigravity`, `devin`.

Other agent integrations ship in-repo as metadata/symlinks:
- **Codex:** `AGENTS.md` (symlink target of `CLAUDE.md`) + `.agents/skills/` (symlink to `skills/`) + `.codex-plugin/` manifest exposing the same skills and session hooks.
- **Cursor:** `.cursor/rules/` auto-loaded rules; `.cursor-plugin/` metadata.
- **Gemini:** `gemini-extension.json`.
- **skills.sh evaluation path** (point-in-time copy, no `uip` needed): `npx skills add UiPath/skills --list`, `npx skills use UiPath/skills@uipath-rpa | claude`, `npx skills add UiPath/skills --skill uipath-rpa`, updated manually via `npx skills update`.

Manual Claude plugin install (`claude plugin marketplace add` / `claude plugin install`) is explicitly **discouraged** — manual installs don't auto-update.

### 4.2 `assets/skill-status.json` — maturity tracking

- **Single source of truth** for each skill's lifecycle status; `schema_version: 1`, `source: "manual"`, a `generated_at` timestamp.
- Three statuses with documented meanings:
  - **Stable** — production-ready surface; safe for production.
  - **Preview** — may be broadly available or gated/allowlisted; surface and behavior may change.
  - **In-development** — skill itself incomplete/unstable; coverage partial.
- Per-skill entries also carry `confluence` metadata (`page_id`, `url`) and `last_synced` for doc-sync provenance (only `uipath-insights` has a Confluence page id: `90824180832`).
- **Process rules** (from `CLAUDE.md`): adding/renaming/removing a `skills/<name>/` folder requires the matching edit to `skill-status.json` **and** `skills.sh.json` **in the same PR** — neither file is discovered from disk, so nothing else notices drift. The README lifecycle table is **generated** between markers via `python3 scripts/check-skill-status.py --write-readme`; grouping validated with `python3 scripts/check-skills-sh.py`.

Current distribution across the 31 skills: **14 stable** (admin, agents, api-workflow, automationhub, coded-apps, feedback, human-in-the-loop, ixp, maestro-flow, planner, platform, rpa, solution, tasks), **13 preview** (aops, functions, genome, governance, insights, knowledge-bundles, maestro-case, mcp-servers, process-mining, review, test, troubleshoot, vertical-solutions), **4 in-development** (activity-migrator, connector-builder, maestro-bpmn, rules).

### 4.3 `skills.sh.json` — display grouping

Groups every skill into exactly one skills.sh catalog grouping (validated by `scripts/check-skills-sh.py`): **Authoring** (13 skills), **Solution & Planning** (4), **Platform & Operations** (rest), plus Diagnostics/Feedback and remaining groups defined in the file (`notGrouped: "bottom"`).

---

## 5. Claude Code Plugin Structure

### 5.1 Plugin manifest — `.claude-plugin/plugin.json`

- `name: "uipath"`, `version: 1.206.0`, MIT license, homepage github.com/UiPath/skills.
- `"skills": "./skills/"` — the entire skills directory is the plugin's skill set.
- `"agents"`: registers `./skills/uipath-rpa/agents/uipath-project-discovery-agent.md` — a subagent that auto-discovers UiPath project structure/dependencies/conventions and writes context files for Claude Code (`.claude/rules/project-context.md`) and UiPath Autopilot (`AGENTS.md`); triggers when a UiPath project with authored workflows lacks context; skips empty/fresh scaffolds.

### 5.2 Marketplace manifest — `.claude-plugin/marketplace.json`

- `name: "uipath-marketplace"`, owner UiPath `<support@uipath.com>`, one plugin `uipath` sourced from `"./"` (repo root as plugin root) at version 1.206.0.

### 5.3 Session hooks — `hooks/hooks.json` + `.mjs` scripts

Hook entries are **bash/PowerShell polyglots** (no `shell` field — relies on Claude Code's default shell selection) that guard for a missing binary and silently no-op. **Never-fail by contract** (exit 0). No `.sh`/`.ps1` scripts — everything is Node (≥ 20) or direct `uip` ingestion (a past PowerShell twin required Authenticode signing and broke under Group Policy).

| Event | Hook | Purpose |
|-------|------|---------|
| SessionStart | `suggest-permissions.mjs` (`once: true`, 5s) | If no `uip` allowlist found in settings, prints a one-line nudge toward `/uipath:install-permissions`. Claude-specific: stays silent in Codex (which exposes Claude-compatible hook env vars). |
| SessionStart | `set-session-env.mjs` (5s) | Exports `UIPATH_SESSION_ID`, `UIPATH_AGENT_MODEL`, `UIPATH_PERMISSION_MODE`, `UIPATH_EFFORT_LEVEL`, `UIPATH_SKILLS_VERSION` into `$CLAUDE_ENV_FILE` so every `uip` command carries correlated telemetry dimensions (App Insights `session_Id`). |
| SessionStart / PostToolUse / SessionEnd / Stop / StopFailure | `uip track --hook` (async, 30s on SessionEnd) | Telemetry ingestion — **no script**; the raw hook payload is piped to the CLI, field derivation lives in UiPath/cli (`track-hook.ts`). PowerShell branch resolves `uip.cmd` explicitly (never npm's `uip.ps1` shim). |

Additional maintenance hook: `hooks/validate-skill-descriptions.sh` (repo CI, not a session hook).

### 5.4 Permission allowlist — `commands/install-permissions.md` (`/uipath:install-permissions`)

Claude Code plugins **cannot ship permission rules declaratively** (plugin `settings.json` ignores `permissions`), yet a realistic Flow/RPA build runs 25+ distinct `uip` subcommands. The slash command:
1. Asks **Full — with safety rails** (default: `allow` + `ask` blocks; cloud-side-effect commands `debug/upload/publish/pack/login` still prompt even in bypass mode) vs **Allow-only — no safety rails**.
2. Asks where: project `.claude/settings.local.json` (default), project `.claude/settings.json`, global `~/.claude/settings.json`, just-print, or custom path.
3. Parses the target strictly, preserves/dedupes existing entries, never removes prior `ask` rails, aborts on invalid JSON, shows a delta diff before writing.

### 5.5 Claude Code-specific integrations inside skills

- **Repo-level `CLAUDE.md`** (symlinked to `AGENTS.md`): project rules — self-containment architecture, SKILL.md-as-contract, flavor system, hook constraints, contribution rules, file conventions table, review guidance.
- **`.claude/rules/`**: maintainer-facing rule files auto-loaded by Claude Code when working *on* the repo — `skill-structure.md`, `skill-review.md`, `content-quality.md`, `cli-renames.md`, `pr-review.md`, `test-writing.md`, `token-optimization.md`.
- **`.claude/commands/`**: maintainer slash commands — `audit-verbs.md`, `generate-confluence-scorecard.md`, `generate-task.md`, `lint-task.md`, `skill-compare.md`, `test-coverage.md`.
- **`.claude/skills/manage-skill-flavors/`**: meta-skill governing the flavor system; CLAUDE.md mandates reading it fully before touching flavor markers, overrides, discovery, or package publishing.
- **Per-skill `CLAUDE.md`** (skill-dir level, auto-loaded by Claude Code when the skill is active):
  - `skills/uipath-rpa/CLAUDE.md` — **UIA boundary rules**: keeps this skill version-agnostic by forbidding UIA subcommands, flags, artifact filenames, step numbers, and `uip rpa uia` bash blocks inside the skill; all of those live in UIA package docs installed to `{PROJECT_DIR}/.local/docs/packages/UiPath.UIAutomation.Activities/`.
  - `skills/uipath-genome/CLAUDE.md` — **subject-homes map**: every subject is stated in full in exactly one reference file; all other mentions are one-line pointers (single-home editing discipline).

---

## 6. Flavor System & Versioning

- **`skill-flavors/studioweb/`**: custom flavors inherit the complete catalog and contain only **sparse exceptions** — files mirror canonical skill paths (`skill-flavors/studioweb/uipath-<skill>/...`) and hold only complete replacement blocks for named flavor-marker regions (`<!--skill-flavor:<name>:start|end-->`) in canonical files. Every flavor ships every skill; canonical guidance is reused unless overridden. 17 skills currently have studioweb overrides.
- **Build order**: compose complete `default` + flavor trees, validate the final files, then stage packages — consumers copy finished trees and never compose Markdown at runtime (`scripts/compose-skill-flavor.mjs`, `select-skill-package.mjs`).
- **`version-manifest.json`** (schemaVersion 2): `skillsVersion: 1.206.0`, `targetCli: ^1.206.0` — pins the skills bundle version and the minimum CLI, consumed by `set-session-env.mjs` (`UIPATH_SKILLS_VERSION`) and CLI update checks.
- **CI**: `.github/workflows/` with a required-status-check contract documented in `docs/REQUIRED-CHECKS.md` (guarded by `tests/scripts/test_required_checks_contract.py` and `scripts/apply-required-checks.sh`), skill-lint (`.skill-lint.yaml`), sensitive-content checks, CLI-verb and skill-verb audits, and a release gate (`scripts/run-release-gate.mjs`).

---

## 7. Dependency Map (routing graph)

Routing edges expressed as `skill → skills it hands off to`. Remember: these are runtime delegation/routing contracts, not file imports — every delegation must degrade gracefully when the sibling is absent.

```
activity-migrator → rpa, review, troubleshoot
admin             → platform, rpa
agents            → functions, platform
aops              → governance, platform, rpa
api-workflow      → agents, coded-apps, maestro-flow, platform, rpa, troubleshoot
automationhub     → (leaf)
coded-apps        → agents, functions, maestro-flow, rpa, solution
connector-builder → maestro-flow, platform
feedback          → troubleshoot
functions         → agents, coded-apps
genome            → planner, review, activity-migrator + every owning skill it names
governance        → platform
human-in-the-loop → maestro-flow, maestro-bpmn, maestro-case, agents, tasks
insights          → admin, platform, rpa, troubleshoot
ixp               → maestro-flow (Flow-side IXP nodes belong to maestro-flow)
knowledge-bundles → platform, solution
maestro-bpmn      → maestro-flow, maestro-case, rpa, solution, agents, api-workflow
maestro-case      → planner, maestro-flow, maestro-bpmn, rpa, rules, agents, api-workflow
maestro-flow      → ixp, agents, rpa, maestro-bpmn, maestro-case
mcp-servers       → agents, platform
planner           → (fan-out) rpa, maestro-flow/bpmn/case, agents, solution, functions,
                    coded-apps, connector-builder, human-in-the-loop, ixp, mcp-servers,
                    rules, api-workflow, platform
platform          → admin (audit), insights (history), troubleshoot (root cause),
                    solution, planner, rpa, maestro-flow, maestro-bpmn, agents, test
process-mining    → platform, maestro-flow, ixp
review            → (read-only across all domain skills)
rpa               → platform, solution, agents, maestro-flow, test, feedback
rules             → maestro-bpmn, maestro-case, rpa, solution
solution          → planner, platform, rpa, coded-apps, maestro-flow, maestro-bpmn,
                    agents, troubleshoot
tasks             → human-in-the-loop, platform, coded-apps
test              → platform, rpa
troubleshoot      → platform, rpa (+ borrows inspection commands from all skills)
vertical-solutions→ solution, platform, admin, troubleshoot
```

**Hubs:** `uipath-platform` (all cloud ops + CLI bootstrap), `uipath-planner` (all design fan-out), `uipath-troubleshoot` (all diagnostics, with priority over surface ownership), `uipath-solution` (all multi-project packaging).

---

## 8. Notable Observations

- **Size asymmetry:** `uipath-rpa` (707 files) and `uipath-troubleshoot` (457) dwarf everything else; `uipath-feedback`, `uipath-knowledge-bundles`, and `uipath-rules` are single-file or near-single-file skills — maturity ≠ size, but the two in-development/thin skills (rules, connector-builder) are the least complete.
- **Versioning discipline:** the UIA boundary pattern in `uipath-rpa/CLAUDE.md` is a reusable technique for keeping skills stable while per-package docs evolve — content that changes every package release is pushed out of the skill into install-local package docs.
- **Telemetry correlation:** `set-session-env.mjs` is the *only* way command-stream and skills-event telemetry share a session id (since telemetry schema v3) — a subtle coupling between hooks and CLI.
- **Registry fragility:** `skill-status.json` and `skills.sh.json` are not discovered from disk; the repo compensates with same-PR rules, PR checks, and generated README sections, but a cataloging consumer (like this document) should re-derive from the files, not from the README.
