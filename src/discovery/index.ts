/**
 * UiPath Project Discovery Agent
 *
 * Detects UiPath project type by scanning for characteristic files:
 * - .xaml → Classic RPA workflow
 * - .cs → Coded automation / coded agent
 * - .uipx → Cross-platform project
 * - agent.json → Coding Agent
 * - project.json → UiPath project manifest
 * - .packages → Library packages
 * - Data Manager patterns → Data Service
 * - Test Framework references → Test automation
 *
 * This drives routing decisions: which uipath skill to invoke,
 * which CLI commands are relevant, and what the autopilot should do.
 */

import { readFile, readdir, stat, readFile as readFileCb } from "node:fs/promises";
import { join, extname, basename, relative } from "node:path";
import { parse as parseJson5 } from "./json5-lite.js";

// ─── Types ────────────────────────────────────────────────────────────

export type UiPathProjectType =
  | "classic-rpa"        // .xaml workflows (Windows - Legacy or Windows)
  | "coded-automation"   // .cs Coded Workflows/Sequences
  | "coded-agent"        // agent.json + .cs Coding Agent
  | "cross-platform"     // .uipx project
  | "library"            // UiPath Library (.packages)
  | "test-automation"    // Test Framework project
  | "data-service"       // Data Manager / Data Service
  | "maestro"            // Maestro BPMN/Case/Flow
  | "unknown";

export interface UiPathProjectManifest {
  /** Parsed project.json content */
  name: string;
  description?: string;
  version?: string;
  projectType?: string;
  framework?: string;
  dependencies?: Record<string, string>;
  /** Raw parsed JSON */
  raw?: Record<string, unknown>;
}

export interface DiscoveredFile {
  /** Absolute path */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** File extension */
  ext: string;
  /** File type classification */
  kind: "xaml" | "cs" | "uipx" | "agent-json" | "project-json" | "packages" | "test" | "other";
}

export interface UiPathProjectDiscovery {
  /** Project root directory */
  rootDir: string;
  /** Detected project type */
  type: UiPathProjectType;
  /** Confidence (0-1) */
  confidence: number;
  /** Parsed project.json (if found) */
  manifest?: UiPathProjectManifest;
  /** Characteristic files found */
  files: DiscoveredFile[];
  /** Suggested uipath skill to invoke */
  suggestedSkill: string;
  /** Suggested CLI commands */
  suggestedCommands: string[];
  /** Detection notes */
  notes: string[];
}

// ─── Discovery logic ──────────────────────────────────────────────────

/** File kind from extension/name */
function classifyFile(filePath: string): DiscoveredFile["kind"] {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  if (ext === ".xaml") return "xaml";
  if (ext === ".cs") return "cs";
  if (ext === ".uipx") return "uipx";
  if (name === "agent.json") return "agent-json";
  if (name === "project.json") return "project-json";
  if (ext === ".packages" || name === ".packages") return "packages";
  if (name.includes("test") || name.includes("spec")) return "test";
  return "other";
}

/** Scan a directory for UiPath characteristic files (non-recursive for speed) */
async function scanDirectory(dir: string, depth: number = 0, maxDepth: number = 3): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];

  if (depth > maxDepth) return results;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    // Skip node_modules, .git, bin, obj
    if (entry === "node_modules" || entry === ".git" || entry === "bin" || entry === "obj" || entry === ".omu") continue;

    const fullPath = join(dir, entry);
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(fullPath);
    } catch { continue; }

    if (s.isFile()) {
      const kind = classifyFile(entry);
      if (kind !== "other" || extname(entry).toLowerCase() === ".json") {
        results.push({
          path: fullPath,
          relativePath: relative(dir, fullPath),
          ext: extname(entry).toLowerCase(),
          kind,
        });
      }
    } else if (s.isDirectory() && depth < maxDepth) {
      const subResults = await scanDirectory(fullPath, depth + 1, maxDepth);
      results.push(...subResults);
    }
  }

  return results;
}

/** Parse project.json into a manifest */
async function parseProjectManifest(projectJsonPath: string): Promise<UiPathProjectManifest | undefined> {
  try {
    const content = await readFile(projectJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    return {
      name: parsed.name ?? basename(projectJsonPath),
      description: parsed.description,
      version: parsed.projectVersion,
      projectType: parsed.projectType,
      framework: parsed.targetFramework,
      dependencies: parsed.dependencies ?? {},
      raw: parsed,
    };
  } catch {
    return undefined;
  }
}

/** Determine project type from discovered files */
function classifyProject(files: DiscoveredFile[], manifest?: UiPathProjectManifest): { type: UiPathProjectType; confidence: number; notes: string[] } {
  const counts = {
    xaml: files.filter(f => f.kind === "xaml").length,
    cs: files.filter(f => f.kind === "cs").length,
    uipx: files.filter(f => f.kind === "uipx").length,
    agentJson: files.filter(f => f.kind === "agent-json").length,
    packages: files.filter(f => f.kind === "packages").length,
    tests: files.filter(f => f.kind === "test").length,
  };

  const notes: string[] = [];

  // Coding Agent: agent.json is the strongest signal
  if (counts.agentJson > 0) {
    notes.push(`Found agent.json → Coding Agent`);
    return { type: "coded-agent", confidence: 0.95, notes };
  }

  // Cross-platform: .uipx files
  if (counts.uipx > 0) {
    notes.push(`Found ${counts.uipx} .uipx file(s) → Cross-platform project`);
    return { type: "cross-platform", confidence: 0.9, notes };
  }

  // Coded automation: .cs files without agent.json
  if (counts.cs > 0 && counts.xaml === 0) {
    notes.push(`Found ${counts.cs} .cs file(s), no .xaml → Coded automation`);
    return { type: "coded-automation", confidence: 0.85, notes };
  }

  // Mixed: both .cs and .xaml (coded wrappers around classic)
  if (counts.cs > 0 && counts.xaml > 0) {
    notes.push(`Found ${counts.cs} .cs + ${counts.xaml} .xaml → Classic RPA with coded invocations`);
    return { type: "classic-rpa", confidence: 0.7, notes };
  }

  // Classic RPA: .xaml files
  if (counts.xaml > 0) {
    notes.push(`Found ${counts.xaml} .xaml file(s) → Classic RPA`);

    // Check for test framework in dependencies
    if (manifest?.dependencies) {
      const hasTestFramework = Object.keys(manifest.dependencies).some(d =>
        d.toLowerCase().includes("testing") || d.toLowerCase().includes("testframework")
      );
      if (hasTestFramework) {
        notes.push("Test Framework dependency detected → Test automation");
        return { type: "test-automation", confidence: 0.8, notes };
      }
    }

    return { type: "classic-rpa", confidence: 0.9, notes };
  }

  // Library: .packages
  if (counts.packages > 0) {
    notes.push(`Found .packages → Library project`);
    return { type: "library", confidence: 0.85, notes };
  }

  // Check manifest for type hints
  if (manifest?.projectType) {
    const pt = manifest.projectType.toLowerCase();
    if (pt.includes("test")) {
      notes.push(`project.json type=${manifest.projectType} → Test automation`);
      return { type: "test-automation", confidence: 0.75, notes };
    }
    if (pt.includes("library")) {
      notes.push(`project.json type=${manifest.projectType} → Library`);
      return { type: "library", confidence: 0.75, notes };
    }
  }

  notes.push("No characteristic UiPath files found");
  return { type: "unknown", confidence: 0, notes };
}

/** Map project type to suggested skill and CLI commands */
function getSuggestions(type: UiPathProjectType): { skill: string; commands: string[] } {
  switch (type) {
    case "classic-rpa":
      return { skill: "uipath-rpa", commands: ["rpa", "tm"] };
    case "coded-automation":
      return { skill: "uipath-coded-apps", commands: ["codedapp", "codedagent"] };
    case "coded-agent":
      return { skill: "uipath-agents", commands: ["codedagent", "agenthub"] };
    case "cross-platform":
      return { skill: "uipath-rpa", commands: ["rpa"] };
    case "library":
      return { skill: "uipath-rpa", commands: ["rpa"] };
    case "test-automation":
      return { skill: "uipath-test", commands: ["tm"] };
    case "data-service":
      return { skill: "uipath-platform", commands: ["or"] };
    case "maestro":
      return { skill: "uipath-maestro-flow", commands: ["maestro"] };
    case "unknown":
      return { skill: "uipath-platform", commands: ["or"] };
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Discover the UiPath project type at the given directory.
 *
 * @param dir - Directory to scan (defaults to cwd)
 * @returns Discovery result with type, files, suggestions
 */
export async function discoverProject(dir?: string): Promise<UiPathProjectDiscovery> {
  const rootDir = dir ?? process.cwd();

  // Scan for characteristic files
  const files = await scanDirectory(rootDir);

  // Find and parse project.json
  const projectJson = files.find(f => f.kind === "project-json");
  const manifest = projectJson ? await parseProjectManifest(projectJson.path) : undefined;

  // Classify the project
  const { type, confidence, notes } = classifyProject(files, manifest);

  // Get skill/command suggestions
  const { skill, commands } = getSuggestions(type);

  return {
    rootDir,
    type,
    confidence,
    manifest,
    files,
    suggestedSkill: skill,
    suggestedCommands: commands,
    notes,
  };
}

/**
 * Quick check: is the current directory a UiPath project?
 */
export async function isUiPathProject(dir?: string): Promise<boolean> {
  const discovery = await discoverProject(dir);
  return discovery.type !== "unknown";
}

/**
 * Watch mode: periodically re-scan for project changes.
 * Returns a cleanup function.
 */
export function watchProject(
  dir: string,
  onChange: (discovery: UiPathProjectDiscovery) => void,
  intervalMs: number = 5_000
): () => void {
  let lastType: UiPathProjectType | null = null;
  const timer = setInterval(async () => {
    try {
      const discovery = await discoverProject(dir);
      if (discovery.type !== lastType) {
        lastType = discovery.type;
        onChange(discovery);
      }
    } catch { /* ignore scan errors in watch mode */ }
  }, intervalMs);
  return () => clearInterval(timer);
}
