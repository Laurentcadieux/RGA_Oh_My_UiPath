/**
 * Team orchestrator — UiPath skill sub-agent coordination
 *
 * Adapts OMC's dual-runtime team model:
 * - Native: in-session sub-agents (Claude Code Task tool)
 * - External: CLI workers (uip + other providers)
 *
 * Key adaptation: team workers can be UiPath skill invocations
 * (uip rpa build, uip codedagent eval, etc.) instead of just
 * generic LLM agents.
 */

import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";

export interface TeamWorker {
  id: string;
  name: string;
  type: "native" | "cli";
  /** For CLI workers: the binary to run */
  binary?: string;
  /** For UiPath skill workers: the skill to invoke */
  uipSkill?: string;
  status: "idle" | "active" | "completed" | "failed";
  task?: string;
}

export interface TeamPaths {
  root: string;
  config: string;
  workers: string;
  tasks: string;
  shutdown: string;
}

export interface TeamOrchestrator {
  name: string;
  workers: Map<string, TeamWorker>;
  paths: TeamPaths;
  addWorker(worker: Omit<TeamWorker, "status">): Promise<void>;
  assignTask(workerId: string, task: string): Promise<void>;
  getStatus(): Promise<{ workers: TeamWorker[]; activeCount: number }>;
  shutdown(): Promise<void>;
}

export async function createTeamOrchestrator(
  name: string,
  stateDir: string
): Promise<TeamOrchestrator> {
  const paths: TeamPaths = {
    root: join(stateDir, "team", name),
    config: join(stateDir, "team", name, "config.json"),
    workers: join(stateDir, "team", name, "workers"),
    tasks: join(stateDir, "team", name, "tasks"),
    shutdown: join(stateDir, "team", name, "shutdown.json"),
  };

  // Ensure directories exist
  await mkdir(paths.workers, { recursive: true });
  await mkdir(paths.tasks, { recursive: true });

  const workers = new Map<string, TeamWorker>();

  return {
    name,
    workers,
    paths,

    async addWorker(worker) {
      const fullWorker: TeamWorker = { ...worker, status: "idle" };
      workers.set(worker.id, fullWorker);

      // Write worker state
      const workerDir = join(paths.workers, worker.id);
      await mkdir(workerDir, { recursive: true });
      await writeFile(
        join(workerDir, "status.json"),
        JSON.stringify(fullWorker, null, 2)
      );

      // Create inbox/outbox (file-based mailboxes, same as OMC)
      await writeFile(join(workerDir, "inbox.md"), "");
      await writeFile(join(workerDir, "outbox.md"), "");
    },

    async assignTask(workerId, task) {
      const worker = workers.get(workerId);
      if (!worker) throw new Error(`Worker ${workerId} not found`);

      worker.status = "active";
      worker.task = task;

      // Write task to inbox
      await writeFile(
        join(paths.workers, workerId, "inbox.md"),
        `# Task Assignment\n\n${task}\n\nAssigned at: ${new Date().toISOString()}`
      );

      // Write task state
      await writeFile(
        join(paths.workers, workerId, "status.json"),
        JSON.stringify(worker, null, 2)
      );
    },

    async getStatus() {
      const workerList = [...workers.values()];
      return {
        workers: workerList,
        activeCount: workerList.filter((w) => w.status === "active").length,
      };
    },

    async shutdown() {
      await writeFile(
        paths.shutdown,
        JSON.stringify({ shutdownAt: new Date().toISOString() }, null, 2)
      );

      for (const worker of workers.values()) {
        worker.status = "completed";
      }
    },
  };
}
