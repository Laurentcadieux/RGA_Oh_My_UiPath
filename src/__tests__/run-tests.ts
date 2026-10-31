/**
 * Simple test runner (sandbox-friendly replacement for vitest)
 */
import { parseFrontmatter } from "../skills/frontmatter.ts";
import { scanLookout } from "../lookout/index.ts";
import { validateWorkflowStages } from "../pipeline/adapter.ts";
import { scanCommand, scanForSecrets, scanTask, scanScope } from "../lookout/uipath-lookout.ts";
import { createInterview, answerQuestion, getNextQuestion, batchAnswer, generateDesignDocument, completeInterview } from "../interview/index.ts";

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

console.log("\n=== uipath-lookout: scanCommand ===");
{
  const f = scanCommand("uip or robots delete --id 5");
  assert(f.length > 0, "detects delete robot");
  assert(f[0].category === "uipath-destructive", "category is uipath-destructive");
}
{
  const f = scanCommand("uip rpa publish --force");
  assert(f.length > 0, "detects --force production op");
  assert(f.some(x => x.category === "uipath-production"), "category is uipath-production");
}
{
  const f = scanCommand("uip rpa pack");
  assert(f.length === 0, "safe command → no findings");
}

console.log("\n=== uipath-lookout: scanForSecrets ===");
{
  const f = scanForSecrets('{"password": "s3cret"}', "config.json");
  assert(f.length > 0, "detects hardcoded password");
  assert(f[0].category === "uipath-secrets", "category is uipath-secrets");
}
{
  const f = scanForSecrets('{"apiKey": "abc123xyz"}', "settings.json");
  assert(f.length > 0, "detects hardcoded api key");
}
{
  const f = scanForSecrets('{"name": "safe-value"}', "safe.json");
  assert(f.length === 0, "safe content → no findings");
}

console.log("\n=== uipath-lookout: scanScope ===");
{
  const f = scanScope("uip rpa deploy --environment prod");
  assert(f.some(x => x.id === "scope-no-folder"), "prod without folder → scope warning");
}
{
  const f = scanScope("uip rpa deploy --folder Finance", { tenant: "default" });
  assert(!f.some(x => x.id === "scope-no-folder"), "with folder → no folder warning");
}

console.log("\n=== uipath-lookout: scanTask (combined) ===");
{
  const r = scanTask("uip or queues delete --id 42 --force");
  assert(r.status === "review-recommended", "combined destructive+force → review");
  assert(r.findings.length >= 2, "multiple findings");
}
{
  const r = scanTask("uip rpa pack");
  assert(r.status === "clear", "safe task → clear");
}

console.log("\n=== interview: createInterview ===");
{
  const s = createInterview();
  assert(s.questions.length > 10, "has questions");
  assert(s.status === "pending", "initial status is pending");
  assert(s.completedCount === 0, "no answers yet");
}
{
  const s = createInterview("coded-agent");
  assert(s.questions.some(q => q.id === "agent-trigger"), "coded-agent gets agent questions");
  assert(s.questions.some(q => q.id === "agent-tools"), "coded-agent gets agent-tools question");
}

console.log("\n=== interview: answerQuestion ===");
{
  let s = createInterview();
  const first = getNextQuestion(s)!;
  s = answerQuestion(s, first.id, "Invoice Processing");
  assert(s.completedCount === 1, "one answer recorded");
  assert(s.status === "in-progress", "status is in-progress");
}
{
  let s = createInterview();
  // Answer all questions
  for (const q of s.questions) {
    s = answerQuestion(s, q.id, "test answer");
  }
  assert(s.status === "complete", "all answered → complete");
  assert(s.completedCount === s.totalCount, "count matches total");
}

console.log("\n=== interview: batchAnswer ===");
{
  const s = createInterview();
  const answers: Record<string, string> = {};
  for (const q of s.questions.slice(0, 3)) {
    answers[q.id] = "batch answer";
  }
  const result = batchAnswer(s, answers);
  assert(result.completedCount === 3, "batch answered 3");
}

console.log("\n=== interview: generateDesignDocument ===");
{
  let s = createInterview("classic-rpa");
  s = batchAnswer(s, {
    "process-name": "Invoice Processing",
    "process-trigger": "Email arrival",
    "data-input": "Email attachments (PDF)",
    "data-output": "ERP system",
    "error-strategy": "Retry 3x, then escalate",
    "orch-queues": "Yes — producer/consumer",
    "orch-environment": "Dev → Test → Prod",
    "deploy-robot": "Unattended",
    "deploy-runtime": "Windows",
    "hitl-needed": "Yes — exception review",
  });
  const doc = generateDesignDocument(s);
  assert(doc.includes("Invoice Processing"), "doc contains process name");
  assert(doc.includes("Email arrival"), "doc contains trigger");
  assert(doc.includes("## Process Scope"), "doc has section headers");
}

console.log("\n=== interview: completeInterview ===");
{
  const answers: Record<string, string> = {
    "process-name": "Order Fulfillment",
    "process-trigger": "Queue item",
    "data-input": "Orchestrator Queue",
    "data-output": "Database + Email",
    "error-strategy": "System retry + business exception",
    "orch-queues": "Yes",
    "orch-environment": "Dev → Prod",
    "deploy-robot": "Unattended",
    "deploy-runtime": "Cross-platform",
  };
  const result = completeInterview(answers, "coded-automation");
  assert(result.session.completedCount > 0, "some questions answered");
  assert(result.designDocument.includes("Order Fulfillment"), "design doc generated");
  assert(result.pipelineInput.task.includes("Order Fulfillment"), "pipeline input generated");
  assert(result.pipelineInput.skills.length > 0, "skills suggested");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
