/**
 * Minimal JSON5-lite parser — handles trailing commas and comments.
 * Only what we need for project.json parsing.
 */

export function parse(text: string): unknown {
  // Strip single-line comments
  let cleaned = text.replace(/\/\/.*$/gm, "");
  // Strip multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(cleaned);
}
