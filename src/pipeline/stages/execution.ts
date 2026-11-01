/**
 * Execution stage adapter — UiPath skill-driven implementation
 *
 * Routes implementation steps to the appropriate UiPath skills
 * based on the ralplan's skill assignments.
 */

import type { PipelineStageAdapter, PipelineContext } from "../adapter.js";

export const executionAdapter: PipelineStageAdapter = {
  id: "execution",
  name: "UiPath Execution",
  completionSignal: "PIPELINE_EXECUTION_COMPLETE",

  shouldSkip() {
    return false;
  },

  getPrompt(context) {
    const planOutput = context.stageOutputs.get("ralplan") ?? "(no plan found — execute the task directly)";

    return `# Execution — UiPath Skill-Driven Implementation

You are the execution stage of the oh-my-UiPath autopilot.

## Task
${context.task}

## Plan
${planOutput}

## Available UiPath Skills
${context.uipSkillsAvailable.length > 0 ? context.uipSkillsAvailable.map(s => `- \`${s}\``).join("\n") : "- No UiPath skills installed"}

## Your Job
1. **Read the plan** from the ralplan stage output above
2. **Execute each step** using the assigned UiPath skills:
   - For **uipath-rpa** steps: use \`uip rpa build\`, \`uip rpa pack\`, \`uip rpa run\`, \`uip rpa test\`
   - For **uipath-agents** steps: use \`uip codedagent\`, \`uip agent\`, \`uip eval\`
   - For **uipath-platform** steps: use \`uip or\`, \`uip login\`, \`uip skills\`
   - For **uipath-solution** steps: use \`uip solution init/pack/publish/deploy/activate\`
   - For **uipath-maestro-flow** steps: use \`uip maestro\` flow commands
   - For **uipath-test** steps: use \`uip tm\` test commands
   - For other steps: implement directly using Claude's coding capabilities
3. **Verify each step** — run build/test commands after implementation
4. **Handle failures** — if a step fails, diagnose and retry (max 3 attempts per step)
5. **Record results** — track what was done, what succeeded, what failed

## Execution Mode
${context.config.execution === "team" ? "TEAM mode — spawn workers for parallel implementation" : "SOLO mode — implement sequentially in the lead session"}

When all steps are complete, emit: PIPELINE_EXECUTION_COMPLETE`;
  },
};
