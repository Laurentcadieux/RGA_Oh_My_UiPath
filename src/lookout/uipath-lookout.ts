/**
 * UiPath-Aware Lookout — extends the base lookout with Orchestrator-specific scans
 *
 * Detects:
 * - Dangerous Orchestrator changes (delete robot, remove folder, unpublish process)
 * - Credential/secret exposure in project.json, config, or code
 * - Production-altering operations without safeguard
 * - Orphaned or stale package references
 * - Tenant/folder scope violations
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────

export type LookoutSeverity = "clear" | "advisory" | "review-recommended" | "block";

export interface LookoutFinding {
  /** What was found */
  id: string;
  /** Human-readable description */
  message: string;
  /** Severity level */
  severity: LookoutSeverity;
  /** Category */
  category: "uipath-destructive" | "uipath-secrets" | "uipath-production" | "uipath-stale" | "uipath-scope";
  /** File path (if applicable) */
  file?: string;
  /** Line number (if applicable) */
  line?: number;
  /** Remediation suggestion */
  suggestion?: string;
}

export interface UiPathLookoutResult {
  /** Overall assessment */
  status: LookoutSeverity;
  /** All findings */
  findings: LookoutFinding[];
  /** Files scanned */
  filesScanned: number;
}

// ─── Dangerous operation patterns ─────────────────────────────────────

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\b(?:robots?|robot)\b.*\bdelete\b/i,
  /\bdelete\b.*\b(?:robots?|robot)\b/i,
  /\bfolders?\b.*\b(?:remove|delete)\b/i,
  /\b(?:remove|delete)\b.*\bfolders?\b/i,
  /\bunpublish\b/i,
  /\b(?:process|processes)\b.*\bdelete\b/i,
  /\bdelete\b.*\b(?:process|processes)\b/i,
  /\b(?:queues?|queue)\b.*\b(?:delete|purge)\b/i,
  /\b(?:delete|purge)\b.*\b(?:queues?|queue)\b/i,
  /\b(?:assets?)\b.*\bdelete\b/i,
  /\bdelete\b.*\b(?:assets?)\b/i,
  /\b(?:schedules?)\b.*\bdelete\b/i,
  /\bdelete\b.*\b(?:schedules?)\b/i,
  /\b(?:jobs?)\b.*\b(?:delete|stop|kill)\b/i,
  /\b(?:delete|stop|kill)\b.*\b(?:jobs?)\b/i,
  /\bstop\b.*\b(?:process|processes)\b/i,
  /\b(?:process|processes)\b.*\bstop\b/i,
  /\b(?:triggers?)\b.*\bdisable\b/i,
  /\bdisable\b.*\b(?:triggers?)\b/i,
];

const PRODUCTION_PATTERNS: RegExp[] = [
  /--force\b/,
  /--skip-confirmation\b/,
  /--yes\b/,
  /--production\b/i,
  /\bprod\b.*\bdeploy\b/i,
  /\bprod\b.*\bpublish\b/i,
];

// ─── Secret patterns ──────────────────────────────────────────────────

const SECRET_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /["'](?:password|passwd|pwd)["']\s*[:=]\s*["'][^"']+["']/i, name: "hardcoded-password" },
  { pattern: /["'](?:apiKey|api_key|apikey)["']\s*[:=]\s*["'][^"']+["']/i, name: "hardcoded-api-key" },
  { pattern: /["'](?:token|refreshToken|access_token)["']\s*[:=]\s*["'][^"']+["']/i, name: "hardcoded-token" },
  { pattern: /["'](?:clientSecret|client_secret)["']\s*[:=]\s*["'][^"']+["']/i, name: "hardcoded-client-secret" },
  { pattern: /["'](?:connectionString|connection_string)["']\s*[:=]\s*["'][^"']+["']/i, name: "hardcoded-connection-string" },
  { pattern: /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/, name: "aws-access-key" },
  { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/, name: "github-token" },
];

// ─── Stale reference patterns ─────────────────────────────────────────

const STALE_PACKAGE_PATTERN = /\b(\w[\w.-]*\.\w[\w.-]*)\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/g;

// ─── Scanners ─────────────────────────────────────────────────────────

/** Scan a task/command string for destructive operations */
export function scanCommand(command: string): LookoutFinding[] {
  const findings: LookoutFinding[] = [];

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      findings.push({
        id: `destructive-${findings.length}`,
        message: `Destructive operation detected: "${command}"`,
        severity: "review-recommended",
        category: "uipath-destructive",
        suggestion: "Review before executing. Consider using --dry-run or --what-if flags.",
      });
      break; // one match per command is enough
    }
  }

  for (const pattern of PRODUCTION_PATTERNS) {
    if (pattern.test(command)) {
      findings.push({
        id: `production-${findings.length}`,
        message: `Production-altering operation: "${command}"`,
        severity: "review-recommended",
        category: "uipath-production",
        suggestion: "Ensure this targets the intended tenant/folder. Consider a staged deployment.",
      });
      break;
    }
  }

  return findings;
}

/** Scan file content for secrets */
export function scanForSecrets(content: string, filePath: string): LookoutFinding[] {
  const findings: LookoutFinding[] = [];

  for (const { pattern, name } of SECRET_PATTERNS) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        findings.push({
          id: `secret-${name}-${findings.length}`,
          message: `Potential ${name} exposed in ${filePath}`,
          severity: "advisory",
          category: "uipath-secrets",
          file: filePath,
          line: i + 1,
          suggestion: "Move secrets to Orchestrator Assets, CyberArk, or environment variables. Never commit credentials.",
        });
      }
    }
  }

  return findings;
}

/** Scan project.json for stale or risky dependencies */
export function scanDependencies(content: string, filePath: string): LookoutFinding[] {
  const findings: LookoutFinding[] = [];

  try {
    const parsed = JSON.parse(content);
    const deps = parsed.dependencies ?? {};

    for (const [name, version] of Object.entries(deps as Record<string, string>)) {
      // Flag pre-release versions
      if (version.includes("-beta") || version.includes("-alpha") || version.includes("-rc") || version.includes("-preview")) {
        findings.push({
          id: `stale-${name}`,
          message: `Pre-release dependency: ${name}@${version}`,
          severity: "advisory",
          category: "uipath-stale",
          file: filePath,
          suggestion: `Consider using a stable release of ${name} for production.`,
        });
      }

      // Flag very old major versions (heuristic)
      const majorMatch = version.match(/^(\d+)\./);
      if (majorMatch && parseInt(majorMatch[1]) === 1 && name.startsWith("UiPath.")) {
        findings.push({
          id: `old-major-${name}`,
          message: `Potentially outdated: ${name}@${version} (major version 1.x)`,
          severity: "advisory",
          category: "uipath-stale",
          file: filePath,
          suggestion: `Check if a newer major version of ${name} is available.`,
        });
      }
    }
  } catch { /* not valid JSON */ }

  return findings;
}

/** Scan for Orchestrator scope issues */
export function scanScope(command: string, config?: { tenant?: string; folder?: string }): LookoutFinding[] {
  const findings: LookoutFinding[] = [];

  // Check if targeting production without explicit folder
  if (command.includes("prod") && !command.includes("--folder") && !config?.folder) {
    findings.push({
      id: "scope-no-folder",
      message: "Production operation without explicit folder scope",
      severity: "review-recommended",
      category: "uipath-scope",
      suggestion: "Always specify --folder when operating in production. Default folder may not be intended target.",
    });
  }

  // Check if tenant is specified
  if (command.includes("deploy") || command.includes("publish")) {
    if (!command.includes("--tenant") && !config?.tenant) {
      findings.push({
        id: "scope-no-tenant",
        message: "Deployment without explicit tenant",
        severity: "advisory",
        category: "uipath-scope",
        suggestion: "Specify --tenant to avoid deploying to the wrong Orchestrator tenant.",
      });
    }
  }

  return findings;
}

// ─── Full scan ────────────────────────────────────────────────────────

/**
 * Scan a UiPath project directory for all lookout findings.
 */
export async function scanProject(dir: string): Promise<UiPathLookoutResult> {
  const findings: LookoutFinding[] = [];
  let filesScanned = 0;

  // Scan project files for secrets
  const targetExtensions = new Set([".json", ".xaml", ".cs", ".config", ".xml", ".env"]);
  const targetFiles = ["project.json", "appsettings.json", ".env", "launchSettings.json"];

  async function scanDir(currentDir: string, depth: number = 0): Promise<void> {
    if (depth > 3) return;
    let entries: string[];
    try { entries = await readdir(currentDir); } catch { return; }

    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git" || entry === "bin" || entry === "obj") continue;
      const fullPath = join(currentDir, entry);
      let s: Awaited<ReturnType<typeof stat>>;
      try { s = await stat(fullPath); } catch { continue; }

      if (s.isFile()) {
        const ext = extname(entry).toLowerCase();
        const name = basename(entry);
        if (targetExtensions.has(ext) || targetFiles.includes(name)) {
          try {
            const content = await readFile(fullPath, "utf-8");
            filesScanned++;

            // Secret scan
            findings.push(...scanForSecrets(content, fullPath));

            // Dependency scan (project.json only)
            if (name === "project.json") {
              findings.push(...scanDependencies(content, fullPath));
            }
          } catch { /* not readable */ }
        }
      } else if (s.isDirectory()) {
        await scanDir(fullPath, depth + 1);
      }
    }
  }

  await scanDir(dir);

  // Determine overall severity
  const severities = findings.map(f => f.severity);
  let status: LookoutSeverity = "clear";
  if (severities.includes("block")) status = "block";
  else if (severities.includes("review-recommended")) status = "review-recommended";
  else if (severities.includes("advisory")) status = "advisory";

  return { status, findings, filesScanned };
}

/**
 * Quick scan of a single command/task string (no file I/O).
 */
export function scanTask(task: string): UiPathLookoutResult {
  const findings: LookoutFinding[] = [
    ...scanCommand(task),
    ...scanForSecrets(task, "<task>"),
    ...scanScope(task),
  ];

  let status: LookoutSeverity = "clear";
  if (findings.some(f => f.severity === "block")) status = "block";
  else if (findings.some(f => f.severity === "review-recommended")) status = "review-recommended";
  else if (findings.some(f => f.severity === "advisory")) status = "advisory";

  return { status, findings, filesScanned: 0 };
}
