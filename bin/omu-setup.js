#!/usr/bin/env node
/**
 * omu-setup — Install oh-my-uipath and wire into Claude Code + UiPath
 *
 * Steps:
 * 1. Check for Claude Code plugin directory
 * 2. Symlink or copy plugin files
 * 3. Check for uipathcli (`uip`)
 * 4. Check for uipath/skills
 * 5. Write .omu/config.json with discovered paths
 * 6. Print summary + next steps
 */

import { execFile } from "node:child_process/promises";
import { existsSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const HOME = homedir();

interface SetupResult {
  step: string;
  ok: boolean;
  message: string;
}

const results: SetupResult[] = [];

function result(step: string, ok: boolean, message: string) {
  results.push({ step, ok, message });
  const icon = ok ? "✅" : "❌";
  console.log(`  ${icon} ${step}: ${message}`);
}

async function checkCli(name: string, args: string[] = ["--version"]): Promise<string | null> {
  try {
    const { stdout } = await execFile(name, args, { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function setup() {
  console.log("🔧 oh-my-uipath setup\n");

  // ── 1. Check Claude Code plugin dir ────────────────────────────
  const claudePluginDirs = [
    join(HOME, ".claude", "plugins"),
    join(HOME, ".config", "claude", "plugins"),
  ];
  let pluginDir: string | null = null;
  for (const dir of claudePluginDirs) {
    if (existsSync(dir)) { pluginDir = dir; break; }
  }
  if (!pluginDir) {
    // Create default
    pluginDir = claudePluginDirs[0];
    mkdirSync(pluginDir, { recursive: true });
  }
  result("Claude Code plugin dir", true, pluginDir);

  // ── 2. Link plugin ─────────────────────────────────────────────
  const linkPath = join(pluginDir, "oh-my-uipath");
  try {
    const existing = lstatSync(linkPath);
    if (existing.isSymbolicLink()) {
      result("Plugin link", true, "already linked");
    } else {
      result("Plugin link", false, `${linkPath} exists but is not a symlink — resolve manually`);
    }
  } catch {
    try {
      symlinkSync(ROOT, linkPath, "junction");
      result("Plugin link", true, `linked ${linkPath} → ${ROOT}`);
    } catch (err: any) {
      result("Plugin link", false, `failed to symlink: ${err.message}`);
    }
  }

  // ── 3. Check uipathcli ─────────────────────────────────────────
  const uipVersion = await checkCli("uip");
  if (uipVersion) {
    result("uipathcli", true, `v${uipVersion}`);
  } else {
    result("uipathcli", false, "not found — install from https://download.uipath.com/uipathcli/");
  }

  // ── 4. Check uipath/skills ─────────────────────────────────────
  const skillDirs = [
    join(HOME, ".agents", "skills"),
    join(HOME, ".claude", "skills"),
  ];
  let skillsDir: string | null = null;
  let skillCount = 0;
  for (const dir of skillDirs) {
    if (existsSync(dir)) {
      skillsDir = dir;
      try {
        const { stdout } = await execFile("ls", [dir], { timeout: 2_000 });
        skillCount = stdout.trim().split("\n").filter(l => l.startsWith("uipath-")).length;
      } catch { /* empty */ }
      break;
    }
  }
  if (skillsDir && skillCount > 0) {
    result("uipath/skills", true, `${skillCount} skills in ${skillsDir}`);
  } else if (skillsDir) {
    result("uipath/skills", false, `directory exists but no uipath-* skills — run: uip skills install`);
  } else {
    result("uipath/skills", false, "not found — run: uip skills install");
  }

  // ── 5. Check Node.js / npm ─────────────────────────────────────
  const nodeVersion = await checkCli("node");
  const npmVersion = await checkCli("npm");
  result("Node.js", !!nodeVersion, nodeVersion ?? "not found");
  result("npm", !!npmVersion, npmVersion ?? "not found");

  // ── 6. Write .omu config ───────────────────────────────────────
  const omuDir = join(ROOT, ".omu");
  mkdirSync(omuDir, { recursive: true });
  const config = {
    version: "0.2.0",
    pluginDir,
    skillsDir: skillsDir ?? join(HOME, ".agents", "skills"),
    uipPath: "uip",
    installedAt: new Date().toISOString(),
  };
  writeFileSync(join(omuDir, "config.json"), JSON.stringify(config, null, 2));
  result("omu config", true, join(omuDir, "config.json"));

  // ── Summary ────────────────────────────────────────────────────
  const failures = results.filter(r => !r.ok);
  console.log("\n" + "─".repeat(50));
  if (failures.length === 0) {
    console.log("✅ Setup complete! Restart Claude Code to activate oh-my-uipath.");
  } else {
    console.log(`⚠️  Setup completed with ${failures.length} issue(s):`);
    for (const f of failures) {
      console.log(`   • ${f.step}: ${f.message}`);
    }
    console.log("\n   Resolve the above and re-run: omu setup");
  }

  console.log("\n📖 Quick start:");
  console.log("   omu discover          — detect UiPath project type");
  console.log("   omu interview         — design automation via deep interview");
  console.log("   omu lifecycle promote — pack → publish → deploy → activate");
  console.log("   omu scan              — security + safety scan");
}

setup().catch(err => {
  console.error("Setup failed:", err);
  process.exit(1);
});
