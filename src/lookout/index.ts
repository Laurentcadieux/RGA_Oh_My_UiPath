/**
 * Lookout — pre-flight danger scan with UiPath awareness
 *
 * Adapted from OMC's advisory-only, zero-config design.
 * Adds UiPath-specific signals:
 * - Orchestrator destructive operations (delete queue, remove robot, etc.)
 * - Credential/asset exposure in deployment commands
 * - Tenant-wide changes (admin operations)
 */

export interface LookoutFinding {
  id: string; // "lookout.<surface>.<signal>"
  title: string;
  severity: "high" | "medium" | "low" | "info";
  confidence: "high" | "low";
  actionable: boolean;
  evidence: string[];
  advice: string;
}

export interface LookoutReport {
  scannedAt: string;
  briefSource: string;
  findings: LookoutFinding[];
  summary: {
    counts: Record<string, number>;
    verdict: "clear" | "advisory" | "review-recommended";
  };
}

/** Force-op patterns (same as OMC) */
const FORCE_OPS = [
  /rm\s+-rf/i,
  /git\s+push\s+--force/i,
  /git\s+push\s+-f\b/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /TRUNCATE\s+TABLE/i,
];

/** UiPath destructive operation patterns */
const UIPATH_DESTRUCTIVE = [
  /uip\s+or\s+queues\s+delete/i,
  /uip\s+or\s+robots\s+delete/i,
  /uip\s+or\s+jobs\s+stop/i,
  /uip\s+or\s+assets\s+delete/i,
  /uip\s+or\s+machines\s+delete/i,
  /uip\s+admin\s+.*\s+delete/i,
  /uip\s+solution\s+deactivate/i,
];

/** UiPath credential/secret patterns */
const UIPATH_SECRETS = [
  /UIPATH_PAT/i,
  /UIPATH_CLIENT_SECRET/i,
  /clientSecret/i,
  /personal.access.token/i,
  /--secret/i,
  /--password/i,
  /--api-key/i,
];

export async function scanLookout(brief: string): Promise<LookoutReport> {
  const findings: LookoutFinding[] = [];

  // Scan for force ops
  for (const pattern of FORCE_OPS) {
    if (pattern.test(brief)) {
      findings.push({
        id: "lookout.brief.force-op",
        title: "Destructive command detected",
        severity: "high",
        confidence: "high",
        actionable: true,
        evidence: [brief.match(pattern)![0]],
        advice: "Use omu graph run --approval-mode remote --checkpoint for safe execution with rollback.",
      });
    }
  }

  // Scan for UiPath destructive ops
  for (const pattern of UIPATH_DESTRUCTIVE) {
    if (pattern.test(brief)) {
      findings.push({
        id: "lookout.brief.uipath-destructive",
        title: "UiPath destructive operation",
        severity: "high",
        confidence: "high",
        actionable: true,
        evidence: [brief.match(pattern)![0]],
        advice: "This modifies Orchestrator state. Run with --dry-run first, or use checkpointing.",
      });
    }
  }

  // Scan for secrets
  for (const pattern of UIPATH_SECRETS) {
    if (pattern.test(brief)) {
      findings.push({
        id: "lookout.brief.uipath-secrets",
        title: "Credential/secret reference in task",
        severity: "medium",
        confidence: "high",
        actionable: true,
        evidence: [brief.match(pattern)![0]],
        advice: "Use environment variables or UiPath credential stores instead of inline secrets.",
      });
    }
  }

  // Compute verdict
  const highCount = findings.filter((f) => f.severity === "high").length;
  const medCount = findings.filter((f) => f.severity === "medium").length;
  const verdict: LookoutReport["summary"]["verdict"] =
    highCount > 0 ? "review-recommended" : medCount > 0 ? "advisory" : "clear";

  return {
    scannedAt: new Date().toISOString(),
    briefSource: brief.slice(0, 200),
    findings,
    summary: {
      counts: { high: highCount, medium: medCount, low: 0, info: 0 },
      verdict,
    },
  };
}
