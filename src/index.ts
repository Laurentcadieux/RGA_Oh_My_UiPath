/**
 * oh-my-uipath — Core exports
 *
 * Multi-agent orchestration for UiPath + Claude Code,
 * adapted from oh-my-claudecode patterns.
 */

// Skill registry
export { createSkillRegistry, type BuiltinSkill, type SkillRegistry } from "./skills/registry.js";
export { parseFrontmatter, type SkillFrontmatter } from "./skills/frontmatter.js";

// Autopilot pipeline
export {
  createPipeline,
  validateWorkflowStages,
  type PipelineStageAdapter,
  type PipelineStageId,
  type PipelineStageState,
  type PipelineContext,
  type Pipeline,
} from "./pipeline/adapter.js";
export { ralplanAdapter } from "./pipeline/stages/ralplan.js";
export { executionAdapter } from "./pipeline/stages/execution.js";
export { ralphAdapter } from "./pipeline/stages/ralph.js";
export { qaAdapter } from "./pipeline/stages/qa.js";

// Ask providers
export {
  createAskRouter,
  type AskProvider,
  type AskProviderContract,
} from "./ask/router.js";
export { uipathProvider } from "./ask/providers/uipath.js";

// Team orchestration
export {
  createTeamOrchestrator,
  type TeamOrchestrator,
  type TeamWorker,
  type TeamPaths,
} from "./team/orchestrator.js";

// uipathcli tool surface
export {
  isUipAvailable,
  getUipVersion,
  uipExec,
  uipSkillExec,
  listAvailableSkills,
  isSkillAvailable,
  orchestrator,
  identity,
  studio,
  type UipExecutionResult,
  type UipOptions,
} from "./uipathcli/index.js";

// Sub-agent dispatcher
export {
  createSubAgentDispatcher,
  type SubAgentInvocation,
  type SubAgentResult,
  type SubAgentDispatcher,
} from "./skills/sub-agent.js";

// Config
export { loadConfig, type OmUConfig } from "./config/loader.js";

// Lookout
export {
  scanLookout,
  type LookoutFinding,
  type LookoutReport,
} from "./lookout/index.js";

// CLI
export { run as runCli } from "./cli/index.js";
