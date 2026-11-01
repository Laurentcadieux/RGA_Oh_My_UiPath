/**
 * Policy — environment-aware allow/ask/deny rules for the Lookout
 *
 * Policy is loaded from `.omu/lookout.yaml` (project-local) or defaults.
 * Merge order: defaults → .omu/lookout.yaml (user overrides).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────

export type Decision = "allow" | "ask" | "deny";

export type FindingCategory =
  | "destructive"
  | "dangerous-flag"
  | "secret-exposure"
  | "scope-violation"
  | "preview-skill-on-prod"
  | "stale-dependency";

export type Environment = "dev" | "staging" | "prod";

export interface PolicyRule {
  /** Which finding category this rule applies to */
  category: FindingCategory;
  /** Decision per environment; environments not listed inherit from "default" */
  env: Partial<Record<Environment | "default", Decision>>;
}

export interface Policy {
  /** The environment we're operating in */
  environment: Environment;
  /** Rules, evaluated in order; first match wins */
  rules: PolicyRule[];
  /** Fallback decision if no rule matches */
  fallback: Decision;
}

// ─── Default policy ───────────────────────────────────────────────────

export const DEFAULT_POLICY: Policy = {
  environment: "dev",
  rules: [
    // Destructive ops
    {
      category: "destructive",
      env: { default: "ask", prod: "deny" },
    },
    // Dangerous flags (--force, --yes, --skip-confirmation)
    {
      category: "dangerous-flag",
      env: { default: "ask", prod: "deny" },
    },
    // Secret exposure in file writes
    {
      category: "secret-exposure",
      env: { default: "ask" },
    },
    // Scope violations (missing --tenant/--folder on deploy/publish)
    {
      category: "scope-violation",
      env: { default: "ask" },
    },
    // Preview/in-development skill targeting prod
    {
      category: "preview-skill-on-prod",
      env: { default: "ask", prod: "deny" },
    },
    // Stale dependencies
    {
      category: "stale-dependency",
      env: { default: "allow" },
    },
  ],
  fallback: "allow",
};

// ─── Policy resolution ────────────────────────────────────────────────

/**
 * Resolve the decision for a finding category given the current policy.
 */
export function resolveDecision(
  policy: Policy,
  category: FindingCategory
): Decision {
  for (const rule of policy.rules) {
    if (rule.category === category) {
      // Check environment-specific first, then default
      return rule.env[policy.environment] ?? rule.env.default ?? policy.fallback;
    }
  }
  return policy.fallback;
}

// ─── Policy loader ────────────────────────────────────────────────────

/**
 * Load policy from .omu/lookout.yaml, merging with defaults.
 * Falls back to DEFAULT_POLICY if no file found.
 *
 * YAML format:
 *   environment: prod
 *   rules:
 *     - category: destructive
 *       env:
 *         dev: allow
 *         staging: ask
 *         prod: deny
 */
export async function loadPolicy(projectDir: string): Promise<Policy> {
  const policyPath = join(projectDir, ".omu", "lookout.yaml");

  let raw: string;
  try {
    raw = await readFile(policyPath, "utf-8");
  } catch {
    // No policy file — use defaults, but check UIPATH_ENV
    const env = detectEnvironment();
    return { ...DEFAULT_POLICY, environment: env };
  }

  return parsePolicyYaml(raw);
}

/**
 * Detect environment from UIPATH_ENV, NODE_ENV, or default to dev.
 */
export function detectEnvironment(): Environment {
  const env = process.env.UIPATH_ENV ?? process.env.NODE_ENV ?? "";
  if (env === "production" || env === "prod") return "prod";
  if (env === "staging" || env === "stage") return "staging";
  return "dev";
}

// ─── Minimal YAML parser (no dependency) ──────────────────────────────

/**
 * Parse a simple subset of YAML sufficient for the policy file.
 * Does not support nested collections beyond what we need.
 */
export function parsePolicyYaml(raw: string): Policy {
  const policy: Policy = { ...DEFAULT_POLICY, rules: [...DEFAULT_POLICY.rules] };

  const lines = raw.split("\n");
  let currentRule: PolicyRule | null = null;
  let inRules = false;
  let inRuleEnv = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Top-level environment
    if (/^environment:/.test(trimmed)) {
      const val = trimmed.split(":")[1].trim();
      if (val === "prod" || val === "staging" || val === "dev") {
        policy.environment = val;
      }
      continue;
    }

    // Start of rules block
    if (trimmed === "rules:") {
      inRules = true;
      continue;
    }

    if (!inRules) continue;

    // New rule entry (- category: ...)
    if (/^- category:/.test(trimmed)) {
      const category = trimmed.replace(/^- category:\s*/, "").trim() as FindingCategory;
      currentRule = { category, env: {} };
      policy.rules.push(currentRule);
      inRuleEnv = false;
      continue;
    }

    // Rule env block
    if (currentRule && /^env:/.test(trimmed)) {
      inRuleEnv = true;
      continue;
    }

    // Env entries (dev: allow, prod: deny, etc.)
    if (currentRule && inRuleEnv && /^\w+:/.test(trimmed)) {
      const [key, val] = trimmed.split(":").map((s) => s.trim());
      if ((key === "default" || key === "dev" || key === "staging" || key === "prod") &&
          (val === "allow" || val === "ask" || val === "deny")) {
        currentRule.env[key as "default" | "dev" | "staging" | "prod"] = val as Decision;
      }
      continue;
    }

    // If we hit something else, we're out of the env block
    if (inRuleEnv && !/^\s/.test(line)) {
      inRuleEnv = false;
    }
  }

  return policy;
}
