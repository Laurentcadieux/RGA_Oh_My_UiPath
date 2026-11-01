/**
 * Tests for team orchestrator: worker lifecycle, Lookout gating, parallel execution
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTeamOrchestrator, type TeamOrchestrator } from "../src/team/orchestrator.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = join("/tmp", "omu-test-team", Date.now().toString());

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
});

describe("createTeamOrchestrator", () => {
  it("creates orchestrator with default options", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    expect(orch.name).toBe("test");
    expect(orch.workers.size).toBe(0);
    expect(orch.options.maxConcurrency).toBe(4);
    expect(orch.options.workerTimeoutMs).toBe(120_000);
  });

  it("creates required directories", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    expect(orch.paths.root).toContain("team/test");
    expect(orch.paths.results).toContain("results");
  });
});

describe("addWorker", () => {
  it("adds a CLI worker", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "Worker 1", type: "cli", binary: "echo" });

    expect(orch.workers.size).toBe(1);
    const worker = orch.workers.get("w1")!;
    expect(worker.status).toBe("idle");
    expect(worker.type).toBe("cli");
  });

  it("adds a native worker", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "Native 1", type: "native", uipSkill: "rpa" });

    const worker = orch.workers.get("w1")!;
    expect(worker.type).toBe("native");
    expect(worker.uipSkill).toBe("rpa");
  });

  it("adds multiple workers", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.addWorker({ id: "w2", name: "W2", type: "cli" });
    await orch.addWorker({ id: "w3", name: "W3", type: "native" });

    expect(orch.workers.size).toBe(3);
  });
});

describe("assignTask", () => {
  it("assigns a safe task to a worker", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.assignTask("w1", "echo hello");

    const worker = orch.workers.get("w1")!;
    expect(worker.status).toBe("active");
    expect(worker.task).toBe("echo hello");
    expect(worker.startedAt).toBeDefined();
  });

  it("blocks a destructive task on prod", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR, {
      policy: { environment: "prod", rules: [] },
    });
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });

    await expect(
      orch.assignTask("w1", "uip orchestrator queues delete --id 42")
    ).rejects.toThrow(/Lookout BLOCKED/);
  });

  it("allows a destructive task on dev (advisory)", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR, {
      policy: { environment: "dev", rules: [] },
    });
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });

    // Should not throw — dev policy is "ask" not "deny"
    await orch.assignTask("w1", "uip orchestrator queues delete --id 42");
    const worker = orch.workers.get("w1")!;
    expect(worker.status).toBe("active");
  });
});

describe("executeWorker", () => {
  it("executes a native worker and returns result", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "native", uipSkill: "rpa" });
    await orch.assignTask("w1", "build the robot");

    const result = await orch.executeWorker("w1");
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.workerId).toBe("w1");
    expect(result.structuredOutput).toBeDefined();
  });

  it("executes a CLI worker with echo and returns output", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli", binary: "echo" });
    await orch.assignTask("w1", "hello world");

    const result = await orch.executeWorker("w1");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles CLI worker failure gracefully", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.assignTask("w1", "false"); // command that exits with code 1

    const result = await orch.executeWorker("w1");
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("throws for unknown worker", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await expect(orch.executeWorker("nonexistent")).rejects.toThrow(/not found/);
  });

  it("throws for worker with no task", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });

    await expect(orch.executeWorker("w1")).rejects.toThrow(/no task/);
  });
});

describe("executeAll", () => {
  it("executes multiple workers in parallel", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR, { maxConcurrency: 4 });
    await orch.addWorker({ id: "w1", name: "W1", type: "cli", binary: "echo" });
    await orch.addWorker({ id: "w2", name: "W2", type: "cli", binary: "echo" });
    await orch.addWorker({ id: "w3", name: "W3", type: "native" });

    await orch.assignTask("w1", "task one");
    await orch.assignTask("w2", "task two");
    await orch.assignTask("w3", "native task");

    const results = await orch.executeAll();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("respects maxConcurrency by running in batches", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR, { maxConcurrency: 2 });
    await orch.addWorker({ id: "w1", name: "W1", type: "native" });
    await orch.addWorker({ id: "w2", name: "W2", type: "native" });
    await orch.addWorker({ id: "w3", name: "W3", type: "native" });
    await orch.addWorker({ id: "w4", name: "W4", type: "native" });

    for (const id of ["w1", "w2", "w3", "w4"]) {
      await orch.assignTask(id, `task ${id}`);
    }

    const results = await orch.executeAll();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe("getStatus", () => {
  it("reports correct status counts", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.addWorker({ id: "w2", name: "W2", type: "cli" });
    await orch.addWorker({ id: "w3", name: "W3", type: "native" });

    await orch.assignTask("w1", "echo 1");
    await orch.assignTask("w2", "echo 2");

    const status = await orch.getStatus();
    expect(status.activeCount).toBe(2);
    expect(status.completedCount).toBe(0);
  });
});

describe("cancelWorker", () => {
  it("cancels an active worker", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.assignTask("w1", "echo hello");

    await orch.cancelWorker("w1");
    const worker = orch.workers.get("w1")!;
    expect(worker.status).toBe("failed");
  });
});

describe("shutdown", () => {
  it("marks all active workers as failed on shutdown", async () => {
    const orch = await createTeamOrchestrator("test", TEST_DIR);
    await orch.addWorker({ id: "w1", name: "W1", type: "cli" });
    await orch.addWorker({ id: "w2", name: "W2", type: "native" });
    await orch.assignTask("w1", "echo 1");
    await orch.assignTask("w2", "native task");

    await orch.shutdown();

    expect(orch.workers.get("w1")!.status).toBe("failed");
    expect(orch.workers.get("w2")!.status).toBe("failed");
  });
});
