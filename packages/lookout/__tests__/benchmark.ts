/**
 * Corpus benchmark runner for packages/lookout
 *
 * Runs corpus against the scanner with dev policy (default) and reports.
 * The destructive-real corpus is also run against prod policy to verify
 * the zero-miss-on-prod target.
 */
import { scan } from "../dist/index.js";
import { DEFAULT_POLICY } from "../dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const corpusDir = join(import.meta.dirname, "..", "corpus");
const files = readdirSync(corpusDir).filter(f => f.endsWith(".jsonl"));

// ─── Run with dev policy (default) ────────────────────────────────────

let totalCases = 0;
let totalCorrect = 0;
const categoryStats = {};

const devPolicy = { ...DEFAULT_POLICY, environment: "dev" };

for (const file of files) {
  const category = file.replace(".jsonl", "");
  categoryStats[category] = { total: 0, correct: 0, falsePositives: 0, falseNegatives: 0 };

  const content = readFileSync(join(corpusDir, file), "utf-8");
  const lines = content.trim().split("\n");

  for (const line of lines) {
    const testCase = JSON.parse(line);
    const result = await scan(testCase.input, { policy: devPolicy });

    totalCases++;
    categoryStats[category].total++;

    const verdictMatch = result.verdict === testCase.expectedVerdict;
    if (verdictMatch) {
      totalCorrect++;
      categoryStats[category].correct++;
    } else {
      if (testCase.expectedVerdict === "clear" && result.verdict !== "clear") {
        categoryStats[category].falsePositives++;
      } else {
        categoryStats[category].falseNegatives++;
      }
    }
  }
}

// ─── Run destructive-real with PROD policy (key target) ──────────────

const prodPolicy = { ...DEFAULT_POLICY, environment: "prod" };
const destructiveRealContent = readFileSync(join(corpusDir, "destructive-real.jsonl"), "utf-8");
const destructiveRealLines = destructiveRealContent.trim().split("\n");
let prodDestructiveCorrect = 0;
let prodDestructiveTotal = 0;

for (const line of destructiveRealLines) {
  const testCase = JSON.parse(line);
  const result = await scan(testCase.input, { policy: prodPolicy });
  prodDestructiveTotal++;
  // On prod, destructive ops should be blocked (verdict = "blocked")
  if (result.verdict === "blocked") prodDestructiveCorrect++;
}

const prodDestructiveAccuracy = prodDestructiveCorrect / prodDestructiveTotal;

// ─── Compute false positive rate ──────────────────────────────────────

let totalExpectedClear = 0;
let falsePositives = 0;
for (const [cat, stats] of Object.entries(categoryStats)) {
  if (cat.includes("near-miss") || cat.includes("safe") || cat.includes("clean")) {
    totalExpectedClear += stats.total;
    falsePositives += stats.falsePositives;
  }
}
const falsePositiveRate = totalExpectedClear > 0 ? falsePositives / totalExpectedClear : 0;
const overallAccuracy = totalCorrect / totalCases;

// ─── Report ───────────────────────────────────────────────────────────

console.log("\n═══ Lookout Corpus Benchmark ═══");
console.log(`Policy: dev (default)`);
console.log(`Total cases: ${totalCases}`);
console.log(`Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
console.log(`False positive rate: ${(falsePositiveRate * 100).toFixed(1)}%`);
console.log(`\nPer-category:`);
for (const [cat, stats] of Object.entries(categoryStats)) {
  const acc = ((stats.correct / stats.total) * 100).toFixed(1);
  console.log(`  ${cat}: ${stats.correct}/${stats.total} (${acc}%) FP:${stats.falsePositives} FN:${stats.falseNegatives}`);
}

console.log(`\n═══ Prod Policy: Destructive-on-Prod ═══`);
console.log(`  ${prodDestructiveCorrect}/${prodDestructiveTotal} blocked on prod (${(prodDestructiveAccuracy * 100).toFixed(1)}%)`);

console.log(`\n═══ Targets ═══`);
console.log(`  Destructive-on-prod: ${(prodDestructiveAccuracy * 100).toFixed(1)}% (target: 100%) ${prodDestructiveAccuracy === 1 ? "✅" : "❌"}`);
console.log(`  False positive rate: ${(falsePositiveRate * 100).toFixed(1)}% (target: <5%) ${falsePositiveRate < 0.05 ? "✅" : "❌"}`);
console.log(`  Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}% (target: >90%) ${overallAccuracy > 0.9 ? "✅" : "❌"}`);

if (prodDestructiveAccuracy < 1) {
  console.log(`\n❌ MISSED TARGET: Destructive-on-prod accuracy is ${(prodDestructiveAccuracy * 100).toFixed(1)}% (must be 100%)`);
  process.exit(1);
}
if (falsePositiveRate >= 0.05) {
  console.log(`\n❌ MISSED TARGET: False positive rate is ${(falsePositiveRate * 100).toFixed(1)}% (must be <5%)`);
  process.exit(1);
}
console.log(`\n✅ All targets met.`);
