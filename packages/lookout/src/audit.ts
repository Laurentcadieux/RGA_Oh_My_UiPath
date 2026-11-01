/**
 * Audit Logger — append every Lookout decision to .omu/lookout-audit.jsonl
 *
 * Fields: { time, tool, command, findings[], decision, env }
 * NEVER log secret values — redact to <redacted:type>
 */

import { appendFile, mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────

export interface AuditEntry {
  /** ISO-8601 timestamp */
  time: string;
  /** Tool that triggered the scan (e.g. "Bash", "write", "edit") */
  tool: string;
  /** Command/text that was scanned (redacted if secret) */
  command: string;
  /** Findings summary */
  findings: AuditFinding[];
  /** Final decision */
  decision: "allow" | "ask" | "deny";
  /** Environment */
  env: string;
}

export interface AuditFinding {
  category: string;
  severity: string;
  /** Redacted evidence — never raw secret values */
  evidence: string;
}

// ─── Redaction ────────────────────────────────────────────────────────

const SECRET_VALUE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /(["'])(?:password|passwd|pwd|secret|token|apiKey|api_key|apikey|clientSecret|client_secret|access_token|refreshToken|connectionString|connection_string)\1\s*[:=]\s*["']([^"']+)["']/gi, type: "credential" },
  { pattern: /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, type: "aws-key" },
  { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/g, type: "github-token" },
];

/**
 * Redact secret values from a string, replacing them with <redacted:type>.
 */
export function redactSecrets(input: string): string {
  let result = input;

  for (const { pattern, type } of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // For key=value patterns, keep the key, redact the value
      const eqIdx = match.lastIndexOf("=");
      const colonIdx = match.lastIndexOf(":");
      const sepIdx = Math.max(eqIdx, colonIdx);

      if (sepIdx > 0) {
        const prefix = match.slice(0, sepIdx + 1);
        return `${prefix}<redacted:${type}>`;
      }
      return `<redacted:${type}>`;
    });
  }

  return result;
}

// ─── Logger ───────────────────────────────────────────────────────────

const MAX_LOG_SIZE = 1_000_000; // 1MB before rotation
const MAX_ROTATIONS = 3;

export class AuditLogger {
  private logPath: string;
  private initialized = false;

  constructor(projectDir: string) {
    this.logPath = join(projectDir, ".omu", "lookout-audit.jsonl");
  }

  /**
   * Append an audit entry. Creates .omu/ dir if needed.
   * Rotates on size > 1MB.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      if (!this.initialized) {
        await mkdir(join(this.logPath, ".."), { recursive: true });
        this.initialized = true;
      }

      // Redact the command
      const safeEntry: AuditEntry = {
        ...entry,
        command: redactSecrets(entry.command),
      };

      const line = JSON.stringify(safeEntry) + "\n";
      await appendFile(this.logPath, line, "utf-8");

      // Check rotation
      await this.rotateIfNeeded();
    } catch {
      // Audit logging must never block the scan — swallow errors
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(this.logPath);
      if (s.size >= MAX_LOG_SIZE) {
        // Rotate: .jsonl.3 → delete, .jsonl.2 → .3, .jsonl.1 → .2, .jsonl → .1
        for (let i = MAX_ROTATIONS; i >= 1; i--) {
          const older = `${this.logPath}.${i}`;
          const newer = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
          try {
            if (i === MAX_ROTATIONS) {
              // Delete oldest rotation (ignore if not exists)
              await rename(older, older + ".deleting").catch(() => {});
            } else {
              await rename(newer, older);
            }
          } catch {
            // Rotation errors are non-fatal
          }
        }
        await rename(this.logPath, `${this.logPath}.1`);
      }
    } catch {
      // stat failed — file doesn't exist yet, no rotation needed
    }
  }
}
