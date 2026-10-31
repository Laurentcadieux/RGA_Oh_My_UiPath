/**
 * Autopilot pipeline adapter
 *
 * Mirrors OMC's PipelineStageAdapter interface but with
 * UiPath-aware stage implementations.
 */

export type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";

export type PipelineStageStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "skipped";

export interface PipelineStageState {
  id: PipelineStageId;
  name: string;
  status: PipelineStageStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface PipelineContext {
  /** The user's task prompt */
  task: string;
  /** Workspace root directory */
  workspaceRoot: string;
  /** .omu state directory */
  stateDir: string;
  /** Session ID */
  sessionId: string;
  /** Config (merged) */
  config: Record<string, unknown>;
  /** Previous stage outputs */
  stageOutputs: Map<PipelineStageId, string>;
  /** UiPath CLI available? */
  uipAvailable: boolean;
  /** UiPath skill commands available? */
  uipSkillsAvailable: string[];
}

export interface PipelineStageAdapter {
  id: PipelineStageId;
  name: string;
  /** Signal the LLM emits when this stage is done */
  completionSignal: string;
  /** Whether to skip this stage given current config */
  shouldSkip(context: PipelineContext): boolean;
  /** Prompt to inject into the lead agent for this stage */
  getPrompt(context: PipelineContext): string;
  /** Hook called when stage starts */
  onEnter?(context: PipelineContext): Promise<void>;
  /** Hook called when stage completes */
  onExit?(context: PipelineContext): Promise<void>;
}

/** Admitted workflow stage sequences (matching OMC v1 contract) */
const ADMITTED_SEQUENCES: PipelineStageId[][] = [
  ["ralplan", "execution"],
  ["ralplan", "execution", "ralph"],
  ["ralplan", "execution", "qa"],
  ["ralplan", "execution", "ralph", "qa"],
];

export function validateWorkflowStages(
  stages: PipelineStageId[]
): { valid: boolean; error?: string } {
  const match = ADMITTED_SEQUENCES.find(
    (seq) => seq.length === stages.length && seq.every((s, i) => s === stages[i])
  );

  if (!match) {
    return {
      valid: false,
      error: `Invalid stage sequence: [${stages.join(", ")}]. ` +
        `Admitted: ${ADMITTED_SEQUENCES.map((s) => `[${s.join(", ")}]`).join(", ")}`,
    };
  }

  return { valid: true };
}

export interface Pipeline {
  stages: PipelineStageAdapter[];
  state: PipelineStageState[];
  currentStageIndex: number;
  advance(context: PipelineContext): Promise<{ done: boolean; stage?: PipelineStageState }>;
  cancel(): Promise<void>;
}

export async function createPipeline(
  stages: PipelineStageAdapter[],
  initialState?: PipelineStageState[]
): Promise<Pipeline> {
  const state: PipelineStageState[] = initialState ?? stages.map((s) => ({
    id: s.id,
    name: s.name,
    status: "pending",
  }));

  let currentStageIndex = state.findIndex((s) => s.status === "active");
  if (currentStageIndex === -1) {
    currentStageIndex = state.findIndex((s) => s.status === "pending");
  }

  return {
    stages,
    state,
    currentStageIndex,
    advance: async (context) => {
      if (currentStageIndex >= stages.length) {
        return { done: true };
      }

      const adapter = stages[currentStageIndex];
      const stageState = state[currentStageIndex];

      // Skip check
      if (adapter.shouldSkip(context)) {
        stageState.status = "skipped";
        currentStageIndex++;
        return createPipeline(stages, state).then((p) =>
          p.advance(context)
        );
      }

      // Enter stage
      if (stageState.status === "pending") {
        stageState.status = "active";
        stageState.startedAt = Date.now();
        await adapter.onEnter?.(context);
        return { done: false, stage: stageState };
      }

      // Complete stage
      if (stageState.status === "active") {
        stageState.status = "complete";
        stageState.completedAt = Date.now();
        await adapter.onExit?.(context);
        currentStageIndex++;

        if (currentStageIndex >= stages.length) {
          return { done: true };
        }

        // Advance to next
        const nextAdapter = stages[currentStageIndex];
        const nextState = state[currentStageIndex];
        if (nextAdapter.shouldSkip(context)) {
          nextState.status = "skipped";
          currentStageIndex++;
          return createPipeline(stages, state).then((p) =>
            p.advance(context)
          );
        }

        nextState.status = "active";
        nextState.startedAt = Date.now();
        await nextAdapter.onEnter?.(context);
        return { done: false, stage: nextState };
      }

      return { done: true };
    },
    cancel: async () => {
      const active = state[currentStageIndex];
      if (active && active.status === "active") {
        active.status = "failed";
        active.completedAt = Date.now();
        active.error = "Cancelled";
        await stages[currentStageIndex].onExit?.({
          task: "",
          workspaceRoot: "",
          stateDir: "",
          sessionId: "",
          config: {},
          stageOutputs: new Map(),
          uipAvailable: false,
          uipSkillsAvailable: [],
        });
      }
    },
  };
}
