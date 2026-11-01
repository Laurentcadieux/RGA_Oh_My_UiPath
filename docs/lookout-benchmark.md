# Lookout Benchmark Results

**Date:** 2026-11-01
**Lookout version:** 0.1.0
**Corpus size:** 99 cases across 10 categories

## Results

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Overall accuracy | 100.0% | >90% | ✅ |
| False positive rate | 0.0% | <5% | ✅ |
| Destructive-on-prod accuracy | 100.0% | 100% | ✅ |

## Per-Category Breakdown

| Category | Cases | Correct | Accuracy | FP | FN |
|----------|-------|---------|----------|----|----|
| destructive-real | 15 | 15 | 100.0% | 0 | 0 |
| destructive-near-miss | 15 | 15 | 100.0% | 0 | 0 |
| dangerous-flags | 5 | 5 | 100.0% | 0 | 0 |
| scope-violations | 7 | 7 | 100.0% | 0 | 0 |
| generic-destructive | 6 | 6 | 100.0% | 0 | 0 |
| safe-commands | 15 | 15 | 100.0% | 0 | 0 |
| safe-english | 12 | 12 | 100.0% | 0 | 0 |
| secrets-real | 10 | 10 | 100.0% | 0 | 0 |
| secrets-clean | 10 | 10 | 100.0% | 0 | 0 |
| compound-commands | 4 | 4 | 100.0% | 0 | 0 |

## Key Findings

1. **Zero false positives on near-miss corpus.** English sentences mentioning "delete", "queue", "robot", "remove", etc. do NOT trigger the scanner. Only real `uip` command invocations do. This is the core improvement over the old regex-based scanner.

2. **All destructive operations blocked on prod.** With `environment: prod` in the policy, every destructive `uip` command (delete, remove, purge, deactivate, unpublish, stop, kill, disable) is denied.

3. **Scope violations detected.** Deploy/publish/activate without `--folder` or `--tenant` flags trigger findings.

4. **Secret patterns detected without false positives.** Hardcoded passwords, API keys, tokens, connection strings, AWS keys, and GitHub tokens are caught. The "clean" corpus (password field names without values, comments about secrets, etc.) produces zero findings.

## How to Reproduce

```bash
cd packages/lookout
npx tsc
node --experimental-strip-types __tests__/benchmark.ts
```
