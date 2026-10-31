/**
 * Skill registry — loads and manages skills from both OMC and UiPath skill catalogs.
 *
 * Adapted from OMC's createBuiltinSkills() but extended to:
 * 1. Load OMC skills (skills/omc/*/SKILL.md)
 * 2. Load UiPath skills (skills/uipath/*/SKILL.md)
 * 3. Apply naming policy (omc- prefix for CC-native collisions)
 * 4. Cache with invalidation on config changes
 */

import { parseFrontmatter, type SkillFrontmatter } from "./frontmatter.js";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface BuiltinSkill {
  name: string;
  aliases?: string[];
  aliasOf?: string;
  description: string;
  template: string; // rendered body
  model?: string;
  agent?: string;
  argumentHint?: string;
  pipeline?: string[];
  /** UiPath extensions */
  uipSkill?: string;
  uipCommands?: string[];
  uipMaturity?: "stable" | "preview" | "in-development";
  /** Source catalog */
  source: "omc" | "uipath";
  /** File path this was loaded from */
  filePath: string;
}

export interface SkillRegistry {
  skills: ReadonlyMap<string, BuiltinSkill>;
  get(name: string): BuiltinSkill | undefined;
  getByAlias(alias: string): BuiltinSkill | undefined;
  getBySource(source: "omc" | "uipath"): BuiltinSkill[];
  getByMaturity(maturity: string): BuiltinSkill[];
  list(): BuiltinSkill[];
}

/** Claude Code native commands that require omc- prefix */
const CC_NATIVE_COMMANDS = new Set([
  "review", "plan", "init", "doctor", "help",
  "config", "clear", "compact", "memory", "security-review",
]);

export async function createSkillRegistry(
  skillDirs: { omc: string; uipath: string }
): Promise<SkillRegistry> {
  const skills = new Map<string, BuiltinSkill>();

  // Load OMC skills
  await loadSkillsFromDir(skillDirs.omc, "omc", skills);

  // Load UiPath skills
  await loadSkillsFromDir(skillDirs.uipath, "uipath", skills);

  return {
    skills,
    get: (name) => skills.get(name),
    getByAlias: (alias) => {
      for (const skill of skills.values()) {
        if (skill.aliases?.includes(alias)) return skill;
      }
      return undefined;
    },
    getBySource: (source) =>
      [...skills.values()].filter((s) => s.source === source),
    getByMaturity: (maturity) =>
      [...skills.values()].filter((s) => s.uipMaturity === maturity),
    list: () => [...skills.values()],
  };
}

async function loadSkillsFromDir(
  dir: string,
  source: "omc" | "uipath",
  skills: Map<string, BuiltinSkill>
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // dir doesn't exist — skip
  }

  for (const entry of entries) {
    const skillPath = join(dir, entry);
    const skillMdPath = join(skillPath, "SKILL.md");

    try {
      const content = await readFile(skillMdPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      const safeName = CC_NATIVE_COMMANDS.has(frontmatter.name)
        ? `omc-${frontmatter.name}`
        : frontmatter.name;

      const skill: BuiltinSkill = {
        name: safeName,
        aliases: frontmatter.aliases,
        description: frontmatter.description,
        template: body,
        model: frontmatter.model,
        agent: frontmatter.agent,
        argumentHint: frontmatter["argument-hint"],
        pipeline: frontmatter.pipeline,
        uipSkill: frontmatter["uip-skill"],
        uipCommands: frontmatter["uip-commands"],
        uipMaturity: frontmatter["uip-maturity"],
        source,
        filePath: resolve(skillMdPath),
      };

      skills.set(safeName, skill);

      // Register aliases
      if (frontmatter.aliases) {
        for (const alias of frontmatter.aliases) {
          const safeAlias = CC_NATIVE_COMMANDS.has(alias)
            ? `omc-${alias}`
            : alias;
          skills.set(safeAlias, { ...skill, name: safeAlias, aliasOf: safeName });
        }
      }
    } catch {
      // SKILL.md not found or unreadable — skip
    }
  }
}
