/**
 * Lookout Core — command-aware safety scanner for UiPath
 *
 * Replaces loose-regex scanning with structured command parsing.
 * Only real `uip` invocations trigger rules; free text does not.
 */

import {
  extractUipCommands,
  tokenizeUipCommand,
  isDestructive,
  hasDangerousFlag,
  hasScopeFlag,
  type UipCommand,
} from "./tokenizer.js";

import {
  type Policy,
  type FindingCategory,
  type Environment,
  resolveDecision,
  DEFAULT_POLICY,
  detectEnvironment,
} from "./policy.js";

import {
  scanForSecrets,
  scanStringForSecrets,
  shouldScanFile,
  type SecretFinding,
} from "./secrets.js";

import {
  checkSkillForEnv,
  type SkillStatusData,
  type PreviewWarning,
} from "./preview-check.js";

import { AuditLogger, redactSecrets, type AuditEntry, type AuditFinding } from "./audit.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface LookoutFinding {
  id: string;
  category: FindingCategory;
  title: string;
  severity: "high" | "medium" | "low" | "info";
  evidence: string;
  advice: string;
  decision: "allow" | "ask" | "deny";
}

export interface LookoutResult {
  scannedAt: string;
  source: string;
  findings: LookoutFinding[];
  verdict: "clear" | "advisory" | "review-recommended" | "blocked";
}

export interface LookoutOptions {
  policy?: Policy;
  auditLogger?: AuditLogger;
  skillData?: SkillStatusData;
  activeSkill?: string;
  toolName?: string;
}

// ─── Severity mapping ─────────────────────────────────────────────────

function decisionToSeverity(decision: "allow" | "ask" | "deny"): "high" | "medium" | "low" | "info" {
  if (decision === "deny") return "high";
  if (decision === "ask") return "medium";
  return "info";
}

function verdictFromFindings(findings: LookoutFinding[]): LookoutResult["verdict"] {
  if (findings.some((f) => f.decision === "deny")) return "blocked";
  if (findings.some((f) => f.severity === "high")) return "review-recommended";
  if (findings.some((f) => f.severity === "medium")) return "advisory";
  if (findings.length > 0) return "advisory";
  return "clear";
}

// ─── Force-op patterns (non-uip, generic) ─────────────────────────────

const GENERIC_FORCE_OPS: { pattern: RegExp; name: string }[] = [
  { pattern: /\brm\s+-rf\b/, name: "rm -rf" },
  { pattern: /\bgit\s+push\s+--force\b/, name: "git push --force" },
  { pattern: /\bgit\s+push\s+-f\b/, name: "git push -f" },
  { pattern: /\bDROP\s+TABLE\b/i, name: "DROP TABLE" },
  { pattern: /\bDELETE\s+FROM\b/i, name: "DELETE FROM" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, name: "TRUNCATE TABLE" },
];

// ─── Core scan ────────────────────────────────────────────────────────

/**
 * Scan a command/text string for safety findings.
 *
 * This is the main entry point. It:
 * 1. Extracts any `uip` commands from the text
 * 2. Tokenizes each into resource + verb + flags
 * 3. Applies rules: destructive ops, dangerous flags, scope violations
 * 4. Scans for generic force ops (rm -rf, etc.)
 * 5. Scans for secrets in the text
 * 6. Checks preview skill status on prod
 * 7. Resolves decisions via policy
 * 8. Logs to audit
 *
 * Free text (English sentences mentioning "delete" and "queue") does NOT trigger rules.
 */
export async function scan(text: string, options: LookoutOptions = {}): Promise<LookoutResult> {
  const policy = options.policy ?? { ...DEFAULT_POLICY, environment: detectEnvironment() };
  const findings: LookoutFinding[] = [];
  let findingId = 0;

  // ── 1. Extract and parse uip commands ─────────────────────────────

  const uipCommandStrings = extractUipCommands(text);

  for (const cmdStr of uipCommandStrings) {
    const parsed = tokenizeUipCommand(cmdStr);

    if (!parsed.isUipCommand) continue;

    // ── Destructive operation check ────────────────────────────────

    if (isDestructive(parsed)) {
      const decision = resolveDecision(policy, "destructive");
      findings.push({
        id: `lookout.${findingId++}`,
        category: "destructive",
        title: `Destructive uip operation: ${parsed.resource} ${parsed.verb}`,
        severity: decisionToSeverity(decision),
        evidence: `${parsed.resource} ${parsed.verb}`,
        advice: decision === "deny"
          ? `Blocked by policy: destructive ops are denied on ${policy.environment}. Use --dry-run or target a non-prod environment.`
          : `Destructive operation on ${parsed.resource}. Review before executing. Consider --dry-run first.`,
        decision,
      });
    }

    // ── Dangerous flags check ──────────────────────────────────────

    const dangerousFlags = hasDangerousFlag(parsed);
    if (dangerousFlags.length > 0) {
      const decision = resolveDecision(policy, "dangerous-flag");
      findings.push({
        id: `lookout.${findingId++}`,
        category: "dangerous-flag",
        title: `Dangerous flags: ${dangerousFlags.join(", ")}`,
        severity: decisionToSeverity(decision),
        evidence: `${parsed.resource} ${parsed.verb} ${dangerousFlags.join(" ")}`,
        advice: decision === "deny"
          ? `Blocked by policy: ${dangerousFlags.join(", ")} is denied on ${policy.environment}.`
          : `Flags ${dangerousFlags.join(", ")} bypass confirmations. Ensure this is intentional.`,
        decision,
      });
    }

    // ── Scope violation check ──────────────────────────────────────

    const scope = hasScopeFlag(parsed);
    const isDeployOrPublish = ["publish", "deploy", "activate"].includes(parsed.verb);

    if (isDeployOrPublish && !scope.hasFolder) {
      const decision = resolveDecision(policy, "scope-violation");
      findings.push({
        id: `lookout.${findingId++}`,
        category: "scope-violation",
        title: `Deployment without --folder`,
        severity: decisionToSeverity(decision),
        evidence: `${parsed.resource} ${parsed.verb} (no --folder)`,
        advice: `Specify --folder to avoid deploying to the wrong Orchestrator folder. Default folder may not be the intended target.`,
        decision,
      });
    }

    if (isDeployOrPublish && !scope.hasTenant) {
      const decision = resolveDecision(policy, "scope-violation");
      findings.push({
        id: `lookout.${findingId++}`,
        category: "scope-violation",
        title: `Deployment without --tenant`,
        severity: decisionToSeverity(decision),
        evidence: `${parsed.resource} ${parsed.verb} (no --tenant)`,
        advice: `Specify --tenant to avoid deploying to the wrong Orchestrator tenant.`,
        decision,
      });
    }
  }

  // ── 2. Generic force ops (non-uip) ────────────────────────────────

  for (const { pattern, name } of GENERIC_FORCE_OPS) {
    if (pattern.test(text)) {
      findings.push({
        id: `lookout.${findingId++}`,
        category: "destructive",
        title: `Destructive command: ${name}`,
        severity: "high",
        evidence: name,
        advice: "Review before executing. Consider safer alternatives.",
        decision: "ask",
      });
    }
  }

  // ── 3. Secret scan ────────────────────────────────────────────────

  const secretFindings = scanStringForSecrets(text);
  for (const sf of secretFindings) {
    const decision = resolveDecision(policy, "secret-exposure");
    findings.push({
      id: `lookout.${findingId++}`,
      category: "secret-exposure",
      title: `Secret detected: ${sf.type}`,
      severity: decisionToSeverity(decision),
      evidence: sf.type,
      advice: sf.suggestion,
      decision,
    });
  }

  // ── 4. Preview skill check ────────────────────────────────────────

  if (options.activeSkill && options.skillData) {
    const warning = checkSkillForEnv(options.activeSkill, options.skillData, policy.environment as Environment);
    if (warning) {
      const decision = resolveDecision(policy, "preview-skill-on-prod");
      findings.push({
        id: `lookout.${findingId++}`,
        category: "preview-skill-on-prod",
        title: `Preview skill on prod: ${warning.skill}`,
        severity: decisionToSeverity(decision),
        evidence: `${warning.skill} (${warning.status})`,
        advice: warning.advice,
        decision,
      });
    }
  }

  // ── 5. Compute verdict ────────────────────────────────────────────

  const verdict = verdictFromFindings(findings);

  // ── 6. Audit log ──────────────────────────────────────────────────

  if (options.auditLogger) {
    const auditFindings: AuditFinding[] = findings.map((f) => ({
      category: f.category,
      severity: f.severity,
      evidence: f.evidence,
    }));

    const topDecision = findings.some((f) => f.decision === "deny")
      ? "deny"
      : findings.some((f) => f.decision === "ask")
        ? "ask"
        : "allow";

    await options.auditLogger.log({
      time: new Date().toISOString(),
      tool: options.toolName ?? "unknown",
      command: redactSecrets(text),
      findings: auditFindings,
      decision: topDecision,
      env: policy.environment,
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    source: text.slice(0, 200),
    findings,
    verdict,
  };
}

// ── File content scan ─────────────────────────────────────────────────

/**
 * Scan file content for secrets before writing.
 * Returns findings with suggested Orchestrator Asset replacements.
 */
export async function scanFileContent(
  content: string,
  filePath: string,
  options: LookoutOptions = {}
): Promise<{ secrets: SecretFinding[]; verdict: "clear" | "advisory" }> {
  if (!shouldScanFile(filePath)) {
    return { secrets: [], verdict: "clear" };
  }

  const secrets = scanForSecrets(content, filePath);

  if (secrets.length > 0) {
    // Audit the file scan
    if (options.auditLogger) {
      await options.auditLogger.log({
        time: new Date().toISOString(),
        tool: options.toolName ?? "write",
        command: redactSecrets(`file:${filePath} secrets:${secrets.length}`),
        findings: secrets.map((s) => ({
          category: "secret-exposure",
          severity: "medium",
          evidence: s.type,
        })),
        decision: "ask",
        env: options.policy?.environment ?? "dev",
      });
    }
  }

  return {
    secrets,
    verdict: secrets.length > 0 ? "advisory" : "clear",
  };
}

// ── Re-exports ────────────────────────────────────────────────────────

export { tokenizeUipCommand, extractUipCommands, isDestructive, hasDangerousFlag, hasScopeFlag, type UipCommand, type ParsedCommand } from "./tokenizer.js";
export { type Policy, type PolicyRule, type FindingCategory, type Decision, type Environment, resolveDecision, DEFAULT_POLICY, loadPolicy, detectEnvironment, parsePolicyYaml } from "./policy.js";
export { type SecretFinding, scanForSecrets, scanStringForSecrets, shouldScanFile } from "./secrets.js";
export { type PreviewWarning, type SkillStatusData, checkSkillForEnv, getNonStableSkills } from "./preview-check.js";
export { AuditLogger, redactSecrets, type AuditEntry } from "./audit.js";
