/**
 * oh-my-uipath-c CLI entry point
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
import { discoverProject, isUiPathProject } from "../discovery/index.js";
import { createLifecyclePipeline } from "../lifecycle/index.js";
import { scanTask as uipathScanTask, scanProject as uipathScanProject } from "../lookout/uipath-lookout.js";
import { createInterview, getNextQuestion, answerQuestion, generateDesignDocument, generatePipelineInput } from "../interview/index.js";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
const VERSION = pkg.version;

export function run(): void {
  const program = new Command();

  program
    .name("omu-c")
    .description("Multi-agent orchestration for UiPath + Claude Code")
    .version(VERSION);

  // ── setup ──────────────────────────────────────────────────────
  program
    .command("setup")
    .description("Install oh-my-uipath-c skills and configure for Claude Code + UiPath")
    .option("--skip-uipath", "Skip UiPath CLI/skills installation check")
    .action(async (opts) => {
      console.log("🔧 Setting up oh-my-uipath-c...");

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

      const { execFile: _execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFile = promisify(_execFile);
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

  // ── discover ──────────────────────────────────────────────────
  program
    .command("discover")
    .description("Detect UiPath project type and suggest skills/commands")
    .argument("[dir]", "Directory to scan", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (dir, opts) => {
      const discovery = await discoverProject(dir);
      if (opts.json) {
        console.log(JSON.stringify(discovery, null, 2));
      } else {
        console.log(`📁 ${dir}`);
        console.log(`   Type: ${discovery.type} (confidence: ${(discovery.confidence * 100).toFixed(0)}%)`);
        if (discovery.manifest) {
          console.log(`   Name: ${discovery.manifest.name}`);
          console.log(`   Framework: ${discovery.manifest.framework ?? "unknown"}`);
        }
        console.log(`   Files: ${discovery.files.length} characteristic files`);
        console.log(`   Suggested skill: ${discovery.suggestedSkill}`);
        console.log(`   Suggested commands: ${discovery.suggestedCommands.map(c => `uip ${c}`).join(", ")}`);
        for (const note of discovery.notes) {
          console.log(`   → ${note}`);
        }
      }
    });

  // ── lifecycle ─────────────────────────────────────────────────
  program
    .command("lifecycle")
    .description("UiPath solution lifecycle: pack, publish, deploy, activate")
    .argument("<step>", "Step: init|pack|publish|deploy|activate|promote|test-and-promote")
    .option("--dir <dir>", "Project directory", process.cwd())
    .option("--orchestrator <url>", "Orchestrator URL")
    .option("--tenant <tenant>", "Tenant")
    .option("--dry-run", "Print commands without executing")
    .action(async (step, opts) => {
      const pipeline = createLifecyclePipeline();
      const lifecycleOpts = {
        cwd: opts.dir,
        orchestratorUrl: opts.orchestrator,
        tenant: opts.tenant,
        dryRun: opts.dryRun ?? false,
      };

      if (step === "promote") {
        console.log("🚀 Promoting: pack → publish → deploy → activate");
        const results = await pipeline.promote(lifecycleOpts);
        for (const r of results) {
          const icon = r.exitCode === 0 ? "✅" : "❌";
          console.log(`${icon} ${r.step}: ${r.durationMs}ms`);
          if (r.artifacts.length > 0) console.log(`   Artifacts: ${r.artifacts.join(", ")}`);
          if (r.exitCode !== 0) console.log(`   Error: ${r.errors}`);
        }
      } else if (step === "test-and-promote") {
        console.log("🧪 Testing, then promoting if green");
        const results = await pipeline.testAndPromote(lifecycleOpts);
        for (const r of results) {
          const icon = r.exitCode === 0 ? "✅" : "❌";
          console.log(`${icon} ${r.step}: ${r.durationMs}ms`);
          if (r.exitCode !== 0) console.log(`   Error: ${r.errors}`);
        }
      } else {
        const result = await pipeline.run(step as any, lifecycleOpts);
        const icon = result.exitCode === 0 ? "✅" : "❌";
        console.log(`${icon} ${result.step}: ${result.durationMs}ms`);
        if (result.output) console.log(result.output);
        if (result.artifacts.length > 0) console.log(`Artifacts: ${result.artifacts.join(", ")}`);
        if (result.exitCode !== 0) process.exit(1);
      }
    });

  // ── interview ─────────────────────────────────────────────────
  program
    .command("interview")
    .description("Run a deep interview for UiPath automation design")
    .option("--type <type>", "Project type: classic-rpa|coded-automation|coded-agent|cross-platform")
    .option("--answer <answers>", "JSON map of questionId→answer for batch answering")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const projectType = opts.type as any ?? undefined;
      let session = createInterview(projectType);

      if (opts.answer) {
        // Batch mode
        const answers = JSON.parse(opts.answer);
        for (const [id, val] of Object.entries(answers as Record<string, string>)) {
          session = answerQuestion(session, id, val);
        }
      } else {
        // Interactive: show next question
        const next = getNextQuestion(session);
        if (next) {
          console.log(`\n📋 Question ${session.completedCount + 1}/${session.totalCount}:`);
          console.log(`   ${next.question}`);
          if (next.hints?.length) {
            console.log(`   Hints: ${next.hints.join(" | ")}`);
          }
          console.log(`\n   (Use --answer '{"${next.id}": "your answer"}' to respond)`);
        } else {
          console.log("✅ Interview complete!");
          const doc = generateDesignDocument(session);
          console.log(doc);
        }
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(session, null, 2));
      } else {
        console.log(`\n📋 Interview: ${session.completedCount}/${session.totalCount} answered`);
        console.log(`   Status: ${session.status}`);

        if (session.status === "complete") {
          console.log("\n📄 Design Document:");
          console.log(generateDesignDocument(session));
          console.log("\n🔗 Pipeline Input:");
          const input = generatePipelineInput(session);
          console.log(`   Task: ${input.task}`);
          console.log(`   Skills: ${input.skills.join(", ")}`);
        } else {
          const next = getNextQuestion(session);
          if (next) {
            console.log(`\n   Next: ${next.question}`);
          }
        }
      }
    });

  // ── scan (enhanced lookout) ───────────────────────────────────
  program
    .command("scan")
    .description("UiPath-aware security and safety scan")
    .argument("[target]", "Task string or directory to scan", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (target, opts) => {
      // Detect if target is a directory or a command string
      let isDir = false;
      try {
        const { stat } = await import("node:fs/promises");
        const s = await stat(target);
        isDir = s.isDirectory();
      } catch { /* not a dir */ }

      if (isDir) {
        console.log(`🔍 Scanning UiPath project: ${target}`);
        const result = await uipathScanProject(target);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`   Files scanned: ${result.filesScanned}`);
          console.log(`   Findings: ${result.findings.length}`);
          console.log(`   Status: ${result.status}`);
          for (const f of result.findings) {
            const icon = f.severity === "review-recommended" ? "⚠️" : f.severity === "advisory" ? "ℹ️" : "🚨";
            console.log(`${icon} [${f.category}] ${f.message}`);
            if (f.suggestion) console.log(`   → ${f.suggestion}`);
          }
        }
      } else {
        const result = uipathScanTask(target);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.findings.length === 0) {
            console.log("✅ Clear — no danger signals.");
          } else {
            for (const f of result.findings) {
              const icon = f.severity === "review-recommended" ? "⚠️" : "ℹ️";
              console.log(`${icon} [${f.category}] ${f.message}`);
              if (f.suggestion) console.log(`   → ${f.suggestion}`);
            }
            console.log(`\nVerdict: ${result.status}`);
          }
        }
      }
    });

  program.parse();
}
