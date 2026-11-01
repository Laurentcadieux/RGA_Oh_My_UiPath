/**
 * Claude Code Plugin Hook: notification
 *
 * Handles notifications from the plugin system.
 * Used for periodic checks, skill updates, and orchestrator alerts.
 */

interface HookInput {
  type: string;
  payload?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface HookOutput {
  message?: string;
  action?: string;
}

export async function notification(input: HookInput): Promise<HookOutput> {
  switch (input.type) {
    case "skill-update": {
      const skillName = input.payload?.skillName as string;
      return {
        message: `📦 UiPath skill update available: ${skillName}. Run: omu setup`,
        action: "skill-update",
      };
    }
    case "orchestrator-alert": {
      const alert = input.payload?.alert as string;
      return {
        message: `🔔 Orchestrator alert: ${alert}`,
        action: "orchestrator-alert",
      };
    }
    case "session-start": {
      // Trigger project discovery on session start
      const autoScan = input.config?.autoScan !== false;
      if (autoScan) {
        return {
          message: "🔍 Scanning for UiPath project...",
          action: "auto-discover",
        };
      }
      return {};
    }
    default:
      return {};
  }
}
