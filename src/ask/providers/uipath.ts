/**
 * UiPath ask provider — routes questions through uipathcli
 *
 * This is the key integration point: `uip` commands become
 * ask-able providers, so you can do:
 *   omu ask uipath "orchestrator jobs get"
 *   omu ask uipath "identity user list"
 */

import type { AskProviderContract } from "../router.js";

export const uipathProvider: AskProviderContract = {
  name: "uipath",
  binary: "uip",

  buildArgs(prompt, options) {
    const parts = prompt.trim().split(/\s+/);

    // If agent-prompt is specified, it maps to a uipath skill
    // e.g. --agent-prompt rpa → uip rpa <command>
    if (options.agentPrompt) {
      const skillMap: Record<string, string> = {
        rpa: "rpa",
        agents: "codedagent",
        platform: "or",
        admin: "admin",
        solution: "solution",
        test: "tm",
        maestro: "maestro",
        ixp: "ixp",
        insights: "insights",
      };
      const uipCommand = skillMap[options.agentPrompt] ?? options.agentPrompt;
      return [uipCommand, ...parts];
    }

    return parts;
  },

  async isAvailable() {
    try {
      const { exec } = await import("node:child_process/promises");
      await exec("which uip");
      return true;
    } catch {
      return false;
    }
  },

  quirks: {
    timeout: 60_000,
  },
};
