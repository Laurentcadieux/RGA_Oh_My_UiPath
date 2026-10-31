/**
 * oh-my-uipath CLI entry point
 *
 * Commands:
 *   omu setup          — install skills + configure
 *   omu ask            — route questions to providers (incl. uipath)
 *   omu team           — multi-agent team orchestration
 *   omu autopilot      — run the full autopilot pipeline
 *   omu lookout        — pre-flight danger scan
 *   omu ralph          — autonomous coding loop
 *   omu uip            — proxy uipathcli commands
 *   omu config         — show/merge config
 *   omu version        — print version
 */

import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { createAskRouter } from "../ask/router.js";
import { scanLookout } from "../lookout/index.js";
import {
  isUipAvailable,
  getUipVersion,
  uipExec,
  listAvailableSkills,
  uipSkillExec,
} from "../uipathcli/index.js";
import { createTeamOrchestrator } from "../team/orchestrator.js";

const VERSION = "0.1.0";

export function run(): void {
  const program = new Command();

  program
    .name("omu")
    .description("Multi-agent orchestration for UiPath + Claude Code")
    .version(VERSION);

  // ── setup ──────────────────────────────────────────────────────
  program
    .command("setup")
    .description("Install oh-my-uipath skills and configure for Claude Code + UiPath")
    .option("--skip-uipath", "Skip UiPath CLI/skills installation check")
    .action(async (opts) => {
      console.log("🔧 Setting up oh-my-uipath...");

      if (!opts.skipUipath) {
        console.log("\n📦 Checking UiPath CLI...");
        if (await isUipAvailable()) {
          console.log(`  ✅ UiPath CLI found: ${await getUipVersion()}`);
        } else {
          console.log("  ❌ UiPath CLI not found. Install with:");
          console.log("     curl -fsSL https://download.uipath.com/uipath-cli/install.sh | bash");
        }

        console.log("\n📦 Checking UiPath skills...");
        const skills = await listAvailableSkills();
        if (skills.length > 0) {
          console.log(`  ✅ ${skills.length} skills available: ${skills.slice(0, 5).join(", ")}${skills.length > 5 ? " ..." : ""}`);
        } else {
          console.log("  ⚠️  Run `uip skills install` to install UiPath skills");
        }
      }

      console.log("\n✅ Setup complete. Restart Claude Code to activate.");
    });

  // ── ask ────────────────────────────────────────────────────────
  program
    .command("ask <provider> <prompt>")
    .description("Route a question to a provider (claude, codex, uipath, ...)")
    .option("--agent-prompt <role>", "Prepend a role prompt")
    .option("--model <model>", "Override model")
    .action(async (provider, prompt, opts) => {
      const router = createAskRouter();
      const { contract, args } = router.route(provider, prompt, {
        agentPrompt: opts.agentPrompt,
        model: opts.model,
      });

      console.log(`→ Routing to ${contract.name} (${contract.binary})`);
      console.log(`→ Args: ${args.join(" ")}`);

      const { execFile } = await import("node:child_process/promises");
      try {
        const { stdout } = await execFile(contract.binary, args, {
          timeout: contract.quirks?.timeout ?? 60_000,
        });
        console.log(stdout);
      } catch (err: any) {
        console.error(`✗ Provider error: ${err.message}`);
        process.exit(1);
      }
    });

  // ── uip (uipathcli proxy) ──────────────────────────────────────
  program
    .command("uip", { isDefault: false })
    .description("Proxy uipathcli commands (omu uip orchestrator jobs get)")
    .argument("<args...>", "uip command and arguments")
    .option("--profile <profile>", "UiPath profile")
    .option("--output <format>", "Output format: json|text")
    .option("--query <jmespath>", "JMESPath filter")
    .action(async (args, opts) => {
      if (!(await isUipAvailable())) {
        console.error("✗ UiPath CLI (`uip`) not found. Run: omu setup");
        process.exit(1);
      }
      const result = await uipExec(args, {
        profile: opts.profile,
        output: opts.output,
        query: opts.query,
      });
      if (result.exitCode !== 0) {
        process.stderr.write(result.stderr);
        process.exit(result.exitCode);
      }
      process.stdout.write(result.stdout);
    });

  // ── autopilot ──────────────────────────────────────────────────
  program
    .command("autopilot")
    .description("Run the full UiPath-aware autopilot pipeline")
    .argument("<task>", "Task description")
    .option("--workflow <slug>", "Named workflow profile")
    .option("--skip-ralph", "Skip Ralph refinement stage")
    .option("--skip-qa", "Skip QA stage")
    .option("--execution <mode>", "Execution mode: solo|team", "solo")
    .action(async (task, opts) => {
      console.log(`🚀 Autopilot: ${task}`);
      console.log(`   Workflow: ${opts.workflow ?? "default [ralplan → execution → ralph → qa]"}`);
      console.log(`   Execution: ${opts.execution}`);
      if (opts.skipRalph) console.log("   ⚠️  Skipping Ralph");
      if (opts.skipQa) console.log("   ⚠️  Skipping QA");

      if (await isUipAvailable()) {
        console.log(`   ✅ UiPath CLI: ${await getUipVersion()}`);
        const skills = await listAvailableSkills();
        if (skills.length > 0) {
          console.log(`   ✅ ${skills.length} UiPath skills available`);
        }
      } else {
        console.log("   ⚠️  UiPath CLI not available — some stages will be limited");
      }

      console.log("\n   (Pipeline execution requires Claude Code session — use /omu-autopilot in Claude Code)");
    });

  // ── ralph ──────────────────────────────────────────────────────
  program
    .command("ralph")
    .description("Run Ralph autonomous coding loop")
    .argument("<task>", "Task description")
    .option("--verify <cmd>", "Verification command")
    .option("--no-deslop", "Skip deslop pass")
    .action(async (task, opts) => {
      console.log(`🔄 Ralph: ${task}`);
      if (opts.verify) console.log(`   Verify: ${opts.verify}`);
      console.log("\n   (Ralph loop requires Claude Code session — use /omu-ralph in Claude Code)");
    });

  // ── team ───────────────────────────────────────────────────────
  program
    .command("team")
    .description("Multi-agent team orchestration with UiPath skill workers")
    .argument("<workers>", "Worker spec: N:agent-type (e.g. 2:uipath-rpa)")
    .argument("[task]", "Task description")
    .option("--name <name>", "Team name", "default")
    .action(async (workers, task, opts) => {
      const config = await loadConfig();
      const stateDir = `${process.cwd()}/.omu/state`;
      const team = await createTeamOrchestrator(opts.name, stateDir);

      // Parse worker spec: "2:uipath-rpa" → 2 workers of type uipath-rpa
      const match = workers.match(/^(\d+):(.+)$/);
      if (!match) {
        console.error("✗ Worker spec must be N:agent-type (e.g. 2:uipath-rpa)");
        process.exit(1);
      }

      const count = parseInt(match[1], 10);
      const workerType = match[2];
      const isUipSkill = workerType.startsWith("uipath-");

      console.log(`🤖 Team "${opts.name}": ${count} × ${workerType}`);
      if (task) console.log(`   Task: ${task}`);
      console.log(`   Type: ${isUipSkill ? "UiPath skill worker" : "CLI worker"}`);

      // Add workers
      for (let i = 0; i < count; i++) {
        const id = `worker-${i + 1}`;
        await team.addWorker({
          id,
          name: `${workerType}-${i + 1}`,
          type: isUipSkill ? "cli" : "cli",
          binary: isUipSkill ? "uip" : workerType,
          uipSkill: isUipSkill ? workerType : undefined,
        });
        console.log(`   + ${id}: ${workerType}`);
      }

      if (task) {
        // Assign task to first available worker
        const workers_ = [...team.workers.keys()];
        if (workers_.length > 0) {
          await team.assignTask(workers_[0], task);
          console.log(`   → Task assigned to ${workers_[0]}`);
        }
      }

      const status = await team.getStatus();
      console.log(`\n   Active: ${status.activeCount}/${status.workers.length} workers`);
    });

  // ── lookout ────────────────────────────────────────────────────
  program
    .command("lookout")
    .description("Pre-flight danger scan for a task")
    .option("--brief <text>", "Task brief to scan")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const brief = opts.brief ?? "";
      const report = await scanLookout(brief);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        if (report.findings.length === 0) {
          console.log("✅ Clear — no danger signals detected.");
        } else {
          for (const f of report.findings) {
            const icon = f.severity === "high" ? "🚨" : f.severity === "medium" ? "⚠️" : "ℹ️";
            console.log(`${icon} [${f.severity}] ${f.title}`);
            console.log(`   Evidence: ${f.evidence.join(", ")}`);
            console.log(`   Advice: ${f.advice}`);
          }
          console.log(`\nVerdict: ${report.summary.verdict}`);
        }
      }
    });

  // ── config ─────────────────────────────────────────────────────
  program
    .command("config")
    .description("Show merged configuration")
    .action(async () => {
      const config = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  program.parse();
}
