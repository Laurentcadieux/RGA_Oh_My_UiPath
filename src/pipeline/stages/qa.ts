/**
 * QA stage adapter — UiPath-aware quality assurance
 *
 * Multi-perspective validation using UiPath review + test skills.
 */

import type { PipelineStageAdapter, PipelineContext } from "../adapter.js";

export const qaAdapter: PipelineStageAdapter = {
  id: "qa",
  name: "UiPath QA",
  completionSignal: "PIPELINE_QA_COMPLETE",

  shouldSkip(context) {
    return context.config.skipQa === true;
  },

  getPrompt(context) {
    const executionOutput = context.stageOutputs.get("execution") ?? "";
    const ralphOutput = context.stageOutputs.get("ralph") ?? "";

    return `# QA — UiPath Quality Assurance

You are the QA stage of the oh-my-UiPath autopilot.

## Task
${context.task}

## Execution Summary
${executionOutput}

${ralphOutput ? `## Ralph Refinements\n${ralphOutput}` : ""}

## Your Job
1. **Run full test suite** — \`uip rpa test\`, \`uip tm executions\`, \`npm test\`
2. **Structural review** — if uipath-review skill is available, use it for cross-skill quality review
3. **Security review** — check for hardcoded credentials, exposed secrets, unsafe API patterns
4. **UiPath-specific checks**:
   - Package integrity: \`uip solution pack\` succeeds
   - Dependency resolution: no missing activities or packages
   - Orchestrator compatibility: target tenant/version checks
   - Robot compatibility: target robot version checks
5. **Acceptance criteria verification** — every criterion from the PRD must pass
6. **Max 5 QA cycles** — if issues found, fix and re-verify (3-strike stop per issue)

When all checks pass, emit: PIPELINE_QA_COMPLETE`;
  },
};
