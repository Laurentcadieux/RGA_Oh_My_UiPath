# PLAN.md — omu-c Safety Excellence + Real Parallel Execution

**Goal:** Make omu-c clearly more valuable than upstream UiPath skills alone.
**Distinct value:** Trustworthy safety layer (Lookout) + real parallel execution speed.
**Never duplicate upstream.** Call skills and `uip` binary directly.

---

## Phase 0 — Apply the Plugin Patch

**Status:** ⏳ Waiting for `omu-c-claude-plugin.patch` from Lau

Apply with `git am`. Adds:
- Valid plugin manifests
- Real Claude Code hooks (hooks/hooks.json → plugin-dist/*.mjs)
- Bundled MCP server
- userConfig for `lookout_level` and `auto_scan`
- MCP-backed commands
- Lifecycle using `uip solution …`
- CI checks
- Docs set

**Steps:**
1. [ ] Receive `omu-c-claude-plugin.patch`
2. [ ] `git am` the patch; resolve conflicts in favour of patch structure
3. [ ] Report any conflicts resolved and what was changed
4. [ ] `npm run build` — confirm clean
5. [ ] `npm test` — confirm passing
6. [ ] `npm run test:hooks` — confirm passing
7. [ ] `claude plugin validate .` — confirm valid
8. [ ] Bump version, update docs, report

**Gate:** All checks green before proceeding.

---

## Phase 1 — Make the Lookout Trustworthy

**Status:** 🔨 In Progress

The current lookout has loose regexes that fire on free text, no policy file,
no audit trail, and no environment awareness. Fix all of that.

### 1.1 Extract to standalone package
- [ ] Create `packages/lookout/` with own `package.json`, `README.md`, `tsconfig.json`
- [ ] Move core scanning logic there; omu-c imports it
- [ ] Other projects can `npm install @omu-c/lookout` independently

### 1.2 Command-aware parsing (replace loose regexes)
- [ ] Implement `uip` command tokenizer: split into resource path + verb + flags
- [ ] e.g. `uip orchestrator queues delete --name MyQueue` → `{ resource: "orchestrator.queues", verb: "delete", flags: { name: "MyQueue" } }`
- [ ] Apply rules only to real `uip` invocations, not free text
- [ ] "Delete the queue after processing" (English sentence) → **no finding**
- [ ] `uip orchestrator queues delete` → **finding**
- [ ] Handle `uip` aliases/shorthands (`uip or` = `uip orchestrator`, etc.)

### 1.3 Policy file (`.omu/lookout.yaml`)
- [ ] Schema: rules per environment (dev/staging/prod) with allow/ask/deny
- [ ] Default policy:
  - Destructive ops on prod → **deny**
  - Destructive ops elsewhere → **ask**
  - publish/deploy without `--tenant` or `--folder` → **ask**
  - `--force` / `--yes` on prod → **deny**
  - Secret in file write → **ask**
- [ ] Merge: `.omu/lookout.yaml` overrides defaults; user can relax or tighten
- [ ] CLI: `omu-c config lookout` to show effective policy

### 1.4 Secrets detection in file writes
- [ ] Hook into `edit`/`write` tool calls via pre-tool-use
- [ ] Scan file content before writing: `.xaml`, `.cs`, `.json`, `.config`, `.env`
- [ ] On detection → **ask** by default
- [ ] Suggest Orchestrator Asset name to use instead
- [ ] Never log secret values (audit log shows type only)

### 1.5 Preview skill warning on prod
- [ ] Read `assets/skill-status.json` from upstream UiPath skills
- [ ] When active skill is `Preview` or `In-development` AND target env is prod → **warn**
- [ ] Finding includes skill name, status, and advice to use GA skill

### 1.6 Audit log
- [ ] Append every decision to `.omu/lookout-audit.jsonl`
- [ ] Fields: `{ time, tool, command, findings[], decision, env }`
- [ ] **Never log secret values** — redact to `<redacted:type>`
- [ ] Rotate on size (>1MB → `.omu/lookout-audit.jsonl.1`)

### 1.7 Test corpus (80+ cases)
- [ ] Create `packages/lookout/corpus/` with categorized test cases:
  - `destructive-real.jsonl` — real `uip` destructive commands (should fire)
  - `destructive-near-miss.jsonl` — English text mentioning delete/queue (should NOT fire)
  - `secrets-real.jsonl` — files with hardcoded secrets
  - `secrets-clean.jsonl` — files that look similar but are safe
  - `production-flags.jsonl` — --force/--yes with and without env context
  - `scope-violations.jsonl` — missing --tenant/--folder
  - `safe-commands.jsonl` — benign uip commands (should be clear)
- [ ] Run corpus against lookout, compute precision/recall per category
- [ ] Report in `docs/lookout-benchmark.md`
- [ ] **Targets:** zero misses on destructive-on-prod, <5% false positives overall
- [ ] Report honestly if targets missed

**Gate:** `npm run build && npm test && npm run test:hooks` all green, benchmark reported.

---

## Phase 2 — Real Parallel Multi-Agent (Speed)

**Status:** ⏳ Pending (Phase 2 description was cut off; inferred from context)

Current state: `omu-c team` writes `inbox.md` files that nothing reads.
Autopilot stages run sequentially. Neither provides real parallelism.

### 2.1 Replace dead inbox.md with real execution
- [ ] Team workers actually spawn child processes (for CLI) or sub-agents (for native)
- [ ] `inbox.md` becomes a status/tracking file, not the execution mechanism
- [ ] Workers report results back via structured output (JSON), not unmonitored markdown

### 2.2 Parallel autopilot stages
- [ ] Identify stages that can run concurrently (e.g. ralplan produces plan; independent plan items can execute in parallel)
- [ ] Implement a DAG-based stage runner: stages declare dependencies, run concurrently when possible
- [ ] Example: if ralplan produces 3 independent tasks, spawn 3 workers

### 2.3 Progress visibility
- [ ] Real-time status of workers (active/completed/failed)
- [ ] Structured logging of parallel execution
- [ ] Timeout and cancellation support

### 2.4 Integration with Lookout
- [ ] Before spawning any parallel worker, run lookout scan
- [ ] If verdict is `deny`, don't spawn
- [ ] If verdict is `ask`, prompt user before spawning

**Gate:** `npm run build && npm test`, parallel execution benchmarked vs sequential.

---

## Ground Rules (always active)

- Never copy or modify upstream skill content. Call the skills and the real `uip` binary.
- Never invent a `uip` command or flag. Verify with `uip <command> --help` and matching upstream SKILL.md.
- Mark anything unverifiable and tell Lau.
- After each phase: `npm run build && npm test && npm run test:hooks && claude plugin validate .`, update docs, bump version, report real numbers.
