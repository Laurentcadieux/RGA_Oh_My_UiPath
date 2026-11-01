/**
 * Claude Code Plugin Hook: pre-tool-use
 *
 * Runs before any tool execution. Uses the UiPath lookout to
 * scan for dangerous operations and block/advise as configured.
 */

import { scanTask } from "../lookout/uipath-lookout.js";

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface HookOutput {
  decision: "approve" | "deny" | "advise";
  reason?: string;
  modified_input?: Record<string, unknown>;
}

export async function preToolUse(input: HookInput): Promise<HookOutput> {
  const lookoutLevel = (input.config?.lookoutLevel as string) ?? "review-recommended";

  // Only scan write/execute tools
  const scannableTools = new Set(["Bash", "execute", "shell", "edit", "write"]);
  if (!scannableTools.has(input.tool_name)) {
    return { decision: "approve" };
  }

  // Extract the command/text to scan
  const command = String(input.tool_input.command ?? input.tool_input.content ?? "");
  if (!command) return { decision: "approve" };

  const result = scanTask(command);

  if (lookoutLevel === "off") return { decision: "approve" };

  if (result.status === "block") {
    return {
      decision: "deny",
      reason: `UiPath Lookout blocked: ${result.findings.map(f => f.message).join("; ")}`,
    };
  }

  if (result.status === "review-recommended" && (lookoutLevel === "review-recommended" || lookoutLevel === "advisory")) {
    return {
      decision: "advise",
      reason: `UiPath Lookout: ${result.findings.map(f => `[${f.category}] ${f.message}`).join("; ")}`,
    };
  }

  if (result.status === "advisory" && lookoutLevel === "advisory") {
    return {
      decision: "advise",
      reason: `UiPath Lookout advisory: ${result.findings.map(f => f.message).join("; ")}`,
    };
  }

  return { decision: "approve" };
}
