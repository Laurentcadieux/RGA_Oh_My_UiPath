/**
 * Ralplan stage adapter — UiPath-aware planning
 *
 * Adapts OMC's ralplan stage to:
 * 1. Detect UiPath project structure (.xaml, .cs, .uipx, agent.json)
 * 2. Run uipath-planner (PDD→SDD) if available
 * 3. Produce a consensus plan with UiPath deployment context
 */

import type { PipelineStageAdapter, PipelineContext } from "../adapter.js";

export const ralplanAdapter: PipelineStageAdapter = {
  id: "ralplan",
  name: "UiPath Ralplan",
  completionSignal: "PIPELINE_RALPLAN_COMPLETE",

  shouldSkip(context) {
    // Skip if a ralplan consensus plan already exists
    // (same shortcut as OMC: .omc/plans/ralplan-*.md → skip Phases 0+1)
    return false;
  },

  getPrompt(context) {
    const uipContext = buildUiPathContext(context);

    return `# Ralplan — UiPath-Aware Planning

You are the ralplan (rational planner) stage of the oh-my-UiPath autopilot.

## Task
${context.task}

## UiPath Context
${uipContext}

## Your Job
1. **Explore the codebase** — understand existing UiPath project structure, automation inventory, and deployment targets
2. **Identify UiPath components** — detect .xaml workflows, coded .cs files, .uipx solutions, agent.json definitions, .flow files, .bpmn processes
3. **Create a consensus plan** — decompose the task into implementation steps, identifying which UiPath skills are needed:
   - **uipath-rpa** for .xaml/.cs workflow authoring
   - **uipath-agents** for coded agent scaffolding
   - **uipath-platform** for Orchestrator operations
   - **uipath-solution** for .uipx lifecycle
   - **uipath-maestro-flow** for .flow authoring
   - **uipath-test** for test management
4. **Write the plan** to \`.omu/plans/ralplan-plan.md\` with:
   - Task decomposition
   - UiPath skill assignments per step
   - Dependencies between steps
   - Risk classification (architectural > integration > spike > standard)
   - Deployment strategy (pack → publish → deploy → activate)

When done, emit: PIPELINE_RALPLAN_COMPLETE`;
  },

  async onEnter(context) {
    // Ensure .omu/plans/ directory exists
    const { mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(context.stateDir, "plans"), { recursive: true });
  },

  async onExit() {
    // No-op — plan written by the LLM
  },
};

function buildUiPathContext(context: PipelineContext): string {
  const lines: string[] = [];

  if (context.uipAvailable) {
    lines.push("- ✅ UiPath CLI (`uip`) is available");
  } else {
    lines.push("- ❌ UiPath CLI (`uip`) is NOT available — install with: curl -fsSL https://download.uipath.com/uipath-cli/install.sh | bash");
  }

  if (context.uipSkillsAvailable.length > 0) {
    lines.push(`- Available UiPath skills: ${context.uipSkillsAvailable.join(", ")}`);
  } else {
    lines.push("- No UiPath skills installed — run: uip skills install");
  }

  return lines.join("\n");
}
