# Parallel Execution

oh-my-UiPath-c runs pipeline stages in parallel when they have no inter-dependencies, instead of the old sequential-only model.

## How It Works

### DAG-Based Stage Runner

Pipeline stages declare dependencies. The runner builds a DAG and topological-sorts it into **waves** — stages within the same wave execute concurrently.

```
Wave 1:  [ralplan]
Wave 2:  [execution]  [ralph]    ← both depend only on ralplan
Wave 3:  [qa]                     ← depends on ralph
```

In the default chain (ralplan → execution → ralph → qa), there's no parallelism — each stage depends on the previous. But when ralplan produces independent tasks, the DAG can be overridden to run them concurrently.

### Overriding Dependencies

```typescript
import { runParallelPipeline } from "oh-my-UiPath-c";

const result = await runParallelPipeline(stages, context, {
  dagOverrides: {
    // ralph can start right after ralplan, not after execution
    ralph: { dependencies: ["ralplan"] },
  },
});
```

This produces 3 waves instead of 4, with execution and ralph running in parallel.

### Bounded Concurrency

Team workers execute in batches controlled by `maxConcurrency` (default: 4). This prevents resource exhaustion while still getting parallel speedup.

```typescript
const orch = await createTeamOrchestrator("my-team", stateDir, {
  maxConcurrency: 8,       // up to 8 workers simultaneously
  workerTimeoutMs: 60_000, // 1 minute per worker
});
```

## Safety Integration

Every worker spawn is gated through the Lookout **before execution**:

- **Blocked** tasks (destructive on prod) → rejected immediately, never spawned
- **Advisory** tasks (destructive on dev) → warning logged, execution proceeds
- **Clear** tasks → spawned without warning

```typescript
// This throws on prod (Lookout blocks destructive ops)
await orch.assignTask("w1", "uip orchestrator queues delete --id 42");

// This succeeds on dev (advisory warning, but execution allowed)
await orch.assignTask("w1", "uip orchestrator queues delete --id 42");
```

## Worker Types

| Type | Execution | Result |
|------|-----------|--------|
| `cli` | Spawns child process (`child_process.spawn`) | Captures stdout/stderr/exitCode, parses JSON if possible |
| `native` | Returns task descriptor for Claude Code Task tool | Structured output with task + skill info |

## API

### `runParallelPipeline(stages, context, options?)`

Returns `ParallelPipelineResult`:
- `stages` — final state of each stage
- `totalDurationMs` — wall-clock time
- `peakConcurrency` — max concurrent stages at any point
- `blockedStages` — stages blocked by Lookout

### `createTeamOrchestrator(name, stateDir, options?)`

Methods:
- `addWorker(worker)` — register a worker
- `assignTask(workerId, task)` — assign task (Lookout-gated)
- `executeWorker(workerId)` — execute single worker, wait for result
- `executeAll()` — execute all active workers in parallel batches
- `cancelWorker(workerId)` — SIGTERM a running worker
- `shutdown()` — terminate all workers

### `benchmarkSequentialVsParallel(stages, context, simulateStageMs)`

Compare theoretical sequential vs parallel execution time. Returns speedup factor.

## Replacing the Old Model

| Before | After |
|--------|-------|
| Workers write `inbox.md` files nobody reads | Workers spawn real processes, return structured JSON |
| Pipeline runs stages one-by-one | DAG-based: independent stages run concurrently |
| No timeout or cancellation | Per-worker timeout, SIGTERM cancellation |
| No safety gate before spawn | Lookout scans every task before execution |
