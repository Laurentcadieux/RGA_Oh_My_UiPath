import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/skills/frontmatter.js";
import { scanLookout } from "../src/lookout/index.js";
import { validateWorkflowStages } from "../src/pipeline/adapter.js";

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
name: test-skill
description: A test skill
model: sonnet
---
# Body content
Some body text.`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("test-skill");
    expect(frontmatter.description).toBe("A test skill");
    expect(frontmatter.model).toBe("sonnet");
    expect(body.trim()).toContain("Body content");
  });

  it("parses UiPath-specific frontmatter", () => {
    const content = `---
name: uipath-rpa
description: RPA workflow skill
uip-skill: uipath-rpa
uip-commands: [uip rpa build, uip rpa test]
uip-maturity: stable
---
Body`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter["uip-skill"]).toBe("uipath-rpa");
    expect(frontmatter["uip-maturity"]).toBe("stable");
  });

  it("handles missing frontmatter", () => {
    const content = "Just body text, no frontmatter.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("");
    expect(body).toBe(content);
  });
});

describe("scanLookout", () => {
  it("returns clear for safe tasks", async () => {
    const report = await scanLookout("Build the workflow and run tests");
    expect(report.summary.verdict).toBe("clear");
    expect(report.findings).toHaveLength(0);
  });

  it("detects force ops", async () => {
    const report = await scanLookout("rm -rf /tmp/test && git push --force");
    expect(report.summary.verdict).toBe("review-recommended");
    expect(report.findings.some((f) => f.id.includes("force-op"))).toBe(true);
  });

  it("detects UiPath destructive operations", async () => {
    const report = await scanLookout("uip or queues delete --id 42");
    expect(report.summary.verdict).toBe("review-recommended");
    expect(report.findings.some((f) => f.id.includes("uipath-destructive"))).toBe(true);
  });

  it("detects UiPath secrets", async () => {
    const report = await scanLookout("Configure UIPATH_PAT for auth");
    expect(report.summary.verdict).toBe("advisory");
    expect(report.findings.some((f) => f.id.includes("uipath-secrets"))).toBe(true);
  });
});

describe("validateWorkflowStages", () => {
  it("accepts valid sequences", () => {
    expect(validateWorkflowStages(["ralplan", "execution"]).valid).toBe(true);
    expect(validateWorkflowStages(["ralplan", "execution", "ralph", "qa"]).valid).toBe(true);
  });

  it("rejects invalid sequences", () => {
    expect(validateWorkflowStages(["ralplan"]).valid).toBe(false);
    expect(validateWorkflowStages(["execution", "ralplan"]).valid).toBe(false);
    expect(validateWorkflowStages(["ralplan", "qa"]).valid).toBe(false);
  });
});
