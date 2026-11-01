/**
 * Config loader — layered JSONC merge with UiPath config bridging
 *
 * Precedence (same as OMC):
 *   defaults ← user config ← project config ← env ← uipath config
 *
 * The uipath bridge reads ~/.uipath/config (YAML) and merges
 * relevant profile data (org, tenant, auth) into the omu config.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface OmUConfig {
  /** Agent model assignments */
  agents?: Record<string, { model?: string }>;
  /** Feature flags */
  features?: {
    parallelExecution?: boolean;
    continuationEnforcement?: boolean;
  };
  /** Autopilot settings */
  autopilot?: {
    maxIterations?: number;
    maxQaCycles?: number;
    execution?: "solo" | "team";
    team?: { agentTypes?: string[] };
    skipRalph?: boolean;
    skipQa?: boolean;
    /** Named workflow profiles (atomic, project replaces user) */
    workflows?: Record<string, {
      version: 1;
      stages: string[];
    }>;
  };
  /** Quality gates per stage */
  qualityGates?: Record<string, string[]>;
  /** Ask provider config */
  ask?: {
    defaultProvider?: string;
    providers?: Record<string, { model?: string }>;
  };
  /** UiPath-specific config (bridged from ~/.uipath/config) */
  uipath?: {
    org?: string;
    tenant?: string;
    profile?: string;
    cliPath?: string;
    skillsDir?: string;
  };
  /** Permissions */
  permissions?: {
    allowBash?: boolean;
    allowEdit?: boolean;
    allowWrite?: boolean;
  };
}

function buildDefaultConfig(): OmUConfig {
  return {
    agents: {},
    features: {
      parallelExecution: true,
      continuationEnforcement: true,
    },
    autopilot: {
      maxIterations: 50,
      maxQaCycles: 5,
      execution: "solo",
      skipRalph: false,
      skipQa: false,
      workflows: {},
    },
    qualityGates: {},
    ask: {
      defaultProvider: "claude",
    },
    uipath: {},
    permissions: {
      allowBash: true,
      allowEdit: true,
      allowWrite: true,
    },
  };
}

/** Deep merge (same semantics as OMC's deepMerge) */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Strip JSONC comments (simple — handles // and /* *\/) */
function stripJsonc(content: string): string {
  // Remove single-line comments (not inside strings)
  let result = content.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  return result;
}

/** Parse YAML config from ~/.uipath/config (minimal) */
function parseUipathYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  let currentProfile = "default";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Detect profile header
    const profileMatch = trimmed.match(/^(\w+):$/);
    if (profileMatch) {
      currentProfile = profileMatch[1];
      continue;
    }

    // Detect key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      if (!result[currentProfile]) result[currentProfile] = {};
      (result[currentProfile] as Record<string, unknown>)[kvMatch[1]] = kvMatch[2].replace(/^['"]|['"]$/g, "");
    }
  }

  return result;
}

export async function loadConfig(options?: {
  projectDir?: string;
  userConfigDir?: string;
}): Promise<OmUConfig> {
  const projectDir = options?.projectDir ?? process.cwd();
  const userConfigDir = options?.userConfigDir ?? join(homedir(), ".config", "omu");

  let config: OmUConfig = buildDefaultConfig();

  // Layer 1: user config
  const userConfigPath = join(userConfigDir, "config.jsonc");
  if (existsSync(userConfigPath)) {
    try {
      const content = await readFile(userConfigPath, "utf-8");
      const parsed = JSON.parse(stripJsonc(content));
      config = deepMerge(config as Record<string, unknown>, parsed) as OmUConfig;
    } catch { /* ignore parse errors */ }
  }

  // Layer 2: project config
  const projectConfigPath = join(projectDir, ".omu", "config.jsonc");
  if (existsSync(projectConfigPath)) {
    try {
      const content = await readFile(projectConfigPath, "utf-8");
      const parsed = JSON.parse(stripJsonc(content));
      config = deepMerge(config as Record<string, unknown>, parsed) as OmUConfig;
    } catch { /* ignore parse errors */ }
  }

  // Layer 3: UiPath config bridge
  const uipathConfigPath = join(homedir(), ".uipath", "config");
  if (existsSync(uipathConfigPath)) {
    try {
      const content = await readFile(uipathConfigPath, "utf-8");
      const uipConfig = parseUipathYaml(content);
      const profile = config.uipath?.profile ?? "default";
      const profileData = uipConfig[profile] as Record<string, unknown> | undefined;
      if (profileData) {
        config.uipath = {
          ...config.uipath,
          org: (profileData?.organization as string) ?? config.uipath?.org,
          tenant: (profileData?.tenant as string) ?? config.uipath?.tenant,
        };
      }
    } catch { /* ignore parse errors */ }
  }

  // Layer 4: env overrides
  const envOrg = process.env.OMU_UIPATH_ORG ?? process.env.UIPATH_ORGANIZATION;
  const envTenant = process.env.OMU_UIPATH_TENANT ?? process.env.UIPATH_TENANT;
  if (envOrg) config.uipath = { ...config.uipath, org: envOrg };
  if (envTenant) config.uipath = { ...config.uipath, tenant: envTenant };

  return config;
}
