/**
 * Ask provider router — routes questions to providers including uipathcli
 *
 * Extends OMC's ask provider set with `uipath` as a provider
 * that routes through `uip` CLI commands.
 */

export interface AskProviderContract {
  name: string;
  binary: string;
  /** Build the args array for this provider */
  buildArgs(prompt: string, options: AskOptions): string[];
  /** Check if this provider is available on the system */
  isAvailable(): Promise<boolean>;
  /** Per-provider quirks (timeout, signal handling, etc.) */
  quirks?: {
    timeout?: number;
    killSignal?: string;
    promptFile?: boolean; // some providers need --prompt-file instead of -p
  };
}

export interface AskOptions {
  agentPrompt?: string; // role prompt file to prepend
  model?: string;
  timeout?: number;
}

export interface AskProvider {
  name: string;
  contract: AskProviderContract;
}

/** Built-in provider contracts (OMC-compatible + uipath) */
const PROVIDER_CONTRACTS: Record<string, AskProviderContract> = {
  claude: {
    name: "claude",
    binary: "claude",
    buildArgs: (prompt, opts) => {
      const args = ["--print"];
      if (opts.model) args.push("--model", opts.model);
      if (opts.agentPrompt) args.push("--agent-prompt", opts.agentPrompt);
      args.push(prompt);
      return args;
    },
    isAvailable: async () => {
      try {
        const { access } = await import("node:fs/promises");
        await access("/usr/local/bin/claude");
        return true;
      } catch { return false; }
    },
  },
  codex: {
    name: "codex",
    binary: "codex",
    buildArgs: (prompt, opts) => {
      const args = ["exec", "--dangerously-bypass-approvals-and-sandbox"];
      if (opts.model) args.push("--model", opts.model);
      if (opts.agentPrompt) args.push("--agent-prompt", opts.agentPrompt);
      args.push(prompt);
      return args;
    },
    isAvailable: async () => {
      try {
        const { access } = await import("node:fs/promises");
        await access("/usr/local/bin/codex");
        return true;
      } catch { return false; }
    },
    quirks: { timeout: 120_000 },
  },
  uipath: {
    name: "uipath",
    binary: "uip",
    buildArgs: (prompt, _opts) => {
      // Route uipathcli as a provider — interpret prompt as a uip command
      // e.g. "ask uipath orchestrator jobs get" → uip orchestrator jobs get
      const parts = prompt.trim().split(/\s+/);
      return parts;
    },
    isAvailable: async () => {
      try {
        const { access } = await import("node:fs/promises");
        await access("/usr/local/bin/uip");
        return true;
      } catch { return false; }
    },
    quirks: { timeout: 60_000 },
  },
};

export function createAskRouter(
  customContracts?: Record<string, AskProviderContract>
): {
  route: (provider: string, prompt: string, options: AskOptions) => {
    contract: AskProviderContract;
    args: string[];
  };
  getAvailable: () => Promise<AskProvider[]>;
  listProviders: () => string[];
} {
  const contracts = { ...PROVIDER_CONTRACTS, ...customContracts };

  return {
    route: (provider, prompt, options) => {
      const contract = contracts[provider];
      if (!contract) {
        throw new Error(
          `Unknown provider: ${provider}. Available: ${Object.keys(contracts).join(", ")}`
        );
      }
      return {
        contract,
        args: contract.buildArgs(prompt, options),
      };
    },

    getAvailable: async () => {
      const available: AskProvider[] = [];
      for (const [name, contract] of Object.entries(contracts)) {
        if (await contract.isAvailable()) {
          available.push({ name, contract });
        }
      }
      return available;
    },

    listProviders: () => Object.keys(contracts),
  };
}
