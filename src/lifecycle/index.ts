/**
 * UiPath Solution Lifecycle Integration
 *
 * Wraps uipathcli commands for the full solution lifecycle:
 *   init → pack → publish → deploy → activate
 *
 * Each step is a discrete operation that can be composed by the
 * autopilot pipeline or invoked directly via the CLI.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(_execFile);
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { UiPathProjectDiscovery } from "../discovery/index.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface LifecycleOptions {
  /** Working directory (project root) */
  cwd: string;
  /** Orchestrator URL (overrides config) */
  orchestratorUrl?: string;
  /** Tenant */
  tenant?: string;
  /** Auth token or refresh token */
  authToken?: string;
  /** Timeout per operation in ms */
  timeout?: number;
  /** Dry run — print commands without executing */
  dryRun?: boolean;
}

export interface LifecycleResult {
  /** Step name */
  step: LifecycleStep;
  /** Exit code */
  exitCode: number;
  /** stdout */
  output: string;
  /** stderr */
  errors: string;
  /** Duration in ms */
  durationMs: number;
  /** Artifacts produced (file paths) */
  artifacts: string[];
}

export type LifecycleStep = "init" | "pack" | "publish" | "deploy" | "activate" | "test";

export interface LifecyclePipeline {
  /** Run a single lifecycle step */
  run(step: LifecycleStep, options: LifecycleOptions): Promise<LifecycleResult>;
  /** Run the full pipeline: pack → publish → deploy → activate */
  promote(options: LifecycleOptions): Promise<LifecycleResult[]>;
  /** Run tests before promotion */
  testAndPromote(options: LifecycleOptions): Promise<LifecycleResult[]>;
}

// ─── CLI command mapping ──────────────────────────────────────────────

const STEP_COMMANDS: Record<LifecycleStep, (opts: LifecycleOptions) => string[]> = {
  init: () => ["rpa", "init"],
  pack: () => ["rpa", "pack"],
  publish: () => ["rpa", "publish"],
  deploy: () => ["rpa", "deploy"],
  activate: () => ["rpa", "activate"],
  test: () => ["tm", "run"],
};

// ─── Implementation ───────────────────────────────────────────────────

function defaultOptions(opts: LifecycleOptions): Required<Pick<LifecycleOptions, "timeout" | "dryRun">> & LifecycleOptions {
  return {
    ...opts,
    timeout: opts.timeout ?? 120_000,
    dryRun: opts.dryRun ?? false,
  };
}

async function execUip(
  args: string[],
  options: Required<Pick<LifecycleOptions, "timeout" | "dryRun">> & LifecycleOptions
): Promise<LifecycleResult> {
  const step = args.join(" ");
  const startTime = Date.now();

  if (options.dryRun) {
    return {
      step: args[0] as LifecycleStep,
      exitCode: 0,
      output: `[dry-run] uip ${args.join(" ")}`,
      errors: "",
      durationMs: 0,
      artifacts: [],
    };
  }

  try {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (options.orchestratorUrl) env.UIPATH_URL = options.orchestratorUrl;
    if (options.tenant) env.UIPATH_TENANT = options.tenant;
    if (options.authToken) env.UIPATH_TOKEN = options.authToken;

    const { stdout, stderr } = await execFile("uip", args, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });

    return {
      step: args[0] as LifecycleStep,
      exitCode: 0,
      output: stdout,
      errors: stderr,
      durationMs: Date.now() - startTime,
      artifacts: extractArtifacts(stdout),
    };
  } catch (err: any) {
    return {
      step: args[0] as LifecycleStep,
      exitCode: err.code ?? 1,
      output: err.stdout ?? "",
      errors: err.stderr ?? err.message,
      durationMs: Date.now() - startTime,
      artifacts: [],
    };
  }
}

function extractArtifacts(stdout: string): string[] {
  const artifacts: string[] = [];
  const patterns = [
    /[\S]+\.nupkg/g,
    /[\S]+\.uipx/g,
    /Published to:\s*([\S]+)/g,
    /Package:\s*([\S]+)/g,
    /Output:\s*([\S]+)/g,
  ];
  for (const p of patterns) {
    for (const m of stdout.matchAll(p)) {
      artifacts.push(m[1] ?? m[0]);
    }
  }
  return [...new Set(artifacts)];
}

export function createLifecyclePipeline(): LifecyclePipeline {
  return {
    async run(step, options): Promise<LifecycleResult> {
      const opts = defaultOptions(options);
      const cmdArgs = STEP_COMMANDS[step](opts);

      // For init, add project name if we can derive it
      if (step === "init") {
        const projectName = basename(opts.cwd);
        cmdArgs.push(projectName);
      }

      return execUip(cmdArgs, opts);
    },

    async promote(options): Promise<LifecycleResult[]> {
      const opts = defaultOptions(options);
      const results: LifecycleResult[] = [];

      // pack → publish → deploy → activate
      for (const step of ["pack", "publish", "deploy", "activate"] as LifecycleStep[]) {
        const result = await this.run(step, opts);
        results.push(result);

        // Stop pipeline on failure
        if (result.exitCode !== 0) {
          return results;
        }
      }

      return results;
    },

    async testAndPromote(options): Promise<LifecycleResult[]> {
      const opts = defaultOptions(options);
      const results: LifecycleResult[] = [];

      // Run tests first
      const testResult = await this.run("test", opts);
      results.push(testResult);

      if (testResult.exitCode !== 0) {
        // Tests failed — abort promotion
        return results;
      }

      // Promote
      const promoteResults = await this.promote(opts);
      results.push(...promoteResults);

      return results;
    },
  };
}

// ─── Convenience: single-step helpers ─────────────────────────────────

export async function packProject(options: LifecycleOptions): Promise<LifecycleResult> {
  return createLifecyclePipeline().run("pack", options);
}

export async function publishProject(options: LifecycleOptions): Promise<LifecycleResult> {
  return createLifecyclePipeline().run("publish", options);
}

export async function deployProject(options: LifecycleOptions): Promise<LifecycleResult> {
  return createLifecyclePipeline().run("deploy", options);
}

export async function activateProject(options: LifecycleOptions): Promise<LifecycleResult> {
  return createLifecyclePipeline().run("activate", options);
}

export async function promoteProject(options: LifecycleOptions): Promise<LifecycleResult[]> {
  return createLifecyclePipeline().promote(options);
}
