/**
 * Lookout — pre-flight danger scan with UiPath awareness
 *
 * DELEGATES to @omu-c/lookout (packages/lookout/dist).
 */

import { scan as lookoutScan } from "../../packages/lookout/dist/index.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface LookoutFinding {
  id: string;
  title: string;
  severity: "high" | "medium" | "low" | "info";
  confidence: "high" | "low";
  actionable: boolean;
  evidence: string | string[];
  advice: string;
  category?: string;
  decision?: "allow" | "ask" | "deny";
}

export interface LookoutReport {
  scannedAt: string;
  briefSource: string;
  findings: LookoutFinding[];
  summary: {
    counts: Record<string, number>;
    verdict: "clear" | "advisory" | "review-recommended" | "blocked";
  };
}

// ─── Legacy API ───────────────────────────────────────────────────────

export async function scanLookout(brief: string): Promise<LookoutReport> {
  const result = await lookoutScan(brief);

  // Map new findings to legacy format (ask/deny → high severity for legacy compat)
  const findings: LookoutFinding[] = result.findings.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.decision === "deny" ? "high" as const : f.decision === "ask" ? "high" as const : f.severity,
    confidence: f.severity === "high" || f.decision !== "allow" ? "high" as const : "low" as const,
    actionable: f.decision !== "allow",
    evidence: f.evidence,
    advice: f.advice,
    category: f.category,
    decision: f.decision,
  }));

  // Compute counts from mapped findings
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  // Map verdict: anything with high severity → review-recommended
  const legacyVerdict: LookoutReport["summary"]["verdict"] =
    result.verdict === "blocked" ? "review-recommended"
    : findings.some(f => f.severity === "high") ? "review-recommended"
    : result.verdict;

  return {
    scannedAt: result.scannedAt,
    briefSource: result.source,
    findings,
    summary: { counts, verdict: legacyVerdict },
  };
}
