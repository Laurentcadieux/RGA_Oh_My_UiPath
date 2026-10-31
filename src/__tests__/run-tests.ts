/**
 * Simple test runner (sandbox-friendly replacement for vitest)
 */
import { parseFrontmatter } from "../skills/frontmatter.ts";
import { scanLookout } from "../lookout/index.ts";
import { validateWorkflowStages } from "../pipeline/adapter.ts";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`  ❌ ${msg}`); }
  else { passed++; console.log(`  ✅ ${msg}`); }
}

console.log("\n=== parseFrontmatter ===");
{
  const r = parseFrontmatter("---\nname: test-skill\ndescription: A test skill\nmodel: sonnet\n---\n# Body\nSome text.");
  assert(r.frontmatter.name === "test-skill", "basic name");
  assert(r.frontmatter.model === "sonnet", "basic model");
  assert(r.body.trim().includes("Body"), "basic body");
}
{
  const r = parseFrontmatter("---\nname: uipath-rpa\ndescription: RPA\nuip-skill: uipath-rpa\nuip-maturity: stable\n---\nBody");
  assert(r.frontmatter["uip-skill"] === "uipath-rpa", "uip-skill");
  assert(r.frontmatter["uip-maturity"] === "stable", "uip-maturity");
}
{
  const r = parseFrontmatter("Just body text.");
  assert(r.frontmatter.name === "", "missing frontmatter → empty name");
}

console.log("\n=== scanLookout ===");
{
  const r = await scanLookout("Build the workflow and run tests");
  assert(r.summary.verdict === "clear", "safe task → clear");
  assert(r.findings.length === 0, "safe task → 0 findings");
}
{
  const r = await scanLookout("rm -rf /tmp/test && git push --force");
  assert(r.summary.verdict === "review-recommended", "force ops → review-recommended");
  assert(r.findings.some(f => f.id.includes("force-op")), "detects force-op");
}
{
  const r = await scanLookout("uip or queues delete --id 42");
  assert(r.summary.verdict === "review-recommended", "uipath destructive → review-recommended");
  assert(r.findings.some(f => f.id.includes("uipath-destructive")), "detects uipath-destructive");
}
{
  const r = await scanLookout("Configure UIPATH_PAT for auth");
  assert(r.summary.verdict === "advisory", "secrets → advisory");
  assert(r.findings.some(f => f.id.includes("uipath-secrets")), "detects uipath-secrets");
}

console.log("\n=== validateWorkflowStages ===");
{
  assert(validateWorkflowStages(["ralplan", "execution"]).valid, "ralplan+execution valid");
  assert(validateWorkflowStages(["ralplan", "execution", "ralph", "qa"]).valid, "full pipeline valid");
  assert(!validateWorkflowStages(["ralplan"]).valid, "single stage invalid");
  assert(!validateWorkflowStages(["execution", "ralplan"]).valid, "wrong order invalid");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
