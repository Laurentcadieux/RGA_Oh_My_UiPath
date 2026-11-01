/**
 * Claude Code Plugin Hook: post-tool-use
 *
 * Runs after tool execution. Detects UiPath project context changes
 * and triggers re-discovery if needed.
 */

import { discoverProject } from "../discovery/index.js";

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: string;
  config?: Record<string, unknown>;
}

interface HookOutput {
  message?: string;
  state?: Record<string, unknown>;
}

// Cache last known project type to detect changes
let lastProjectType: string | null = null;

export async function postToolUse(input: HookInput): Promise<HookOutput> {
  const autoScan = input.config?.autoScan !== false;

  // Only trigger on write operations that could change project structure
  const writeTools = new Set(["edit", "write", "Bash"]);
  if (!writeTools.has(input.tool_name)) {
    return {};
  }

  if (!autoScan) return {};

  // Check if the operation touched UiPath-relevant files
  const target = String(input.tool_input.path ?? input.tool_input.command ?? "");
  const uipathExtensions = [".xaml", ".cs", ".uipx", ".json"];
  const isRelevant = uipathExtensions.some(ext => target.includes(ext));

  if (!isRelevant) return {};

  // Re-discover the project
  try {
    const discovery = await discoverProject();
    if (discovery.type !== lastProjectType && discovery.type !== "unknown") {
      lastProjectType = discovery.type;
      return {
        message: `🔄 UiPath project detected: ${discovery.type} → use skill ${discovery.suggestedSkill}`,
        state: {
          uipathProjectType: discovery.type,
          uipathSuggestedSkill: discovery.suggestedSkill,
          uipathConfidence: discovery.confidence,
        },
      };
    }
  } catch { /* ignore discovery errors */ }

  return {};
}
