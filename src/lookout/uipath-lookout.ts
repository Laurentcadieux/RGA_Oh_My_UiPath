/**
 * UiPath-Aware Lookout — DELEGATES to @omu-c/lookout (built dist)
 *
 * Legacy function signatures preserved for backward compatibility.
 */

import {
  scan as lookoutScan,
  extractUipCommands,
  tokenizeUipCommand,
  isDestructive,
  hasDangerousFlag,
  hasScopeFlag,
  scanForSecrets,
  shouldScanFile,
} from "../../packages/lookout/dist/index.js";

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// ─── Legacy types ─────────────────────────────────────────────────────

export type LookoutSeverity = "clear" | "advisory" | "review-recommended" | "block";

export interface LookoutFinding {
  id: string;
  message: string;
  severity: LookoutSeverity;
  category: "uipath-destructive" | "uipath-secrets" | "uipath-production" | "uipath-stale" | "uipath-scope";
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface UiPathLookoutResult {
  status: LookoutSeverity;
  findings: LookoutFinding[];
  filesScanned: number;
}

// ─── scanTask (synchronous) ───────────────────────────────────────────

export function scanTask(task: string): UiPathLookoutResult {
  const findings: LookoutFinding[] = [];
  const uipCommands = extractUipCommands(task);

  for (const cmdStr of uipCommands) {
    const parsed = tokenizeUipCommand(cmdStr);
    if (!parsed.isUipCommand) continue;

    if (isDestructive(parsed)) {
      findings.push({
        id: `destructive-${findings.length}`,
        message: `Destructive operation: ${parsed.resource} ${parsed.verb}`,
        severity: "review-recommended",
        category: "uipath-destructive",
        suggestion: "Review before executing. Consider using --dry-run or --what-if flags.",
      });
    }

    const dangerousFlags = hasDangerousFlag(parsed);
    if (dangerousFlags.length > 0) {
      findings.push({
        id: `production-${findings.length}`,
        message: `Dangerous flags: ${dangerousFlags.join(", ")}`,
        severity: "review-recommended",
        category: "uipath-production",
        suggestion: `Flags ${dangerousFlags.join(", ")} bypass confirmations. Ensure this is intentional.`,
      });
    }

    const scope = hasScopeFlag(parsed);
    if (["publish", "deploy", "activate"].includes(parsed.verb)) {
      if (!scope.hasFolder) {
        findings.push({
          id: `scope-no-folder-${findings.length}`,
          message: "Deployment without explicit folder scope",
          severity: "review-recommended",
          category: "uipath-scope",
          suggestion: "Specify --folder when deploying.",
        });
      }
      if (!scope.hasTenant) {
        findings.push({
          id: `scope-no-tenant-${findings.length}`,
          message: "Deployment without explicit tenant",
          severity: "advisory",
          category: "uipath-scope",
          suggestion: "Specify --tenant to avoid wrong target.",
        });
      }
    }
  }

  // Generic destructive (non-uip)
  const GENERIC_PATTERNS: { pattern: RegExp; category: LookoutFinding["category"] }[] = [
    { pattern: /\brm\s+-rf\b/i, category: "uipath-destructive" },
    { pattern: /\bgit\s+push\s+--force\b/i, category: "uipath-destructive" },
    { pattern: /\bDROP\s+TABLE\b/i, category: "uipath-destructive" },
  ];

  for (const { pattern, category } of GENERIC_PATTERNS) {
    if (pattern.test(task)) {
      findings.push({
        id: `generic-destructive-${findings.length}`,
        message: "Destructive command detected",
        severity: "review-recommended",
        category,
        suggestion: "Review before executing.",
      });
    }
  }

  let status: LookoutSeverity = "clear";
  if (findings.some((f) => f.severity === "block")) status = "block";
  else if (findings.some((f) => f.severity === "review-recommended")) status = "review-recommended";
  else if (findings.some((f) => f.severity === "advisory")) status = "advisory";

  return { status, findings, filesScanned: 0 };
}

// ─── scanProject (async file scan) ────────────────────────────────────

export async function scanProject(dir: string): Promise<UiPathLookoutResult> {
  const findings: LookoutFinding[] = [];
  let filesScanned = 0;

  async function scanDir(currentDir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    let entries: string[];
    try { entries = await readdir(currentDir); } catch { return; }

    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git" || entry === "bin" || entry === "obj") continue;
      const fullPath = join(currentDir, entry);
      let s;
      try { s = await stat(fullPath); } catch { continue; }

      if (s.isFile() && shouldScanFile(fullPath)) {
        try {
          const content = await readFile(fullPath, "utf-8");
          filesScanned++;
          const secretFindings = scanForSecrets(content, fullPath);
          for (const sf of secretFindings) {
            findings.push({
              id: `secret-${sf.type}-${findings.length}`,
              message: `Potential ${sf.type} exposed in ${fullPath}`,
              severity: "advisory",
              category: "uipath-secrets",
              file: fullPath,
              line: sf.line,
              suggestion: sf.suggestion,
            });
          }
        } catch { /* not readable */ }
      } else if (s.isDirectory()) {
        await scanDir(fullPath, depth + 1);
      }
    }
  }

  await scanDir(dir);

  let status: LookoutSeverity = "clear";
  if (findings.some((f) => f.severity === "block")) status = "block";
  else if (findings.some((f) => f.severity === "review-recommended")) status = "review-recommended";
  else if (findings.some((f) => f.severity === "advisory")) status = "advisory";

  return { status, findings, filesScanned };
}

export { lookoutScan };
