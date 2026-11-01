/**
 * Simple test runner (sandbox-friendly replacement for vitest)
 */
import { parseFrontmatter } from "../skills/frontmatter.ts";
import { scanLookout } from "../lookout/index.ts";
import { validateWorkflowStages } from "../pipeline/adapter.ts";
import { scanTask, scanProject } from "../lookout/uipath-lookout.ts";
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

console.log("\n=== scanLookout (new command-aware scanner) ===");
{
  const r = await scanLookout("Build the workflow and run tests");
  assert(r.summary.verdict === "clear", "safe English text → clear");
  assert(r.findings.length === 0, "safe English text → 0 findings");
}
{
  const r = await scanLookout("rm -rf /tmp/test && git push --force");
  assert(r.summary.verdict === "review-recommended", "force ops → review-recommended");
}
{
  const r = await scanLookout("uip or queues delete --id 42");
  assert(r.summary.verdict === "review-recommended", "uip destructive → review-recommended");
  assert(r.findings.some(f => f.category === "destructive"), "detects destructive category");
}
{
  // KEY TEST: free text mentioning "delete" and "queue" must NOT trigger
  const r = await scanLookout("Delete the queue after processing is complete");
  assert(r.summary.verdict === "clear", "English text with 'delete queue' → clear (no false positive)");
  assert(r.findings.length === 0, "no findings for English text");
}

console.log("\n=== scanTask (legacy uipath-lookout, now command-aware) ===");
{
  const r = scanTask("uip orchestrator robots delete --id 5");
  assert(r.status === "review-recommended", "detects delete robot");
  assert(r.findings.some(f => f.category === "uipath-destructive"), "category is uipath-destructive");
}
{
  const r = scanTask("uip solution deploy --name Sol --force");
  assert(r.status === "review-recommended", "detects --force + scope violation");
  assert(r.findings.some(f => f.category === "uipath-production"), "detects dangerous flag");
}
{
  const r = scanTask("uip rpa pack");
  assert(r.status === "clear", "safe command → clear");
}
{
  const r = scanTask("uip orchestrator queues delete --id 42 --force");
  assert(r.status === "review-recommended", "combined destructive+force → review");
  assert(r.findings.length >= 2, "multiple findings");
}
{
  // Command-aware: English text must not trigger
  const r = scanTask("We should delete old robots from the fleet");
  assert(r.status === "clear", "English text 'delete robots' → clear (no false positive)");
}

console.log("\n=== validateWorkflowStages ===");
{
  assert(validateWorkflowStages(["ralplan", "execution"]).valid, "ralplan+execution valid");
  assert(validateWorkflowStages(["ralplan", "execution", "ralph", "qa"]).valid, "full pipeline valid");
  assert(!validateWorkflowStages(["ralplan"]).valid, "single stage invalid");
  assert(!validateWorkflowStages(["execution", "ralplan"]).valid, "wrong order invalid");
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
