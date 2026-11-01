# PLAN.md — oh-my-UiPath-c Safety + Parallel Execution

**Goal:** Make omu-c clearly more valuable than upstream UiPath skills alone.
**Distinct value:** Trustworthy safety layer (Lookout) + real parallel execution speed.
**Never duplicate upstream.** Call skills and `uip` binary directly.

---

## Phase 0 — Apply the Plugin Patch

**Status:** ⏳ Waiting for `omu-c-claude-plugin.patch` from Lau

Apply with `git am`. Adds valid plugin manifests, real Claude Code hooks, bundled MCP server, userConfig, lifecycle, CI, docs.

1. [ ] Receive patch file
2. [ ] `git am`, resolve conflicts in patch's favour
3. [ ] `npm run build && npm test && npm run test:hooks && claude plugin validate .`
4. [ ] Bump version, update docs, report

---

## Phase 1 — Make the Lookout Trustworthy

**Status:** ✅ Complete (v0.4.0, commit `a6df7b2`)

| Item | Result |
|------|--------|
| Standalone package (`packages/lookout/`) | ✅ Own package.json, tsconfig, reusable |
| Command-aware tokenizer | ✅ Real `uip` invocations only; English text ignored |
| Policy file (`.omu/lookout.yaml`) | ✅ env-aware allow/ask/deny; dev=ask, prod=deny |
| Secrets detection | ✅ Hardcoded passwords, API keys, tokens; suggests Orchestrator Assets |
| Preview skill warning | ✅ Reads upstream skill-status.json; warns on prod |
| Audit log | ✅ `.omu/lookout-audit.jsonl`, redacted, rotated at 1MB |
| Test corpus (99 cases) | ✅ 100% accuracy, 0% false positives, 15/15 destructive-on-prod blocked |

Benchmark: `docs/lookout-benchmark.md`

---

## Phase 2 — Real Parallel Multi-Agent Execution

**Status:** ✅ Complete (v0.5.0, commit `baa0943`)

| Item | Result |
|------|--------|
| Real worker execution | ✅ CLI workers spawn child processes, return structured JSON |
| Dead inbox.md eliminated | ✅ inbox.md is now status tracking, not the execution mechanism |
| DAG-based parallel pipeline | ✅ Topological sort, concurrent waves, bounded parallelism |
| Lookout gates every spawn | ✅ Blocked tasks rejected before execution |
| Timeout & cancellation | ✅ Per-worker timeout, SIGTERM cancellation |
| Progress visibility | ✅ Structured results, status counts, peak concurrency metric |
| Native workers | ✅ Return task descriptors for Claude Code Task tool |

New files:
- `src/pipeline/parallel.ts` — DAG builder, topological sort, parallel runner, benchmark utility
- `src/team/orchestrator.ts` — rewritten with child_process execution, Lookout gating, bounded concurrency

New tests:
- `src/__tests__/parallel-pipeline.test.ts` — DAG building, topological sort, wave execution, Lookout blocking
- `src/__tests__/team-orchestrator.test.ts` — worker lifecycle, Lookout gate, parallel execution, cancellation

---

## Remaining Work

### Phase 0 — needs `omu-c-claude-plugin.patch` from Lau
- Cannot proceed without the patch file

### Optional future work
- [ ] Parallel execution integration test (real `uip` binary, not just `echo`)
- [ ] Dashboard/UI for parallel execution progress
- [ ] `.omu/lookout.yaml` editor command (`omu-c config lookout`)
- [ ] More corpus cases (edge cases, new `uip` commands)

---

## Ground Rules

- Never copy or modify upstream skill content. Call the skills and the real `uip` binary.
- Never invent a `uip` command or flag. Verify with `uip <command> --help` and matching upstream SKILL.md.
- Mark anything unverifiable and tell Lau.
- After each phase: `npm run build && npm test`, update docs, bump version, report real numbers.
