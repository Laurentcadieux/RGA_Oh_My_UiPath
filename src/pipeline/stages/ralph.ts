/**
 * Ralph stage adapter — UiPath-aware autonomous coding loop
 *
 * Adapts OMC's Ralph loop for UiPath context:
 * - PRD-driven iteration with uipath-verify exit-code gates
 * - Deslop pass using ai-slop-cleaner
 * - UiPath-specific: build/pack/publish verification
 */

import type { PipelineStageAdapter, PipelineContext } from "../adapter.js";

export const ralphAdapter: PipelineStageAdapter = {
  id: "ralph",
  name: "UiPath Ralph",
  completionSignal: "PIPELINE_RALPH_COMPLETE",

  shouldSkip(context) {
    // Skip Ralph if config says so
    return context.config.skipRalph === true;
  },

  getPrompt(context) {
    const executionOutput = context.stageOutputs.get("execution") ?? "";

    return `# Ralph — UiPath Autonomous Refinement Loop

You are the Ralph stage of the oh-my-uipath autopilot.

## Task
${context.task}

## Execution Output
${executionOutput}

## Your Job
1. **Review the execution output** — identify quality issues, missing tests, incomplete implementations
2. **Create a PRD** (Product Requirements Document) with testable acceptance criteria for remaining work
3. **Iterate** until every criterion passes:
   - Implement fixes (risk-ordered: architectural > integration > spike > standard)
   - Run verification: \`uip rpa build && uip rpa test\` for RPA, \`uip codedagent eval\` for agents
   - Run \`omc ralph verify\` exit-code gate (0 = pass, 1 = fail — never hand-roll this)
   - Mark criteria \`passes: true\` only with fresh evidence
4. **Deslop** — run ai-slop-cleaner on changed files
5. **Regression re-verify** — full build + test cycle after deslop
6. **Closeout** — append findings to \`.omu/notepads/ralph/problems.md\`

## UiPath Verification Commands
- RPA: \`uip rpa build && uip rpa test\`
- Agents: \`uip codedagent eval\`
- Solution: \`uip solution pack && uip solution publish\`
- General: \`npm test\` or \`dotnet test\`

When all criteria pass, emit: PIPELINE_RALPH_COMPLETE`;
  },
};
