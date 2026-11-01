/**
 * Parallel Pipeline — DAG-based stage runner with concurrent execution
 *
 * Replaces the sequential-only pipeline with one that can run
 * independent stages in parallel. Stages declare their dependencies;
 * the runner builds a DAG and executes stages concurrently when possible.
 *
 * Example: ralplan produces a plan with 3 independent tasks →
 *   3 execution workers spawn in parallel instead of sequentially.
 */

import {
  type PipelineStageId,
  type PipelineStageStatus,
  type PipelineStageState,
  type PipelineContext,
  type PipelineStageAdapter,
  type Pipeline,
} from "./adapter.js";

import { scan, type LookoutResult, DEFAULT_POLICY, type Policy } from "../../packages/lookout/dist/index.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface StageNode {
  id: PipelineStageId;
  adapter: PipelineStageAdapter;
  /** Stage IDs that must complete before this stage can run */
  dependencies: PipelineStageId[];
  /** Parallel group — stages in the same group with no inter-dependencies run concurrently */
  parallelGroup?: string;
}

export interface ParallelPipelineResult {
  stages: PipelineStageState[];
  totalDurationMs: number;
  /** How many stages ran in parallel at peak */
  peakConcurrency: number;
  /** Whether any stage was blocked by Lookout */
  blockedStages: PipelineStageId[];
}

// ─── DAG builder ──────────────────────────────────────────────────────

/**
 * Build a stage DAG from adapters with explicit dependencies.
 *
 * Default dependency chain: ralplan → execution → ralph → qa
 * But if the ralplan output declares independent tasks,
 * execution can be split into parallel workers.
 */
export function buildStageDag(
  stages: PipelineStageAdapter[],
  overrides?: Partial<Record<PipelineStageId, { dependencies: PipelineStageId[]; parallelGroup?: string }>>
): StageNode[] {
  const nodes: StageNode[] = [];

  // Default dependency chain
  const defaultDeps: Record<PipelineStageId, PipelineStageId[]> = {
    ralplan: [],
    execution: ["ralplan"],
    ralph: ["execution"],
    qa: ["ralph"],
  };

  for (const stage of stages) {
    const override = overrides?.[stage.id];
    nodes.push({
      id: stage.id,
      adapter: stage,
      dependencies: override?.dependencies ?? defaultDeps[stage.id] ?? [],
      parallelGroup: override?.parallelGroup,
    });
  }

  return nodes;
}

/**
 * Topological sort of stages respecting dependencies.
 * Returns stages grouped by execution wave (stages in the same wave can run in parallel).
 */
export function topologicalSort(nodes: StageNode[]): StageNode[][] {
  const waves: StageNode[][] = [];
  const completed = new Set<PipelineStageId>();

  let remaining = [...nodes];

  while (remaining.length > 0) {
    // Find all nodes whose dependencies are satisfied
    const wave = remaining.filter(
      (node) => node.dependencies.every((dep) => completed.has(dep))
    );

    if (wave.length === 0) {
      // Circular dependency — break by taking the first remaining
      waves.push([remaining[0]]);
      completed.add(remaining[0].id);
      remaining = remaining.slice(1);
      continue;
    }

    waves.push(wave);
    for (const node of wave) {
      completed.add(node.id);
    }
    remaining = remaining.filter((r) => !completed.has(r.id));
  }

  return waves;
}

// ─── Parallel runner ──────────────────────────────────────────────────

/**
 * Run a pipeline with parallel stage execution.
 *
 * Stages in the same wave (no inter-dependencies) run concurrently.
 * Each stage is gated through the Lookout before execution.
 */
export async function runParallelPipeline(
  stages: PipelineStageAdapter[],
  context: PipelineContext,
  options: {
    dagOverrides?: Partial<Record<PipelineStageId, { dependencies: PipelineStageId[]; parallelGroup?: string }>>;
    policy?: Policy;
    maxConcurrency?: number;
  } = {}
): Promise<ParallelPipelineResult> {
  const startTime = Date.now();
  const policy = options.policy ?? DEFAULT_POLICY;
  const maxConcurrency = options.maxConcurrency ?? 4;

  const nodes = buildStageDag(stages, options.dagOverrides);
  const waves = topologicalSort(nodes);

  // Initialize state
  const state: PipelineStageState[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    status: "pending",
  }));

  const blockedStages: PipelineStageId[] = [];
  let peakConcurrency = 0;

  const stageOutputs = new Map<PipelineStageId, string>();

  for (const wave of waves) {
    // ── Lookout gate: scan all tasks in this wave ──

    const waveTasks = wave
      .map((n) => n.adapter.getPrompt(context))
      .filter(Boolean);

    if (waveTasks.length > 0) {
      const combinedTask = waveTasks.join("\n");
      const scanResult: LookoutResult = await scan(combinedTask, { policy });

      if (scanResult.verdict === "blocked") {
        // Block all stages in this wave
        for (const node of wave) {
          const s = state.find((s) => s.id === node.id);
          if (s) {
            s.status = "failed";
            s.error = `Lookout blocked: ${scanResult.findings.map((f) => f.title).join("; ")}`;
          }
          blockedStages.push(node.id);
        }
        continue; // Skip this wave entirely
      }
    }

    // ── Execute wave (respecting maxConcurrency) ──

    const activeStages = wave.filter((node) => {
      const s = state.find((s) => s.id === node.id);
      return s?.status === "pending";
    });

    peakConcurrency = Math.max(peakConcurrency, activeStages.length);

    // Split into batches
    for (let i = 0; i < activeStages.length; i += maxConcurrency) {
      const batch = activeStages.slice(i, i + maxConcurrency);

      await Promise.all(
        batch.map(async (node) => {
          const s = state.find((s) => s.id === node.id);
          if (!s) return;

          // Skip check
          if (node.adapter.shouldSkip(context)) {
            s.status = "skipped";
            return;
          }

          // Enter
          s.status = "active";
          s.startedAt = Date.now();
          await node.adapter.onEnter?.(context);

          // The stage's work happens between onEnter and onExit.
          // In the real integration, the prompt is sent to the LLM
          // and the response is collected. Here we simulate completion.

          // Exit
          s.status = "complete";
          s.completedAt = Date.now();
          await node.adapter.onExit?.(context);

          // Store output (placeholder — real implementation gets output from LLM)
          stageOutputs.set(node.id, `Stage ${node.id} completed`);
          context.stageOutputs = stageOutputs;
        })
      );
    }
  }

  return {
    stages: state,
    totalDurationMs: Date.now() - startTime,
    peakConcurrency,
    blockedStages,
  };
}

// ─── Convenience: compare sequential vs parallel ──────────────────────

/**
 * Benchmark sequential vs parallel execution for a given pipeline.
 * Returns timing comparison.
 */
export async function benchmarkSequentialVsParallel(
  stages: PipelineStageAdapter[],
  context: PipelineContext,
  simulateStageMs: number = 1000
): Promise<{
  sequentialMs: number;
  parallelMs: number;
  speedupFactor: number;
  waves: number;
  totalStages: number;
}> {
  const nodes = buildStageDag(stages);
  const waves = topologicalSort(nodes);

  // Sequential: all stages run one after another
  const sequentialMs = stages.length * simulateStageMs;

  // Parallel: stages within each wave run concurrently
  const parallelMs = waves.length * simulateStageMs;

  return {
    sequentialMs,
    parallelMs,
    speedupFactor: sequentialMs / parallelMs,
    waves: waves.length,
    totalStages: stages.length,
  };
}
