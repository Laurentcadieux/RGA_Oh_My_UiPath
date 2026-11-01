/**
 * Lookout Test Suite — unit tests + corpus benchmark
 */

import { describe, it, expect } from "vitest";
import {
  scan,
  scanFileContent,
  extractUipCommands,
  tokenizeUipCommand,
  isDestructive,
  hasDangerousFlag,
  hasScopeFlag,
} from "../src/index.js";
import { resolveDecision, DEFAULT_POLICY, parsePolicyYaml, detectEnvironment } from "../src/policy.js";
import { redactSecrets } from "../src/audit.js";
import { scanForSecrets, shouldScanFile } from "../src/secrets.js";
import { checkSkillForEnv } from "../src/preview-check.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ─── Tokenizer tests ──────────────────────────────────────────────────

describe("extractUipCommands", () => {
  it("extracts a single uip command", () => {
    const cmds = extractUipCommands("uip orchestrator queues delete --id 42");
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toContain("uip orchestrator queues delete");
  });

  it("extracts compound commands with &&", () => {
    const cmds = extractUipCommands("uip sol pack && uip sol publish");
    expect(cmds).toHaveLength(2);
  });

  it("extracts compound commands with ;", () => {
    const cmds = extractUipCommands("uip or queues list; uip or robots list");
    expect(cmds).toHaveLength(2);
  });

  it("returns empty for English text", () => {
    const cmds = extractUipCommands("Delete the queue after processing is complete");
    expect(cmds).toHaveLength(0);
  });
});

describe("tokenizeUipCommand", () => {
  it("tokenizes orchestrator subcommand with verb", () => {
    const result = tokenizeUipCommand("uip orchestrator queues delete --id 42");
    expect(result.isUipCommand).toBe(true);
    if (result.isUipCommand) {
      expect(result.resource).toBe("orchestrator.queues");
      expect(result.verb).toBe("delete");
      expect(result.flags.get("id")).toBe("42");
    }
  });

  it("resolves 'or' alias to 'orchestrator'", () => {
    const result = tokenizeUipCommand("uip or queues delete --name MyQueue");
    expect(result.isUipCommand).toBe(true);
    if (result.isUipCommand) {
      expect(result.resource).toBe("orchestrator.queues");
      expect(result.verb).toBe("delete");
    }
  });

  it("tokenizes solution command", () => {
    const result = tokenizeUipCommand("uip solution deploy --name MySol --folder Prod --tenant Default");
    expect(result.isUipCommand).toBe(true);
    if (result.isUipCommand) {
      expect(result.resource).toBe("solution");
      expect(result.verb).toBe("deploy");
      expect(result.flags.get("folder")).toBe("Prod");
      expect(result.flags.get("tenant")).toBe("Default");
    }
  });

  it("returns NotUipCommand for non-uip text", () => {
    const result = tokenizeUipCommand("Delete the queue after processing");
    expect(result.isUipCommand).toBe(false);
  });

  it("handles admin subcommand", () => {
    const result = tokenizeUipCommand("uip admin tenants delete --name TestTenant");
    expect(result.isUipCommand).toBe(true);
    if (result.isUipCommand) {
      expect(result.resource).toBe("admin.tenants");
      expect(result.verb).toBe("delete");
    }
  });
});

describe("isDestructive", () => {
  it("flags delete as destructive", () => {
    const cmd = tokenizeUipCommand("uip orchestrator queues delete --id 1");
    if (cmd.isUipCommand) expect(isDestructive(cmd)).toBe(true);
  });

  it("flags purge as destructive", () => {
    const cmd = tokenizeUipCommand("uip orchestrator queues purge --name Q");
    if (cmd.isUipCommand) expect(isDestructive(cmd)).toBe(true);
  });

  it("does not flag list as destructive", () => {
    const cmd = tokenizeUipCommand("uip orchestrator queues list");
    if (cmd.isUipCommand) expect(isDestructive(cmd)).toBe(false);
  });
});

describe("hasDangerousFlag", () => {
  it("detects --force", () => {
    const cmd = tokenizeUipCommand("uip orchestrator queues delete --id 1 --force");
    if (cmd.isUipCommand) expect(hasDangerousFlag(cmd)).toContain("--force");
  });

  it("detects --yes", () => {
    const cmd = tokenizeUipCommand("uip solution deploy --name Sol --yes");
    if (cmd.isUipCommand) expect(hasDangerousFlag(cmd)).toContain("--yes");
  });

  it("returns empty for safe flags", () => {
    const cmd = tokenizeUipCommand("uip orchestrator queues list --folder Default");
    if (cmd.isUipCommand) expect(hasDangerousFlag(cmd)).toHaveLength(0);
  });
});

describe("hasScopeFlag", () => {
  it("detects --folder and --tenant", () => {
    const cmd = tokenizeUipCommand("uip solution deploy --name Sol --folder F --tenant T");
    if (cmd.isUipCommand) {
      const scope = hasScopeFlag(cmd);
      expect(scope.hasFolder).toBe(true);
      expect(scope.hasTenant).toBe(true);
    }
  });

  it("detects missing scope flags", () => {
    const cmd = tokenizeUipCommand("uip solution deploy --name Sol");
    if (cmd.isUipCommand) {
      const scope = hasScopeFlag(cmd);
      expect(scope.hasFolder).toBe(false);
      expect(scope.hasTenant).toBe(false);
    }
  });
});

// ─── Core scan tests ──────────────────────────────────────────────────

describe("scan — command-aware (no free-text false positives)", () => {
  it("returns clear for English text mentioning delete and queue", async () => {
    const result = await scan("Delete the queue after processing is complete");
    expect(result.verdict).toBe("clear");
    expect(result.findings).toHaveLength(0);
  });

  it("flags real uip destructive command", async () => {
    const result = await scan("uip orchestrator queues delete --id 42");
    expect(result.verdict).not.toBe("clear");
    expect(result.findings.some((f) => f.category === "destructive")).toBe(true);
  });

  it("returns clear for safe uip command", async () => {
    const result = await scan("uip orchestrator queues list");
    expect(result.verdict).toBe("clear");
  });

  it("flags --force on destructive command", async () => {
    const result = await scan("uip orchestrator queues delete --id 42 --force");
    expect(result.findings.some((f) => f.category === "destructive")).toBe(true);
    expect(result.findings.some((f) => f.category === "dangerous-flag")).toBe(true);
  });

  it("flags scope violation on deploy without folder/tenant", async () => {
    const result = await scan("uip solution deploy --name MySol");
    expect(result.findings.some((f) => f.category === "scope-violation")).toBe(true);
  });

  it("no scope violation when folder and tenant are present", async () => {
    const result = await scan("uip solution deploy --name MySol --folder Prod --tenant Default");
    expect(result.findings.some((f) => f.category === "scope-violation")).toBe(false);
  });

  it("flags generic rm -rf", async () => {
    const result = await scan("rm -rf /tmp/test");
    expect(result.findings.some((f) => f.category === "destructive")).toBe(true);
  });

  it("flags git push --force", async () => {
    const result = await scan("git push --force origin main");
    expect(result.findings.some((f) => f.category === "destructive")).toBe(true);
  });
});

// ─── Policy tests ─────────────────────────────────────────────────────

describe("policy", () => {
  it("default policy: destructive on prod = deny", () => {
    const policy = { ...DEFAULT_POLICY, environment: "prod" as const };
    expect(resolveDecision(policy, "destructive")).toBe("deny");
  });

  it("default policy: destructive on dev = ask", () => {
    const policy = { ...DEFAULT_POLICY, environment: "dev" as const };
    expect(resolveDecision(policy, "destructive")).toBe("ask");
  });

  it("default policy: dangerous-flag on prod = deny", () => {
    const policy = { ...DEFAULT_POLICY, environment: "prod" as const };
    expect(resolveDecision(policy, "dangerous-flag")).toBe("deny");
  });

  it("default policy: secret-exposure = ask", () => {
    expect(resolveDecision(DEFAULT_POLICY, "secret-exposure")).toBe("ask");
  });

  it("parses custom YAML policy", () => {
    const yaml = `
environment: prod
rules:
  - category: destructive
    env:
      dev: allow
      staging: ask
      prod: deny
`;
    const policy = parsePolicyYaml(yaml);
    expect(policy.environment).toBe("prod");
    expect(resolveDecision(policy, "destructive")).toBe("deny");
  });
});

// ─── Secrets tests ────────────────────────────────────────────────────

describe("secrets scanner", () => {
  it("detects hardcoded password", () => {
    const findings = scanForSecrets('{"password": "s3cret"}', "config.json");
    expect(findings.some((f) => f.type === "hardcoded-password")).toBe(true);
  });

  it("detects AWS access key", () => {
    const findings = scanForSecrets("key=AKIAIOSFODNN7EXAMPLE", "appsettings.json");
    expect(findings.some((f) => f.type === "aws-access-key")).toBe(true);
  });

  it("does not flag password field name without value", () => {
    const findings = scanForSecrets('{"description": "Reset password for user"}', "config.json");
    expect(findings).toHaveLength(0);
  });

  it("shouldScanFile filters by extension", () => {
    expect(shouldScanFile("app.xaml")).toBe(true);
    expect(shouldScanFile("Program.cs")).toBe(true);
    expect(shouldScanFile("image.png")).toBe(false);
    expect(shouldScanFile("style.css")).toBe(false);
  });

  it("shouldScanFile flags known filenames", () => {
    expect(shouldScanFile("project.json")).toBe(true);
    expect(shouldScanFile(".env")).toBe(true);
    expect(shouldScanFile("appsettings.json")).toBe(true);
  });
});

// ─── Audit redaction tests ────────────────────────────────────────────

describe("audit redaction", () => {
  it("redacts password values", () => {
    const result = redactSecrets('"password": "s3cret123"');
    expect(result).not.toContain("s3cret123");
    expect(result).toContain("<redacted:");
  });

  it("redacts AWS keys", () => {
    const result = redactSecrets("AKIAIOSFODNN7EXAMPLE");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("preserves non-secret content", () => {
    const input = "uip orchestrator queues list --folder Default";
    expect(redactSecrets(input)).toBe(input);
  });
});

// ─── Preview skill tests ──────────────────────────────────────────────

describe("preview skill checker", () => {
  const mockSkillData = {
    generated_at: "2026-01-01",
    schema_version: 1,
    statuses: {
      stable: { label: "Stable", meaning: "Production-ready" },
      preview: { label: "Preview", meaning: "May change" },
      "in-development": { label: "In-development", meaning: "Incomplete" },
    },
    skills: {
      "uipath-rpa": { status: "stable" as const },
      "uipath-insights": { status: "preview" as const },
      "uipath-maestro-bpmn": { status: "in-development" as const },
    },
  };

  it("no warning for stable skill on prod", () => {
    expect(checkSkillForEnv("uipath-rpa", mockSkillData, "prod")).toBeNull();
  });

  it("warns for preview skill on prod", () => {
    const warning = checkSkillForEnv("uipath-insights", mockSkillData, "prod");
    expect(warning).not.toBeNull();
    expect(warning!.status).toBe("preview");
  });

  it("no warning for preview skill on dev", () => {
    expect(checkSkillForEnv("uipath-insights", mockSkillData, "dev")).toBeNull();
  });

  it("warns for in-development skill on prod", () => {
    const warning = checkSkillForEnv("uipath-maestro-bpmn", mockSkillData, "prod");
    expect(warning).not.toBeNull();
    expect(warning!.status).toBe("in-development");
  });
});

// ─── File content scan ────────────────────────────────────────────────

describe("scanFileContent", () => {
  it("skips non-scannable files", async () => {
    const result = await scanFileContent("content", "image.png");
    expect(result.verdict).toBe("clear");
  });

  it("detects secrets in scannable files", async () => {
    const result = await scanFileContent('{"password": "secret123"}', "config.json");
    expect(result.secrets.length).toBeGreaterThan(0);
    expect(result.verdict).toBe("advisory");
  });
});

// ─── Corpus benchmark ─────────────────────────────────────────────────

describe("corpus benchmark", () => {
  const corpusDir = join(import.meta.dirname, "..", "corpus");

  it("runs all corpus cases and meets targets", async () => {
    const files = readdirSync(corpusDir).filter((f) => f.endsWith(".jsonl"));
    let totalCases = 0;
    let totalCorrect = 0;
    const categoryStats: Record<string, { total: number; correct: number; falsePositives: number; falseNegatives: number }> = {};

    for (const file of files) {
      const category = file.replace(".jsonl", "");
      categoryStats[category] = { total: 0, correct: 0, falsePositives: 0, falseNegatives: 0 };

      const content = readFileSync(join(corpusDir, file), "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        const testCase = JSON.parse(line);
        const result = await scan(testCase.input);

        totalCases++;
        categoryStats[category].total++;

        // Check verdict match
        const verdictMatch = result.verdict === testCase.expectedVerdict;
        if (verdictMatch) {
          totalCorrect++;
          categoryStats[category].correct++;
        } else {
          // Classify the error
          if (testCase.expectedVerdict === "clear" && result.verdict !== "clear") {
            categoryStats[category].falsePositives++;
          } else {
            categoryStats[category].falseNegatives++;
          }
        }
      }
    }

    // Report
    const overallAccuracy = totalCorrect / totalCases;
    const destructiveNearMiss = categoryStats["destructive-near-miss"];
    const destructiveReal = categoryStats["destructive-real"];

    // Compute false positive rate (cases expected clear but weren't)
    let totalExpectedClear = 0;
    let falsePositives = 0;
    for (const [cat, stats] of Object.entries(categoryStats)) {
      if (cat.includes("near-miss") || cat.includes("safe") || cat.includes("clean")) {
        totalExpectedClear += stats.total;
        falsePositives += stats.falsePositives;
      }
    }
    const falsePositiveRate = totalExpectedClear > 0 ? falsePositives / totalExpectedClear : 0;

    // Log results (visible in test output)
    console.log("\n═══ Lookout Corpus Benchmark ═══");
    console.log(`Total cases: ${totalCases}`);
    console.log(`Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
    console.log(`False positive rate: ${(falsePositiveRate * 100).toFixed(1)}%`);
    console.log(`\nPer-category:`);
    for (const [cat, stats] of Object.entries(categoryStats)) {
      const acc = ((stats.correct / stats.total) * 100).toFixed(1);
      console.log(`  ${cat}: ${stats.correct}/${stats.total} (${acc}%) FP:${stats.falsePositives} FN:${stats.falseNegatives}`);
    }

    // Targets
    // Zero misses on destructive-on-prod (destructive-real must be 100%)
    const destructiveRealAccuracy = destructiveReal ? destructiveReal.correct / destructiveReal.total : 0;
    expect(destructiveRealAccuracy).toBe(1); // zero misses on destructive

    // Under 5% false positives overall
    expect(falsePositiveRate).toBeLessThan(0.05);

    // Overall should be > 90%
    expect(overallAccuracy).toBeGreaterThan(0.9);
  });
});
