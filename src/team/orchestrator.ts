/**
 * Team orchestrator — real parallel execution for UiPath skill workers
 *
 * Replaces the dead inbox.md model with actual child process execution.
 * - CLI workers: spawn `uip` commands via child_process
 * - Native workers: return task descriptors for Claude Code Task tool
 * - Results flow back as structured JSON, not unmonitored markdown
 * - Every spawn is gated through the Lookout before execution
 */

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { scan, type LookoutResult, DEFAULT_POLICY, type Policy } from "../../packages/lookout/dist/index.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface TeamWorker {
  id: string;
  name: string;
  type: "native" | "cli";
  binary?: string;
  uipSkill?: string;
  status: "idle" | "active" | "completed" | "failed";
  task?: string;
  result?: WorkerResult;
  process?: ChildProcess;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkerResult {
  workerId: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  structuredOutput?: unknown;
}

export interface TeamPaths {
  root: string;
  config: string;
  workers: string;
  tasks: string;
  shutdown: string;
  results: string;
}

export interface TeamOrchestratorOptions {
  maxConcurrency?: number;
  workerTimeoutMs?: number;
  policy?: Policy;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TeamOrchestrator {
  name: string;
  workers: Map<string, TeamWorker>;
  paths: TeamPaths;
  options: TeamOrchestratorOptions;
  addWorker(worker: Omit<TeamWorker, "status" | "result" | "process" | "startedAt" | "completedAt">): Promise<void>;
  assignTask(workerId: string, task: string): Promise<void>;
  executeWorker(workerId: string): Promise<WorkerResult>;
  executeAll(): Promise<WorkerResult[]>;
  getStatus(): Promise<{ workers: TeamWorker[]; activeCount: number; completedCount: number; failedCount: number }>;
  cancelWorker(workerId: string): Promise<void>;
  shutdown(): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────

class TeamOrchestratorImpl implements TeamOrchestrator {
  name: string;
  workers: Map<string, TeamWorker> = new Map();
  paths: TeamPaths;
  options: Required<TeamOrchestratorOptions>;

  constructor(name: string, paths: TeamPaths, options: Required<TeamOrchestratorOptions>) {
    this.name = name;
    this.paths = paths;
    this.options = options;
  }

  async addWorker(worker: Omit<TeamWorker, "status" | "result" | "process" | "startedAt" | "completedAt">): Promise<void> {
    const fullWorker: TeamWorker = { ...worker, status: "idle" };
    this.workers.set(worker.id, fullWorker);

    const workerDir = join(this.paths.workers, worker.id);
    await mkdir(workerDir, { recursive: true });
    await writeFile(join(workerDir, "status.json"), JSON.stringify(fullWorker, null, 2));
  }

  async assignTask(workerId: string, task: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);

    // Lookout gate
    const scanResult: LookoutResult = await scan(task, { policy: this.options.policy });
    if (scanResult.verdict === "blocked") {
      throw new Error(
        `Lookout BLOCKED task for worker ${workerId}: ${scanResult.findings.map(f => f.title).join("; ")}`
      );
    }

    worker.status = "active";
    worker.task = task;
    worker.startedAt = Date.now();

    await writeFile(join(this.paths.workers, workerId, "inbox.md"), task);
    await writeFile(
      join(this.paths.workers, workerId, "status.json"),
      JSON.stringify({ ...worker, process: undefined }, null, 2)
    );

    if (scanResult.verdict !== "clear") {
      await writeFile(
        join(this.paths.workers, workerId, "lookout-warning.json"),
        JSON.stringify(scanResult, null, 2)
      );
    }
  }

  async executeWorker(workerId: string): Promise<WorkerResult> {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);
    if (!worker.task) throw new Error(`Worker ${workerId} has no task assigned`);

    const startTime = Date.now();

    if (worker.type === "native") {
      const result: WorkerResult = {
        workerId,
        success: true,
        stdout: JSON.stringify({ task: worker.task, type: "native", skill: worker.uipSkill }),
        stderr: "",
        exitCode: 0,
        durationMs: Date.now() - startTime,
        structuredOutput: { task: worker.task, type: "native", skill: worker.uipSkill },
      };
      worker.status = "completed";
      worker.result = result;
      worker.completedAt = Date.now();
      return result;
    }

    // CLI worker: spawn the process
    return new Promise<WorkerResult>((resolve) => {
      const parts = worker.task!.split(/\s+/);
      const binary = worker.binary ?? parts[0];
      const args = worker.binary ? parts : parts.slice(1);

      let stdout = "";
      let stderr = "";

      const proc = spawn(binary, args, {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        shell: true,
        timeout: this.options.workerTimeoutMs,
      });

      worker.process = proc;

      proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (exitCode) => {
        const durationMs = Date.now() - startTime;
        let structuredOutput: unknown;
        try {
          const trimmed = stdout.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            structuredOutput = JSON.parse(trimmed);
          }
        } catch { /* not JSON */ }

        const result: WorkerResult = {
          workerId,
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          durationMs,
          structuredOutput,
        };

        worker.status = exitCode === 0 ? "completed" : "failed";
        worker.result = result;
        worker.completedAt = Date.now();
        worker.process = undefined;

        writeFile(join(this.paths.results, `${workerId}.json`), JSON.stringify(result, null, 2)).catch(() => {});
        writeFile(join(this.paths.workers, workerId, "status.json"), JSON.stringify({ ...worker, process: undefined }, null, 2)).catch(() => {});

        resolve(result);
      });

      proc.on("error", (err) => {
        const result: WorkerResult = {
          workerId,
          success: false,
          stdout: "",
          stderr: err.message,
          exitCode: null,
          durationMs: Date.now() - startTime,
        };
        worker.status = "failed";
        worker.result = result;
        worker.completedAt = Date.now();
        worker.process = undefined;
        resolve(result);
      });
    });
  }

  async executeAll(): Promise<WorkerResult[]> {
    const readyWorkers = [...this.workers.values()].filter(w => w.status === "active" && w.task);
    const results: WorkerResult[] = [];
    const batchSize = this.options.maxConcurrency;

    for (let i = 0; i < readyWorkers.length; i += batchSize) {
      const batch = readyWorkers.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(w => this.executeWorker(w.id)));
      results.push(...batchResults);
    }

    return results;
  }

  async getStatus() {
    const workerList = [...this.workers.values()];
    return {
      workers: workerList,
      activeCount: workerList.filter(w => w.status === "active").length,
      completedCount: workerList.filter(w => w.status === "completed").length,
      failedCount: workerList.filter(w => w.status === "failed").length,
    };
  }

  async cancelWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    if (worker.process) {
      worker.process.kill("SIGTERM");
      worker.process = undefined;
    }
    worker.status = "failed";
    worker.completedAt = Date.now();
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers.values()) {
      if (worker.process) {
        worker.process.kill("SIGTERM");
        worker.process = undefined;
      }
      if (worker.status === "active") {
        worker.status = "failed";
        worker.completedAt = Date.now();
      }
    }

    await writeFile(
      this.paths.shutdown,
      JSON.stringify({
        shutdownAt: new Date().toISOString(),
        workers: [...this.workers.values()].map(w => ({
          id: w.id,
          status: w.status,
          duration: w.completedAt && w.startedAt ? w.completedAt - w.startedAt : null,
        })),
      }, null, 2)
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export async function createTeamOrchestrator(
  name: string,
  stateDir: string,
  options: TeamOrchestratorOptions = {}
): Promise<TeamOrchestrator> {
  const opts: Required<TeamOrchestratorOptions> = {
    maxConcurrency: options.maxConcurrency ?? 4,
    workerTimeoutMs: options.workerTimeoutMs ?? 120_000,
    policy: options.policy ?? DEFAULT_POLICY,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? {},
  };

  const paths: TeamPaths = {
    root: join(stateDir, "team", name),
    config: join(stateDir, "team", name, "config.json"),
    workers: join(stateDir, "team", name, "workers"),
    tasks: join(stateDir, "team", name, "tasks"),
    shutdown: join(stateDir, "team", name, "shutdown.json"),
    results: join(stateDir, "team", name, "results"),
  };

  await mkdir(paths.workers, { recursive: true });
  await mkdir(paths.tasks, { recursive: true });
  await mkdir(paths.results, { recursive: true });

  return new TeamOrchestratorImpl(name, paths, opts);
}
