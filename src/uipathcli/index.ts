/**
 * uipathcli tool surface — typed wrapper around `uip` CLI commands
 *
 * Every Orchestrator/Identity/DU/Studio operation goes through here.
 * This is the bridge between the orchestration layer and uipathcli.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(_execFile);
import { access } from "node:fs/promises";

export interface UipExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** JMESPath-filtered if --query was used */
  data?: unknown;
}

export interface UipOptions {
  /** Profile name (default: "default") */
  profile?: string;
  /** Output format */
  output?: "json" | "text";
  /** JMESPath query */
  query?: string;
  /** Wait expression for async ops */
  wait?: string;
  /** Wait timeout in seconds */
  waitTimeout?: number;
  /** Debug mode */
  debug?: boolean;
  /** Org override */
  organization?: string;
  /** Tenant override */
  tenant?: string;
  /** Timeout for the child process (ms) */
  timeout?: number;
}

const UIP_BINARY = "uip";
const DEFAULT_TIMEOUT = 60_000;

/** Check if `uip` is available on the system */
export async function isUipAvailable(): Promise<boolean> {
  try {
    await execFile(UIP_BINARY, ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Get `uip` version */
export async function getUipVersion(): Promise<string> {
  const { stdout } = await execFile(UIP_BINARY, ["--version"], { timeout: 10_000 });
  return stdout.trim();
}

/** Build common flags from options */
function buildFlags(opts: UipOptions = {}): string[] {
  const flags: string[] = [];
  if (opts.profile) flags.push("--profile", opts.profile);
  if (opts.output) flags.push("--output", opts.output);
  if (opts.query) flags.push("--query", opts.query);
  if (opts.wait) flags.push("--wait", opts.wait);
  if (opts.waitTimeout) flags.push("--wait-timeout", String(opts.waitTimeout));
  if (opts.debug) flags.push("--debug");
  if (opts.organization) flags.push("--organization", opts.organization);
  if (opts.tenant) flags.push("--tenant", opts.tenant);
  return flags;
}

/**
 * Execute a raw `uip` command
 *
 * @example
 * ```ts
 * const result = await uipExec(["orchestrator", "jobs", "get"], { output: "json" });
 * ```
 */
export async function uipExec(
  args: string[],
  opts: UipOptions = {}
): Promise<UipExecutionResult> {
  const fullArgs = [...args, ...buildFlags(opts)];
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

  try {
    const { stdout, stderr } = await execFile(UIP_BINARY, fullArgs, { timeout, maxBuffer: 10 * 1024 * 1024 });
    let data: unknown | undefined;
    if (opts.output === "json" || (!opts.output && stdout.trim().startsWith("{"))) {
      try { data = JSON.parse(stdout); } catch { /* not JSON */ }
    }
    return { stdout, stderr, exitCode: 0, data };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    };
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────

export const orchestrator = {
  /** List/get jobs */
  jobs: {
    get: (opts?: UipOptions) => uipExec(["orchestrator", "jobs", "get"], opts),
    start: (opts?: UipOptions) => uipExec(["orchestrator", "jobs", "start-jobs"], opts),
    stop: (opts?: UipOptions) => uipExec(["orchestrator", "jobs", "stop-jobs"], opts),
  },

  /** Queue operations */
  queues: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "queuedefinitions", "get"], opts),
    addItem: (opts?: UipOptions) => uipExec(["orchestrator", "queueitems", "post"], opts),
  },

  /** Assets (orchestrator assets) */
  assets: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "assets", "get"], opts),
    get: (opts?: UipOptions) => uipExec(["orchestrator", "assets", "get-by-id"], opts),
    set: (opts?: UipOptions) => uipExec(["orchestrator", "assets", "post"], opts),
  },

  /** Folders */
  folders: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "folders", "get"], opts),
  },

  /** Releases / Processes */
  releases: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "releases", "get"], opts),
  },

  /** Robots / Machines */
  machines: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "machines", "get"], opts),
  },

  /** Storage buckets */
  buckets: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "buckets", "get"], opts),
    upload: (filePath: string, bucketId: string, opts?: UipOptions) =>
      uipExec(["orchestrator", "buckets", "upload", "--file", filePath, "--bucket-id", bucketId], opts),
    download: (bucketId: string, opts?: UipOptions) =>
      uipExec(["orchestrator", "buckets", "download", "--bucket-id", bucketId], opts),
  },

  /** Webhooks */
  webhooks: {
    list: (opts?: UipOptions) => uipExec(["orchestrator", "webhooks", "get"], opts),
  },
};

// ─── Identity ────────────────────────────────────────────────────────

export const identity = {
  users: {
    list: (opts?: UipOptions) => uipExec(["identity", "user", "get-users"], opts),
  },
  groups: {
    list: (opts?: UipOptions) => uipExec(["identity", "group", "get-groups"], opts),
  },
};

// ─── Studio ──────────────────────────────────────────────────────────

export const studio = {
  /** Package a Studio project */
  pack: (opts?: UipOptions) => uipExec(["studio", "package", "pack"], opts),
  /** Analyze a Studio project */
  analyze: (opts?: UipOptions) => uipExec(["studio", "package", "analyze"], opts),
  /** Publish a package */
  publish: (opts?: UipOptions) => uipExec(["studio", "package", "publish"], opts),
  /** Run tests */
  testRun: (opts?: UipOptions) => uipExec(["studio", "test", "run"], opts),
};

// ─── UiPath Skill Commands (via `uip`) ──────────────────────────────

/** Map of skill names to their primary CLI subcommand */
const SKILL_COMMAND_MAP: Record<string, string[]> = {
  "uipath-rpa": ["rpa"],
  "uipath-agents": ["codedagent"],
  "uipath-platform": ["or"],
  "uipath-admin": ["admin"],
  "uipath-solution": ["solution"],
  "uipath-test": ["tm"],
  "uipath-maestro-flow": ["maestro", "flow"],
  "uipath-maestro-bpmn": ["maestro"],
  "uipath-maestro-case": ["maestro"],
  "uipath-ixp": ["ixp"],
  "uipath-insights": ["insights"],
  "uipath-coded-apps": ["codedapp"],
  "uipath-api-workflow": ["api-workflow"],
  "uipath-functions": ["function"],
  "uipath-tasks": ["tasks"],
  "uipah-human-in-the-loop": ["maestro"],
  "uipath-feedback": ["feedback"],
};

/**
 * Execute a UiPath skill command
 *
 * @example
 * ```ts
 * // uip rpa build
 * await uipSkillExec("uipath-rpa", ["build"]);
 * // uip solution pack
 * await uipSkillExec("uipath-solution", ["pack"]);
 * ```
 */
export async function uipSkillExec(
  skillName: string,
  subcommand: string[],
  opts: UipOptions = {}
): Promise<UipExecutionResult> {
  const prefix = SKILL_COMMAND_MAP[skillName];
  if (!prefix) {
    throw new Error(`Unknown UiPath skill: ${skillName}. Known: ${Object.keys(SKILL_COMMAND_MAP).join(", ")}`);
  }
  return uipExec([...prefix, ...subcommand], opts);
}

/**
 * List available UiPath skills by probing `uip skills`
 */
export async function listAvailableSkills(): Promise<string[]> {
  const result = await uipExec(["skills", "list"], { output: "json", timeout: 15_000 });
  if (result.exitCode !== 0) return [];

  // Try parsed JSON data first
  if (Array.isArray(result.data)) {
    return result.data.map((s: any) => typeof s === "string" ? s : s.name ?? s.Name ?? s.id ?? s.Id);
  }

  // uip skills list often returns { Result, Code, Data: { RootDir, Skills: [...] } }
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed?.Data?.Skills && Array.isArray(parsed.Data.Skills)) {
      return parsed.Data.Skills.map((s: any) => s.Name ?? s.name ?? s.Id ?? s.id ?? String(s));
    }
    if (Array.isArray(parsed)) {
      return parsed.map((s: any) => typeof s === "string" ? s : s.name ?? s.Name ?? s.id ?? s.Id);
    }
  } catch { /* not JSON */ }

  // Fallback: parse text output, skip JSON noise
  return result.stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("{") && !l.startsWith("}") && !l.startsWith('"') && !l.includes("Result") && !l.includes("Code") && !l.includes("Data"))
    .filter(l => l.length > 0 && l.length < 80);
}

/**
 * Check if a specific UiPath skill is available
 */
export async function isSkillAvailable(skillName: string): Promise<boolean> {
  const skills = await listAvailableSkills();
  return skills.includes(skillName);
}
