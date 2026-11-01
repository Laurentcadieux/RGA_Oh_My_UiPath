/**
 * Skill frontmatter parser
 *
 * Parses YAML frontmatter from SKILL.md files.
 * Same contract as OMC's parseFrontmatter — compatible with both
 * oh-my-claudecode and uipath/skills SKILL.md formats.
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
  aliases?: string[];
  "argument-hint"?: string;
  model?: string;
  agent?: string;
  pipeline?: string[];
  "omc-full-body"?: boolean;
  /** UiPath-specific frontmatter extensions */
  "uip-skill"?: string;       // maps to uipath skill name (e.g. "uipath-rpa")
  "uip-commands"?: string[];  // CLI commands this skill wraps
  "uip-maturity"?: "stable" | "preview" | "in-development";
}

const FRONTMATTER_BOUNDARY = "---";

export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith(FRONTMATTER_BOUNDARY)) {
    return { frontmatter: { name: "", description: "" }, body: content };
  }

  const endOfOpening = trimmed.indexOf("\n", 0);
  const closingIndex = trimmed.indexOf(
    `\n${FRONTMATTER_BOUNDARY}`,
    endOfOpening + 1
  );

  if (closingIndex === -1) {
    return { frontmatter: { name: "", description: "" }, body: content };
  }

  const yamlBlock = trimmed.slice(endOfOpening + 1, closingIndex);
  const body = trimmed.slice(closingIndex + 4); // skip \n---

  const frontmatter = parseYamlSimple(yamlBlock) as unknown as SkillFrontmatter;

  return { frontmatter, body };
}

/**
 * Minimal YAML parser for frontmatter.
 * Handles key: value and key: [a, b] arrays.
 * Production code should use a proper YAML library — this is a bootstrap.
 */
function parseYamlSimple(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();

    if (value === "") {
      value = undefined;
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (/^\d+$/.test(value as string)) {
      value = parseInt(value as string, 10);
    } else if (/^\[.*\]$/.test(value as string)) {
      // Simple array: [a, b, c]
      value = (value as string)
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    } else {
      // Strip quotes
      value = (value as string).replace(/^['"]|['"]$/g, "");
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
