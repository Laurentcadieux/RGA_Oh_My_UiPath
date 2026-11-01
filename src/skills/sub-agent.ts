/**
 * Sub-agent dispatcher — invoke UiPath skills as sub-agents
 *
 * This is the bridge between the orchestration layer and uipath/skills.
 * When the autopilot or team orchestrator needs to invoke a UiPath skill,
 * it goes through this dispatcher which:
 * 1. Resolves the skill name to a `uip` command prefix
 * 2. Probes for the skill's SKILL.md (bundled or via uip skills)
 * 3. Spawns the skill as a sub-agent (in-session or CLI)
 */

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(_execFile);
import { parseFrontmatter } from "./frontmatter.js";
import type { SkillFrontmatter } from "./frontmatter.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface SubAgentInvocation {
  /** Skill name (e.g. "uipath-rpa") */
  skillName: string;
  /** Task description for the sub-agent */
  task: string;
  /** Working directory for the invocation */
  cwd: string;
  /** Session ID for state isolation */
  sessionId: string;
  /** Additional context to pass */
  context?: string;
  /** Model override */
  model?: string;
}

export interface SubAgentResult {
  /** Skill that was invoked */
  skillName: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** stdout output */
  output: string;
  /** stderr output */
  errors: string;
  /** Duration in ms */
  durationMs: number;
  /** Artifacts produced (file paths) */
  artifacts: string[];
}

export interface SubAgentDispatcher {
  /** Check if a skill is available */
  isAvailable(skillName: string): Promise<boolean>;
  /** List all available skills */
  listAvailable(): Promise<string[]>;
  /** Invoke a skill as a sub-agent */
  invoke(invocation: SubAgentInvocation): Promise<SubAgentResult>;
  /** Get a skill's SKILL.md content */
  getSkillContent(skillName: string): Promise<string | null>;
}

// ─── Skill → CLI command mapping ──────────────────────────────────────

const SKILL_CLI_MAP: Record<string, string[]> = {
  "uipath-rpa":              ["rpa"],
  "uipath-agents":           ["codedagent"],
  "uipath-platform":         ["or"],
  "uipath-admin":            ["admin"],
  "uipath-solution":         ["solution"],
  "uipath-test":             ["tm"],
  "uipath-maestro-flow":     ["maestro", "flow"],
  "uipath-maestro-bpmn":     ["maestro"],
  "uipath-maestro-case":     ["maestro"],
  "uipath-ixp":              ["ixp"],
  "uipath-insights":         ["insights"],
  "uipath-coded-apps":       ["codedapp"],
  "uipath-api-workflow":     ["api-workflow"],
  "uipath-functions":        ["function"],
  "uipath-tasks":            ["tasks"],
  "uipath-human-in-the-loop": ["maestro"],
  "uipath-feedback":         ["feedback"],
  "uipath-planner":          [],        // no CLI — PDD→SDD authoring
  "uipath-review":           [],        // read-only, no primary CLI
  "uipath-genome":           [],        // no CLI — blueprint system
  "uipath-troubleshoot":     ["docsai"],
  "uipath-governance":       ["gov"],
  "uipath-aops":             ["aops"],
  "uipath-automationhub":    ["ah"],
  "uipath-connector-builder": ["is", "connectors", "builder"],
  "uipath-rules":            ["rules"],
  "uipath-process-mining":   ["pm"],
  "uipath-mcp-servers":      ["agenthub", "mcp"],
  "uipath-knowledge-bundles": ["or", "kb"],
  "uipath-activity-migrator": [],      // uses UiPath.Upgrade.exe
  "uipath-vertical-solutions": ["vss"],
};

// ─── Implementation ───────────────────────────────────────────────────

export async function createSubAgentDispatcher(
  options: {
    /** Directory where uipath/skills are installed (e.g. ~/.agents/skills) */
    skillsDir?: string;
    /** Directory for .omu state */
    stateDir?: string;
    /** Custom skill→CLI overrides */
    skillCliOverrides?: Record<string, string[]>;
  } = {}
): Promise<SubAgentDispatcher> {
  const skillsDir = options.skillsDir ?? getDefaultSkillsDir();
  const stateDir = options.stateDir ?? `${process.cwd()}/.omu/state`;
  const cliMap = { ...SKILL_CLI_MAP, ...options.skillCliOverrides };

  // Cache of discovered skills
  const discoveredSkills = new Map<string, { path: string; frontmatter: SkillFrontmatter }>();

  // ── Discover skills on first access ──────────────────────────────
  async function discoverSkills(): Promise<void> {
    if (discoveredSkills.size > 0) return;

    // Probe uipath/skills directory
    try {
      const entries = await readdir(skillsDir);
      for (const entry of entries) {
        if (!entry.startsWith("uipath-")) continue;
        const skillMdPath = join(skillsDir, entry, "SKILL.md");
        try {
          const content = await readFile(skillMdPath, "utf-8");
          const { frontmatter } = parseFrontmatter(content);
          discoveredSkills.set(entry, { path: skillMdPath, frontmatter });
        } catch { /* not readable */ }
      }
    } catch { /* dir doesn't exist */ }

    // Also probe local bundled skills
    const bundledDir = join(process.cwd(), "skills");
    try {
      const entries = await readdir(bundledDir);
      for (const entry of entries) {
        if (discoveredSkills.has(entry)) continue;
        const skillMdPath = join(bundledDir, entry, "SKILL.md");
        try {
          const content = await readFile(skillMdPath, "utf-8");
          const { frontmatter } = parseFrontmatter(content);
          discoveredSkills.set(entry, { path: skillMdPath, frontmatter });
        } catch { /* not readable */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  return {
    async isAvailable(skillName): Promise<boolean> {
      await discoverSkills();
      if (discoveredSkills.has(skillName)) return true;
      // Fallback: check if CLI command exists
      const cmd = cliMap[skillName];
      if (cmd && cmd.length > 0) {
        try {
          await execFile("uip", [...cmd, "--help"], { timeout: 5_000 });
          return true;
        } catch { return false; }
      }
      return false;
    },

    async listAvailable(): Promise<string[]> {
      await discoverSkills();
      return [...discoveredSkills.keys()];
    },

    async invoke(invocation): Promise<SubAgentResult> {
      const { skillName, task, cwd, sessionId, context, model } = invocation;
      const startTime = Date.now();

      // Ensure state directory
      const sessionStateDir = join(stateDir, "sessions", sessionId);
      await mkdir(sessionStateDir, { recursive: true });

      // Check if skill has a CLI mapping
      const cmd = cliMap[skillName];

      if (cmd && cmd.length > 0) {
        // ── CLI invocation via `uip` ──────────────────────────────
        try {
          const { stdout, stderr } = await execFile("uip", cmd, {
            cwd,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: {
              ...process.env,
              UIPATH_SESSION_ID: sessionId,
            },
          });

          // Write invocation record
          await writeFile(
            join(sessionStateDir, `${skillName}-result.json`),
            JSON.stringify({ skillName, task, exitCode: 0, timestamp: new Date().toISOString() }, null, 2)
          );

          return {
            skillName,
            exitCode: 0,
            output: stdout,
            errors: stderr,
            durationMs: Date.now() - startTime,
            artifacts: extractArtifacts(stdout),
          };
        } catch (err: any) {
          return {
            skillName,
            exitCode: err.code ?? 1,
            output: err.stdout ?? "",
            errors: err.stderr ?? err.message,
            durationMs: Date.now() - startTime,
            artifacts: [],
          };
        }
      } else {
        // ── Skill-based invocation (no direct CLI) ────────────────
        // These skills (planner, review, genome) are invoked by
        // reading their SKILL.md and executing through Claude Code
        await discoverSkills();
        const skillInfo = discoveredSkills.get(skillName);

        if (!skillInfo) {
          return {
            skillName,
            exitCode: 1,
            output: "",
            errors: `Skill ${skillName} not found. Available: ${[...discoveredSkills.keys()].join(", ")}`,
            durationMs: Date.now() - startTime,
            artifacts: [],
          };
        }

        // Read SKILL.md content for context injection
        const skillContent = await readFile(skillInfo.path, "utf-8");

        // Write invocation record with skill content for the lead agent to pick up
        await writeFile(
          join(sessionStateDir, `${skillName}-invocation.md`),
          `# ${skillName} Invocation\n\n## Task\n${task}\n\n${context ? `## Context\n${context}\n\n` : ""}## Skill Definition\n${skillContent}\n`
        );

        return {
          skillName,
          exitCode: 0,
          output: `Skill ${skillName} invoked. See ${sessionStateDir}/${skillName}-invocation.md for the full context. The lead agent should read this file and follow the skill's instructions.`,
          errors: "",
          durationMs: Date.now() - startTime,
          artifacts: [join(sessionStateDir, `${skillName}-invocation.md`)],
        };
      }
    },

    async getSkillContent(skillName): Promise<string | null> {
      await discoverSkills();
      const skillInfo = discoveredSkills.get(skillName);
      if (!skillInfo) return null;
      try {
        return await readFile(skillInfo.path, "utf-8");
      } catch {
        return null;
      }
    },
  };
}

/** Extract file paths that look like artifacts from stdout */
function extractArtifacts(stdout: string): string[] {
  const artifacts: string[] = [];
  // Match common artifact patterns: .nupkg, .zip, .uipx, file paths
  const patterns = [
    /[\S]+\.nupkg/g,
    /[\S]+\.zip/g,
    /[\S]+\.uipx/g,
    /Published to:\s*([\S]+)/g,
    /Output:\s*([\S]+)/g,
    /Package:\s*([\S]+)/g,
  ];
  for (const pattern of patterns) {
    const matches = stdout.matchAll(pattern);
    for (const match of matches) {
      artifacts.push(match[1] ?? match[0]);
    }
  }
  return [...new Set(artifacts)];
}

/** Get the default uipath/skills directory */
function getDefaultSkillsDir(): string {
  // Check common locations
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates = [
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".uipath", "skills"),
  ];
  // Return first that exists (sync check is fine for startup)
  for (const dir of candidates) {
    try {
      accessSync(dir);
      return dir;
    } catch { continue; }
  }
  // Default to ~/.agents/skills even if it doesn't exist yet
  return candidates[0];
}
