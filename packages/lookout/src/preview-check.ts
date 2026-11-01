/**
 * Preview Skill Checker — warn when using Preview/In-development skills on prod
 *
 * Reads upstream assets/skill-status.json to determine skill maturity.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface SkillStatusEntry {
  status: "stable" | "preview" | "in-development";
  confluence?: { page_id: string | null; url: string | null };
  last_synced?: string | null;
}

export interface SkillStatusData {
  generated_at: string;
  schema_version: number;
  statuses: Record<string, { label: string; meaning: string }>;
  skills: Record<string, SkillStatusEntry>;
}

export interface PreviewWarning {
  /** Skill name */
  skill: string;
  /** Skill status */
  status: string;
  /** Meaning of the status */
  meaning: string;
  /** Advice */
  advice: string;
}

// ─── Checker ──────────────────────────────────────────────────────────

/**
 * Check if a skill is safe to use on the given environment.
 */
export function checkSkillForEnv(
  skillName: string,
  skillData: SkillStatusData,
  environment: "dev" | "staging" | "prod"
): PreviewWarning | null {
  // Only warn on prod
  if (environment !== "prod") return null;

  const entry = skillData.skills[skillName];
  if (!entry) return null;

  if (entry.status === "stable") return null;

  // Preview or In-development on prod
  const statusInfo = skillData.statuses[entry.status];
  return {
    skill: skillName,
    status: entry.status,
    meaning: statusInfo?.meaning ?? `Skill status is ${entry.status}`,
    advice: entry.status === "preview"
      ? `"${skillName}" is in Preview — surface or behavior may change. Use a stable alternative for production.`
      : `"${skillName}" is In-development — incomplete or unstable. Do not use in production.`,
  };
}

/**
 * Get all non-stable skills (useful for reporting).
 */
export function getNonStableSkills(skillData: SkillStatusData): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];

  for (const [name, entry] of Object.entries(skillData.skills)) {
    if (entry.status !== "stable") {
      const statusInfo = skillData.statuses[entry.status];
      warnings.push({
        skill: name,
        status: entry.status,
        meaning: statusInfo?.meaning ?? `Skill status is ${entry.status}`,
        advice: `Not stable: ${entry.status}. Review before using in production.`,
      });
    }
  }

  return warnings;
}
