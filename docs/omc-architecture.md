# OMC (oh-my-claudecode) Architecture — Reverse-Engineered Analysis

> Source analyzed: `RGA_Oh_My_UiPath/research/omc-source` (package `oh-my-claude-sisyphus` v5.7.23).
> Purpose: map OMC's architecture to inform a UiPath adaptation. This document overwrites the earlier placeholder with a full source-grounded analysis.

## 0. System Overview

OMC is a multi-agent orchestration layer for Claude Code that ships **three cooperating surfaces**:

1. **A Claude Code plugin** (`.claude-plugin/plugin.json`) — bundles ~49 skills (`skills/*/SKILL.md`), 20 agent prompt files (`agents/*.md`), 20 compatibility commands (`commands/*.md`), hooks (`hooks/`), and MCP servers.
2. **A Node CLI** (`bin/oh-my-claudecode.js` → `bridge/cli.cjs` → `src/cli/index.ts`, commander-based) — exposes `omc ask`, `omc team`, `omc ralph afk`, `omc graph run`, `omc lookout scan`, `omc checkpoint`, `omc hud`, `omc quality-gates`, etc.
3. **A library** (`src/index.ts` exports) — the Agent SDK plugin runtime: config loader, agent definitions, magic keywords, background tasks, hooks bridge, lookout, team recovery clients.

The core design philosophy: **skills are markdown prompts** (stateless instructions injected into the lead LLM's context), while **all deterministic/stateful logic lives in TypeScript** (hooks + CLI + state files under `.omc/`). The LLM orchestrates; the code enforces.

### Key runtime directories

| Path | Purpose |
|------|---------|
| `.omc/` | Per-workspace OMC root (resolution: `OMC_STATE_DIR` > `.omc-workspace` marker > git root > cwd) |
| `.omc/state/{name}.json` | Mode state (autopilot, ralph, hud, pipeline…) — session-scoped variants at `.omc/state/sessions/{sessionId}/` |
| `.omc/state/team/{name}/` | Team runtime state (config, tasks, workers, heartbeats, inboxes) |
| `.omc/plans/`, `.omc/specs/`, `.omc/autopilot/` | Plan/spec artifacts (ralplan, deep-interview, autopilot) |
| `.omc/notepads/<mode>/problems.md` | Closeout "what broke / what dragged" observations |
| `.claude/omc.jsonc` | Project config |
| `~/.config/claude-omc/config.jsonc` | User config (XDG-aware, legacy fallback) |
| `~/.claude/` | Claude config dir (`settings.json`, `commands/`, `skills/`, `omc-hud.mjs` statusline) |

---

## 1. Plugin / Skill Registration

### Key files
- `src/features/builtin-skills/skills.ts` — loader + cache for bundled skills (the SSOT registry)
- `src/features/builtin-skills/types.ts` — `BuiltinSkill` interface
- `src/features/builtin-skills/runtime-guidance.ts` — injects provider-availability guidance per skill
- `src/hooks/auto-slash-command/executor.ts` — in-session command discovery + execution
- `src/hooks/auto-slash-command/detector.ts` — `/command` parsing from user prompts
- `src/utils/frontmatter.ts` — frontmatter parser (`name`, `description`, `aliases`, `argument-hint`, `model`, `agent`, `pipeline`, `omc-full-body`)
- `src/utils/skill-pipeline.ts`, `src/utils/skill-resources.ts` — pipeline metadata and resource rendering
- `skills/<name>/SKILL.md` — 49 bundled skill definitions (markdown with YAML frontmatter)
- `commands/<name>.md` — thin compatibility shims (e.g. `commands/hud.md` just says "read `skills/hud/SKILL.md` and follow it")
- `.claude-plugin/plugin.json` — Claude Code plugin manifest listing `./skills/*`, `./commands/`, `./.mcp.json`
- `src/config/builtin-skill-entitlements.json` — skininthegamebros-only skill gating

### Core abstraction: `BuiltinSkill`
```ts
interface BuiltinSkill {
  name: string;            // safe name (CC-native names get 'omc-' prefix)
  aliases?: string[];      // deprecated aliases flagged with deprecationMessage
  aliasOf?: string;
  description: string;
  template: string;        // rendered body = frontmatter body
                           //   + omc-CLI invocation rewrites (rewriteOmcCliInvocations)
                           //   + runtime provider guidance
                           //   + pipeline guidance
                           //   + resources guidance
  model?: string; agent?: string; argumentHint?: string; pipeline?: ...;
}
```

### Data flow (registration)
1. `createBuiltinSkills()` scans the packaged `skills/` dir (sorted; `skillify` pinned first for alias precedence).
2. Each `SKILL.md` → `parseFrontmatter` → `loadSkillFromFile` → primary entry + alias entries.
3. Name safety: names colliding with Claude Code native commands (`review`, `plan`, `init`, `doctor`, `help`, `config`, `clear`, `compact`, `memory`, `security-review`) are prefixed `omc-` (e.g. `omc-plan`, `omc-doctor`).
4. Cached with a cache key derived from the resolved deep-interview ambiguity threshold (so config changes invalidate the skill-template cache).
5. Deep-interview's template gets **runtime settings injection** at load: `applyDeepInterviewRuntimeSettings()` rewrites the hardcoded 20% threshold into the resolved `omc.deepInterview.ambiguityThreshold` from settings.json (project > user > default 0.2).

### Discovery precedence (in-session slash surface)
`src/hooks/auto-slash-command/executor.ts#discoverAllCommands()` merges, first-wins:
```
.claude/commands/ (project) > ~/.claude/commands/ (user)
> .claude/skills/ (project) > {omc-root}/skills/ (OMC bundled)
> .agents/skills/ (project compat) > ~/.claude/skills/ (user)
> bundled builtin skills
```
Skills and commands are the same shape at execution time: markdown content with `$ARGUMENTS` substitution, plus optional "live data" directive resolution (`live-data.ts`).

### Workflow registry (naming policy)
- `src/workflow/registry.ts` — structured keep/merge/alias-deprecate/delete decisions for every public skill/command. Tier-0 workflows: `plan`, `execute`, `review`, `verify`; roles: `planner`, `executor`, `reviewer`, `verifier`. `ralplan`, `execute` are Tier-0 keeps; `autopilot`, `ralph`, `team`, `ultragoal` are kept as directly-invocable workflows.
- `src/workflow/alias-resolver.ts` + `src/alias-retirement/policy.ts` — alias resolution, warning dedupe, retirement evidence (`REMOVAL_MILESTONE`).
- Feature flag `OMC_WORKFLOW_REGISTRY=0` rolls back to legacy resolution.

### UiPath adaptation notes
- Skill = versioned markdown contract + deterministic loader. The UiPath analog is a **skill/agent definition catalog** loaded from a directory with frontmatter metadata, an entitlement manifest, and alias/deprecation policy — not hard-coded command classes.

---

## 2. Autopilot Pipeline (stage mechanism)

### Key files
- `skills/autopilot/SKILL.md` — the 5-phase legacy lifecycle + v1 named-workflow profiles
- `src/hooks/autopilot/pipeline.ts` — pipeline orchestrator
- `src/hooks/autopilot/pipeline-types.ts` — `PipelineStageId`, `PipelineStageAdapter`, `PipelineStageState`, `WorkflowProfileStages`
- `src/hooks/autopilot/adapters/{ralplan,execution,ralph,qa}-adapter.ts` — stage adapters
- `src/hooks/autopilot/state.ts` — autopilot state machine (read/write/init, Ralph→QA transitions)
- `src/hooks/autopilot/named-workflow-resume-validator.ts` — resume/hash validation
- `src/hooks/autopilot/{cancel,enforcement,prompts,transition-helper}.ts`
- `src/features/state-manager/` — unified state I/O (local/global, atomic writes, legacy migration, TTL read cache)

### Stage mechanism
```ts
type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";
interface PipelineStageAdapter {
  id: PipelineStageId;
  name: string;
  completionSignal: string;          // e.g. "PIPELINE_RALPLAN_COMPLETE" emitted by the LLM
  shouldSkip(config): boolean;
  getPrompt(context): string;        // stage prompt injected into the lead
  onEnter?(context): void;            // e.g. ralph adapter starts ralph state
  onExit?(context): void;
}
```
- Adapters wrap existing modules (ralplan consensus planning, team/executor execution, ralph loop, QA cycle) behind one interface; `ALL_ADAPTERS` holds them in canonical order.
- Orchestrator iterates stages, tracking `PipelineStageState` (`pending|active|complete|failed|skipped`) in the autopilot state file. Stage advance requires the completion signal; the Stop hook enforces evidence (an authorized assistant completion record for the active stage after its persisted activation boundary) and uses compare-before-write so duplicate/concurrent Stop events advance exactly once.
- **Legacy lifecycle** (no `--workflow`): Phase 0 Expansion → Phase 1 Planning → Phase 2 Execution → Phase 3 QA (max 5 cycles, 3-strike stop) → Phase 4 multi-perspective Validation (architect + security + code reviewer, all must approve) → Phase 5 Closeout (notepad append + state cleanup + `/cancel`).
- **Named workflow profiles v1** (`--workflow <slug>`): config in `autopilot.workflows.<slug>` JSONC; exactly one of four admitted stage sequences (`[ralplan, execution]`, `+ralph`, `+qa`, `+ralph+qa`). Immutable descriptor = workflow name + version + canonical stages + SHA-256 profile hash. Resume/Stop verify the hash and refuse mismatch. Project profile replaces user profile atomically (no deep-merge). Env cannot define profiles.
- **Artifact shortcuts**: existing ralplan consensus plan (`.omc/plans/ralplan-*.md` / `consensus-*.md`) skips Phases 0+1; deep-interview spec (`.omc/specs/deep-interview-*.md`) becomes Phase 0 output.
- **Budget stop**: `OMC_RUN_BUDGET_TOKENS` checked at phase boundaries via `trace_summary` MCP tool; 90% → finish current phase; 100% → stop with resumable state.

### State management & cancel/resume
- State lives at `.omc/state/autopilot-state.json` (session-scoped variant under `.omc/state/sessions/{sessionId}/`) via `src/lib/mode-state-io.ts` (locked writes, emergency mutation, session ownership checks in `canClearStateForSession`).
- Mode registry (`src/hooks/mode-registry/`) gates mutually exclusive modes (`canStartMode`).
- **Resume**: re-invoke `/autopilot`; state carries phase, plan/spec paths, stage tracking. Named workflows validate descriptor hash before resuming.
- **Cancel**: `skills/cancel/SKILL.md` + `src/hooks/autopilot/cancel.ts`. Fail-closed identity resolution (`OMC_SESSION_ID` / hook `session_id`); `--force` changes urgency not scope; `--all` enumerates and cancels each session independently, then legacy/global cleanup. Cancel preserves resumable progress artifacts and runs closeout (notepad append) before terminal cleanup.
- AFK assumption protocol: when headless, every would-be-interview-question becomes a recorded assumption (statement/basis/reversibility) in the spec's `## Assumptions`; ADR-test-passing guesses land in `.omc/autopilot/decisions-pending.md`.

### Dependencies
`src/config/loader.ts` (profile validation/composition), `src/hooks/ralph/` (stage 3), `src/features/state-manager/`, team runtime (execution: solo or `execution: "team"`), quality gates (`src/config/quality-gates.ts`, `omc quality-gates list --stage <n>`), company-context MCP hook (optional).

---

## 3. Team Orchestration

### Key files
- `skills/team/SKILL.md` (1053 lines) — the full orchestration contract
- `src/team/` (~60 modules) — the tmux/CLI runtime
- `src/cli/team.ts`, `src/cli/commands/team.ts` — `omc team` CLI
- `src/team/model-contract.ts` — `CliAgentType` + `CliAgentContract` per external CLI
- `src/team/runtime.ts` (v1 polling watchdog) vs `src/team/runtime-v2.ts` (event-driven, default)
- `src/team/tmux-session.ts`, `tmux-comm.ts`, `src/cli/tmux-utils.ts` — tmux plumbing
- `src/team/state-paths.ts` — `TeamPaths` (all file locations under `.omc/state/team/{name}/`)
- `src/team/{inbox-outbox, dispatch-queue, monitor, heartbeat, allocation-policy, worker-bootstrap, worker-launch-ack, worker-restart, worker-health, merge-coordinator, recovery-saga, sentinel-gate, phase-controller, stage-router, role-router, task-router}.ts`

### Two distinct runtimes (critical!)
1. **Native in-session team** (Claude Code ≥2.1.178, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): the lead session IS the orchestrator; teammates spawn directly via Agent/Task tool with distinct `name="worker-N"`; no `TeamCreate`/`TeamDelete` calls; coordination via native team messaging + task list (TodoWrite). Staged pipeline: `team-plan → team-prd → team-exec → team-verify → team-fix (loop)`. Tmux is **forbidden** in this mode.
2. **Legacy tmux/CLI runtime** (`omc team N:agent-type "task"` / `/omc-teams`): lead spawns external CLI agents (codex, gemini, antigravity/agy, cursor, grok, claude) in tmux panes named `omc-team-{team}-{worker}`. Workers are autonomous executors with filesystem access; they cannot use Claude Code's tool/team surfaces, so coordination is file-based.

The skill explicitly documents that the two runtimes **do not share results**.

### CLI-worker mechanics (tmux runtime)
- **Spawn**: `model-contract.ts` validates the CLI binary against trusted prefixes (`/usr/local/bin`, `/usr/bin`, `/opt/homebrew`, `~/.local/bin`, `~/.nvm`, `~/.cargo/bin`, `OMC_TRUSTED_CLI_DIRS`); rejects /tmp, /var/tmp, /dev/shim. `worker-launch-ack.ts` waits for launch acknowledgment (30s evidence windows; startup fails as `worker_startup_evidence_missing` — pane activity alone never counts).
- **Comms**: file-based mailboxes — `.omc/state/team/{team}/workers/{worker}/inbox.md`, outbox files, heartbeat.json, status files; leader ingests outboxes via `outbox-reader.ts` (pull-based) alongside push delivery. `message-router.ts`, `inbox-outbox.ts`, `conflict-mailbox.ts`.
- **State layout** (`TeamPaths`): `config.json` (revisioned, mutation-locked), `tasks/{taskId}.json`, `workers/{worker}/`, `shutdown.json`, recovery locks. Ownership keyed by SHA-256 of canonical state root; process identity locks (`process-identity-lock.ts`, `team-owner-epoch.ts`) prevent cross-owner mutation.
- **Completion detection (v2)**: no done.json polling; CLI API lifecycle transitions (claim-task / transition-task-status), event-driven monitor snapshots, heartbeats. Sentinel gate, circuit breaker, failure sidecars preserved from v1.
- **Scaling/governance**: `allocation-policy.ts` assigns tasks to workers; `scaling.ts`, `governance.ts` (transport policy defaults), `phase-controller.ts`/`inferPhase`, `stage-router.ts` (stage→agent-type routing), `role-router.ts`, `merge-coordinator.ts` (worktree merges), `git-worktree.ts`.
- **Recovery**: `recovery-saga.ts`, `task-recovery-checkpoint.ts`, `recoverDeadWorkerV2` (exported in `src/index.ts`), worker restart, orphan scanning in cleanup.
- **Windows**: psmux tmux-compatible binary is checked (`tmux -V`) before telling users WSL is needed.

### Worker kinds
`codex_worker`, `gemini_worker`, `antigravity_worker`, `cursor`, claude workers, plus Claude specialist agents (architect, critic, debugger, designer…) routed per stage. Team+Ralph composition wraps the pipeline in Ralph's persistence loop.

### UiPath adaptation notes
- The file-based mailbox + heartbeat + status contract is the most portable piece: it maps naturally to UiPath queues/orchestrator jobs or plain file artifacts. The dual-runtime split (native subagents vs external CLI panes) mirrors a future "UiPath agents vs external CLI workers" split.

---

## 4. Ask Provider Routing

### Key files
- `src/cli/ask.ts` — `omc ask <provider>` arg parsing + role prompt resolution
- `scripts/run-provider-advisor.js` — the actual provider subprocess launcher
- `agents/*.md` — role prompt files (analyst, architect, critic, executor, qa-tester, security-reviewer, …)
- `src/team/model-contract.ts` — `isCliAvailable(agentType)` availability detection
- `src/features/builtin-skills/runtime-guidance.ts` — renders per-skill provider guidance (e.g. "Codex available → use `omc ask codex --agent-prompt critic`")
- `src/lib/security-config.ts` — `isExternalLLMDisabled()` (policy kill-switch; only `claude` allowed when set)
- `src/features/model-routing/` — tier routing (Haiku/Sonnet/Opus) for *Claude* delegation
- `src/features/delegation-routing/` — role→provider/tool resolution with fallback chains

### Providers
`claude | codex | gemini | antigravity | grok | cursor | muse` (CLI binaries: `claude`, `codex`, `gemini`, `agy`, `grok`, `cursor-agent`, `muse`).

### Data flow
1. `omc ask <provider> [--agent-prompt <role>] "<prompt>"` → `parseAskArgs` (validates provider set, safe role pattern `^[a-z][a-z0-9-]*$`).
2. External provider blocked if `disableExternalLLM` security config is set.
3. Role resolution: prompts dir is `$CODEX_HOME/prompts`, or `.codex/prompts` when `.omx/setup-scope.json` says project-scoped, else package `agents/`; role file content is prepended to the user prompt.
4. `resolveAskAdvisorScriptPath()` — `OMC_ASK_ADVISOR_SCRIPT` env (alias `OMX_…` deprecated) → default `scripts/run-provider-advisor.js`.
5. Advisor script spawns the provider CLI headless with per-provider arg shapes:
   - codex: `codex exec --dangerously-bypass-approvals-and-sandbox`
   - gemini: `gemini -p <prompt> --yolo`
   - antigravity: `agy --dangerously-skip-permissions -p` with SIGKILL timeout guard (upstream hang bug)
   - grok/muse: `--prompt-file` (they misparse `-`-leading prompts; grok reserves stdin for ACP)
   - cursor: `cursor-agent --print --force --trust --sandbox disabled`
6. Stdout/stderr and exit code propagated; original task rides `OMC_ASK_ORIGINAL_TASK` env.

### Provider-aware skills
Skills opt into multi-provider passes via flags (`ralplan --architect codex`, `ralph --critic codex`). Rule enforced in ralplan: **Claude-only reviewers may run in parallel; any external provider forces sequential awaited Task calls** (rate-limit cascade protection), and Architect output never reaches Critic.

### Model tier routing (Claude-internal)
`src/features/model-routing/router.ts#routeTask`: signal extraction (`signals.ts`) → complexity score (`scorer.ts`) → rules (`rules.ts`) → tier (LOW/MEDIUM/HIGH → Haiku/Sonnet/Opus). `forceInherit` (auto-enabled for Bedrock/Vertex/custom base URLs) bypasses routing so agents inherit the parent model. Delegation routing (`resolver.ts`) resolves role→provider with `parseFallbackChain`.

---

## 5. Ralph Agent (autonomous coding loop)

### Key files
- `skills/ralph/SKILL.md` — the loop contract (PRD mode, verification gates, deslop)
- `src/hooks/ralph/loop.ts` — `RalphLoopState`, loop control (`createRalphLoopHook`), critic modes
- `src/hooks/ralph/prd.ts` — PRD scaffold/parse/status; session-scoped at `.omc/state/sessions/{id}/prd.json`
- `src/hooks/ralph/feedback-baseline.ts` — baseline fingerprints + diffing (`omc ralph verify`)
- `src/hooks/ralph/{progress,stale-prd,verifier}.ts`
- `src/cli/commands/ralph.ts` — `omc ralph afk` headless launcher + `omc ralph verify` surface

### The loop
PRD-driven persistence: **iterate until every user story has `passes: true` and is reviewer-verified.**

1. **PRD Setup**: auto-scaffold `prd.json` → lead MUST refine generic criteria into task-specific, testable acceptance criteria → order stories by risk class (architectural > integration > spikes > standard; polish last). `repoQualityClass` (prototype/production/library) scales ordering strictness + backward-compat bar.
2. **Feedback baseline** (non-negotiable): `omc ralph verify --write-baseline --session <id>` runs the PRD's `feedbackCommands` (or package-script detection) on the current tree and fingerprints failures. Baseline failures = environment noise (never "fixed" mid-run); a baseline failure touching a story's file is a real signal; unrunnable baselines stay `unrunnable`.
3. **Per story**: implement via tiered executor delegation (Haiku/Sonnet/Opus, parallel where independent, `run_in_background` for builds/tests) → verify EACH active criterion with fresh evidence → `omc ralph verify --session <id>` exit code 0/1 is the gate (never hand-roll the diff) → mark `passes: true` + revision-bound `completionCriteriaRevision`.
4. **Criterion amendments**: empirically-refuted criteria are replaced/superseded via an evidence-preserving ledger (`criterionAmendments`: verbatim original + kind/reason/evidence/authority/timestamp); PRD fails closed on contradictory ledgers.
5. **Reviewer verification** (Step 7): tiered (STANDARD sonnet floor / THOROUGH opus for >20 files or security), `--critic=architect|critic|codex`; codex pass must include acceptance criteria + optimality question + related-files review.
6. **Deslop pass** (7.5): mandatory `Skill("oh-my-claudecode:ai-slop-cleaner")` on changed files only (skip only with `--no-deslop`), then regression re-verify (7.6) until exit 0.
7. **Closeout** (Step 8): append ≤3 factual lines to `.omc/notepads/ralph/problems.md` (+issues.md for blockers), then `/cancel` state cleanup. Rejection (Step 9) loops back; three-strike halts draft an incident work item.
8. **Stale-PRD handling** (`stale-prd.ts`): abnormal exits surface `[STALE PRD WARNING]`; auto-reconciliation only with configured observable evidence checks (`fileExists`/`fileContains`/`gitGrep`), never from PR/merge status.

### AFK launcher
`omc ralph afk "<task>" --verify "<cmd>"` spawns an isolated headless Claude session: scoped allowlist + `--setting-sources project,local`, no general Bash, read-only git set, exactly the declared verify commands (carried via `OMC_RALPH_AFK_FEEDBACK` so the session can't widen its own allowlist), ralph skill materialized as a project skill, `--no-deslop` injected (bundled skills invisible in isolated sessions).

### State
`RalphLoopState` at `.omc/state/ralph-state.json` (session-scoped variants): `active`, `iteration`, `max_iterations`, `started_at`, `prompt`, `session_id`, `prd_mode`, `current_story_id`, `critic_mode`. Continuation enforcement is hook-driven: the Stop hook re-injects `[RALPH - ITERATION n/max]` context until the PRD completes or `/cancel` runs. `progress.txt` carries cross-iteration learnings and codebase patterns.

---

## 6. Deep Interview (state machine + workflow)

### Key files
- `skills/deep-interview/SKILL.md` (823 lines) — full contract
- `src/features/builtin-skills/skills.ts` — runtime threshold injection (`<resolvedThreshold>` placeholders)
- State via `state_write(mode="deep-interview")` → `.omc/state/` MCP tools (bridge MCP server)

### State machine
```
Phase 0: Resolve ambiguity threshold (blocking, before any state write)
  → omc.deepInterview.ambiguityThreshold: project .claude/settings.json
    > user ~/.claude/settings.json > default 0.2
  → emit "Deep Interview threshold: X% (source: …)"

Phase 1: Initialize
  → parse idea; brownfield vs greenfield (explore agent on haiku)
  → brownfield: codebase context + prior .omc/specs / .omc/plans knowledge
  → oversized-context normalization (prompt-safe summary is canonical)
  → state_write: rounds[], current_ambiguity=1.0, topology, ontology_snapshots

Round 0: Topology enumeration gate (one-time)
  → lock top-level component list into state (prevents depth-first overfit
    to the most-described component)

Phase 2 loop (repeat until ambiguity ≤ threshold OR caps):
  2a question generation → weakest active-component × weakest dimension
  2b AskUserQuestion (ONE question/round; --frontier mode batches up to 4)
  2c score ambiguity (opus, temp 0.1) across dimensions:
       greenfield:  1 − (goal×.40 + constraints×.30 + criteria×.30)
       brownfield:  1 − (goal×.35 + constraints×.25 + criteria×.25 + context×.15)
     + ontology extraction & stability ratio (stable+changed)/total
  2d transparent progress table
  2e state update  2f soft limits (round 3+ early-exit; 10 warn; 20 hard cap)

Phase 3: Challenge agents (perspective shifts, each used once)
  Round 4+: CONTRARIAN · Round 6+: SIMPLIFIER · Round 8+: ONTOLOGIST (if >0.3)

Phase 4: Crystallize spec → .omc/specs/deep-interview-{slug}.md (exact path)
  + quality gates (configured gates spawn independent Task reviewers,
    VERDICT: PASS/BLOCK; blocking BLOCK returns to Phase 2)

Phase 5: handoff — pipeline metadata `pipeline: [deep-interview, plan]`,
  `handoff-policy: approval-required`, handoff artifact
  `.omc/specs/deep-interview-{slug}.md`; choices include ralplan variants
  (--architect codex / --critic codex) when runtimes are available.
```
Dimensions: Goal Clarity, Constraint Clarity, Success Criteria, Context Clarity (brownfield only). Challenge modes tracked in state. Frontmatter pipeline metadata (`pipeline:`, `handoff:`, `handoff-policy:`) is parsed by `parseSkillPipelineMetadata` and rendered as pipeline guidance at skill load.

---

## 7. Lookout (pre-flight danger scan)

### Key files
- `src/features/lookout/index.ts` — `scanLookout()`, brief rules
- `src/features/lookout/types.ts` — `LookoutFinding`, `LookoutReport`, severity/confidence/verdict vocabulary
- `src/features/lookout/{command-parser, workspace, substitution-parser, test-artifact-parser, wrapper-parser}.ts`
- `src/cli/lookout.ts` — `omc lookout scan` (usage errors → exit 2)

### Design constraints (explicit in source)
- **Advisory only**: never blocks, never mutates; no skip-file backdoor. Silence is a whole-feature decision.
- **High-confidence signals only**: mechanically checkable, word-/path-segment-anchored regexes, no bare substring matches, no "unknown means warn".
- **Prefer misses over false positives** (cries-wolf failure mode from retired risk-assess classifier, upstream #3164).

### Scanned surfaces
1. **Task brief text** (≤1 MB): rules `lookout.brief.*` — force-op commands (`rm -rf`, `git push --force`…), db-destructive (DROP/DELETE/TRUNCATE), test deletion, protected branch pushes, secrets-touching, CI-touching, deploy-touching. Parsers: `collectForceOps`, `collectProtectedPushDests`, `findNestedSubstitutions` (e.g. `rm -rf $(…)`, `$(rm -rf …)`), `collectRmTestArtifacts`.
2. **Workspace state** (`workspace.ts#scanWorkspace`): `lookout.ws.secrets-present` (tracked secret-looking files via `git ls-files`), `lookout.ws.dirty-worktree` (uncommitted changes → checkpoint advice).

### Report shape
```ts
interface LookoutFinding { id: "lookout.<surface>.<signal>"; title; severity: "high|medium|low|info";
  confidence: "high|low"; actionable: boolean; evidence: string[]; advice: string; }
interface LookoutReport { scannedAt; repo: string|null; briefSource; findings;
  summary: { counts; verdict: "clear"|"advisory"|"review-recommended" }; }
```
Advice strings always pair with gates (`omc graph run --approval-mode remote --checkpoint`) and `omc checkpoint create` rollback. Exported from the library root (`src/index.ts`) for reuse by graph runs, autopilot, launch, and teams.

---

## 8. CLI vs In-Session Surface

### Two surfaces, shared markdown SSOT
| In-session (Claude Code) | CLI (omc) | Backing |
|---|---|---|
| `/skill-name` via plugin `skills/` + auto-slash-command hook | `omc <command>` via commander (`src/cli/index.ts`) | same `SKILL.md` corpus |
| `/oh-my-claudecode:*` namespaced plugin skills | `omc ralph afk`, `omc team`, `omc ask` | skills/ + src/hooks |
| keyword triggers ("ralph …", "autopilot …") | — | `src/hooks/keyword-detector/` |
| Stop/PreToolUse/PostToolUse hooks | checkpoint/graph/quality-gates | `src/hooks/bridge.ts` |

- **Plugin path**: `.claude-plugin/plugin.json` declares `./skills/*`, `./commands/`, `./.mcp.json`. Claude Code loads these natively (`/oh-my-claudecode:autopilot`), plus the auto-slash-command hook expands bare `/skill` names against the discovery precedence in §1.
- **Keyword surface**: `keyword-detector` classifies user prompts into `KeywordType` (cancel P1, ralph P2, autopilot P3, team P4.5, ralplan P8, tdd, code-review, security-review, ultrathink, deepsearch, deep-interview, analyze, codex, gemini, cursor, antigravity). `applyRalplanGate()` intercepts underspecified execution prompts (≤15 effective words, no file/symbol/issue-number/criteria anchors) and rewrites them to ralplan; bypass with `force:` / `!` prefix. Cancel always wins.
- **CLI → skill bridging**: headless launches (ralph afk, factory chain links) materialize the needed `SKILL.md` into project-visible skills and invoke `/ralph` because isolated sessions can't see plugin-bundled skills.
- **omc CLI commands** (src/cli/index.ts + commands/): `launch`, `interop`, `ask`, `config` (+ stop-callbacks, notify profiles), `info`, `test-prompt`, `update`/`update-reconcile`, `version`, `install`, `wait`, `status`, `daemon`, `detect`, `teleport`, `list`, `remove`, `session`, `search`, `friction`/`report`, `quality-gates list`, `doctor`, `team-routing`, `conflicts`, `setup`, `hud`, `mission-board`, `team`, `autoresearch`, `ralphthon`, `ultragoal`, `alias-retirement`; sub-CLIs: `graph.ts` (`run/approvals/list/decide`), `checkpoint.ts` (`create/list/rollback`), `lookout.ts` (`scan`).
- `bridge.ts` is the shell↔TS hook bridge: shell hooks pipe stdin JSON to `node …/hook-bridge.mjs --hook=<name>`; bridge dispatches to keyword-detector, orchestrator pre/post tool, mode state I/O, HUD task tracking, notifications.

### UiPath adaptation notes
The load-bearing insight: **the CLI never re-implements skill logic; it materializes the skill and lets a fresh agent session execute it**, with the CLI owning only deterministic preflight (lookout, allowlists, baselines) and post-hoc verification (verify exit codes, gates).

---

## 9. Config Schema

### Key files
- `src/config/loader.ts` (1484 lines) — `loadConfig()`, `deepMerge`, JSONC parsing, env config, validation
- `src/utils/jsonc.ts` — JSONC parser (comments allowed)
- `src/utils/paths.ts` `getConfigDir()` — XDG-aware user config dir
- `src/config/models.ts` — tier model resolution (`OMC_MODEL_HIGH/MEDIUM/LOW`), external model defaults (`OMC_CODEX_DEFAULT_MODEL`, `OMC_GEMINI_DEFAULT_MODEL`), `shouldAutoForceInherit()` (Bedrock/Vertex/CC-Switch/LiteLLM detection)
- `src/config/quality-gates.ts` — per-stage quality-gate config
- `src/config/plan-output.ts` — plan/spec path resolution

### Locations & precedence
```
defaults (buildDefaultConfig)
  ← deepMerge(user:    ~/.config/claude-omc/config.jsonc)
  ← deepMerge(project: .claude/omc.jsonc)
  ← deepMerge(env:     OMC_* variables)          [highest]
```
Exception: `autopilot.workflows.<slug>` profiles are **atomic** — a project profile with the same name replaces the whole user profile (validated per-file before merge; env can't define profiles).

### Config surface (PluginConfig, from defaults + skills)
- `agents.<name>.model` — per-agent model tiers (omc/explore/analyst/planner/architect/debugger/executor/verifier/securityReviewer/codeReviewer/testEngineer/designer/writer/qaTester/scientist/tracer/gitMaster/codeSimplifier/critic/documentSpecialist)
- `features` — parallelExecution, lspTools, astTools, continuationEnforcement, autoContextInjection
- `mcpServers` — exa, context7 enablement
- `companyContext` — `{ tool, onError: "warn"|"silent"|"fail" }` (advisory-only MCP context calls, consumed by autopilot/ralplan/ralph/deep-interview)
- `permissions` — allowBash/Edit/Write, maxBackgroundTasks
- `magicKeywords` — search/analyze/ultrathink trigger lists
- `routing` — model-tier routing (enabled, defaultTier, forceInherit auto-forced on non-standard providers)
- `delegation` — role→provider fallback chains (`src/features/delegation-routing`)
- `autopilot` — maxIterations, maxQaCycles, maxValidationRounds, pauseAfter*, skipQa/Validation, `execution: "solo"|"team"`, `team.agentTypes`, `workflows.<slug>` (v1 profiles)
- `qualityGates.<stage>` — gate skill lists (project replaces user list)
- `externalModels` — codex/gemini defaults
- Separate: `omc.deepInterview.ambiguityThreshold` lives in **Claude settings.json** (`~/.claude/settings.json` / `.claude/settings.json`), not omc.jsonc — read by skills at load/run time.
- Deep-merge escape-walking + `validateTeamConfig` / `validateAutopilotConfig` throw on invalid shapes post-merge.

---

## 10. HUD (Heads-Up Display)

### Key files
- `src/hud/index.ts` — statusline entry: reads stdin JSON from Claude Code, renders one line
- `src/hud/stdin.ts` — stdin cache, context %, model id/effort, rate limits
- `src/hud/state.ts` — HUD state (`hud-state.json` in `.omc/state/`), config read, background task registry
- `src/hud/omc-state.ts` — read-only readers for ralph/PRD/autopilot state (2h staleness)
- `src/hud/render.ts` + `src/hud/elements/*` (~30 render elements)
- `src/hud/{transcript, background-tasks, background-cleanup, mission-board, payload-estimate, usage-api, custom-rate-provider, sanitize, colors, agent-kind}.ts`
- `src/lib/hud-wrapper-template.ts` — SSOT wrapper; installer writes `~/.claude/omc/omc-hud.mjs`
- `src/cli/hud-watch.ts`, `commands/hud.md` — watch mode + compat command

### Data flow
```
Claude Code statusline tick → stdin JSON (model, session, transcript path, usage)
  → hud/index.ts
      ├ stdin cache (survives polls before first statusline fire)
      ├ parseTranscript → todos, agent activity, skill invocations
      ├ readHudState (background tasks; stale-task cleanup 4h)
      ├ readRalphStateForHud / readPrdStateForHud / readAutopilotStateForHud
      │    (named-workflow structure validation before display)
      ├ getUsage / getSubscriptionInfo (usage-api) or custom provider script
      └ render(context) → element pipeline → sanitizeOutput → stdout
```

### Elements (configurable order/labels/locales/presets)
ralph iteration + PRD story status, agents (multi-line formats), todos with current task, last skill, context % (+bar, stabilized), background tasks, rate limits (+bar), permission/thinking mode, session, token usage/enterprise cost, prompt time, autopilot phase + workflow stage progress, cwd/hostname/git (branch/status), multi-repo, model/effort, API-key source, call counts, context/payload limit warnings, update hints, mission board, session summary.

### Install wiring
`src/installer/index.ts` (unless project-scoped, `skipHud`, or `hudEnabled:false`): writes `omc-hud.mjs` (executable) and registers the statusline command in Claude `settings.json`. HUD state is shared with hooks (`src/hooks/bridge.ts` calls `addBackgroundTask`/`completeBackgroundTask` + `readHudState/writeHudState`) so background shell tasks render from any surface.

---

## 11. Supporting Subsystems (brief)

- **Graph runtime** (`src/graph/`): sealed-descriptor DAG execution — `parseGraphDescriptor` (draft, hashless) → `sealGraphDescriptor` (SHA-256 hash producer) → `parseSealedGraphDescriptor` (verify, never recompute). `scheduler.ts` + `runtime/` execute; `omc graph run --approval-mode remote --checkpoint` is lookout's recommended pairing.
- **Magic keywords** (`src/features/magic-keywords.ts`) and **continuation enforcement** (`continuation-enforcement.ts`): prompt-side triggers and "keep going" enforcement system-prompt additions.
- **Background tasks** (`src/features/background-tasks.ts`): `BackgroundTaskManager`, `shouldRunInBackground` heuristics, LONG_RUNNING/BLOCKING patterns, DEFAULT_MAX_BACKGROUND_TASKS=5.
- **Agents** (`src/agents/`): 18 typed agent modules (analyst…writer) + `definitions.ts` (`getAgentDefinitions`, `omcSystemPrompt`) + prompt-SSOT build (`scripts/build-prompt-ssot.ts`); markdown role files in `agents/` mirror these for `ask --agent-prompt`.
- **Hooks inventory** (`src/hooks/`): mode-registry, persistent-mode, omc-orchestrator, subagent-tracker, todo-continuation, pre-compact/preemptive-compaction, recovery, session-end chain spawning, notepad, codebase-map, beads-context, think-mode, factcheck, self-improve, wiki, team-pipeline, permission-handler, registry (skill-state)…
- **State manager** (`src/features/state-manager/`): unified state I/O with atomic writes (`src/lib/atomic-write.ts`), file locks, legacy migration map (boulder, ultrawork, ultraqa, prd…), 5s TTL read cache, 4h stale threshold, `cleanupOrphanedStates`/`listStates`.
- **Auto-update** (`src/features/auto-update.ts`): version metadata + GitHub release checks, exported from library root.

## 12. Cross-Cutting Themes for the UiPath Adaptation

1. **Markdown skills as the orchestration SSOT** — behavior lives in reviewable prompt files; TypeScript only loads/validates/renders them. UiPath analog: skill definitions in a repo-checked-in catalog with frontmatter metadata, loaded through one registry with alias/entitlement policy.
2. **Deterministic gates owned by code, not the LLM** — verify exit codes, feedback baselines, ambiguity thresholds, ralplan gating, budget stops, checkpoint hashes. Every autonomous loop has a mechanical stop/verification condition the model cannot hand-wave.
3. **Session-scoped, file-based state** — `.omc/state/sessions/{id}/` with locks, ownership checks, staleness windows, and fail-closed identity on cancel. Highly portable to any orchestrator with per-job state.
4. **Evidence-preserving audit trails** — criterion amendment ledgers, prd-reconciliation.jsonl, notepad closeouts, alias retirement telemetry.
5. **Advisory-vs-enforcing separation** — lookout and quality gates advise (fail-open), risk classes like secrets/destructive/release fail closed (src/workflow/registry.ts risk policy).
6. **Provider heterogeneity behind one contract** — `CliAgentContract` + per-provider arg quirks isolated in one launcher script; skill-level guidance auto-rendered from runtime availability detection.
7. **Graceful degradation everywhere** — AFK assumption protocols, gate_unavailable ≠ PASS, unavailable reviewer falls back with a visible note, headless sessions get materialized skills.
