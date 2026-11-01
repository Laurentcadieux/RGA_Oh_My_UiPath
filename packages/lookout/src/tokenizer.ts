/**
 * uip Command Tokenizer — command-aware parsing for the Lookout
 *
 * Tokenizes `uip` CLI commands into structured { resource, verb, flags } objects.
 * Only real `uip` invocations are parsed; free text (English sentences mentioning
 * "delete" and "queue") is ignored by the scanner.
 *
 * Known command surface (verified against uip --help):
 *   uip orchestrator <sub> <verb> [flags]   (alias: uip or)
 *   uip solution <verb> [flags]
 *   uip admin <sub> <verb> [flags]
 *   uip rpa <verb> [flags]
 *   uip codedagent <verb> [flags]
 *   uip config <verb> [flags]
 *   uip auth <verb> [flags]
 *   uip skills <verb> [flags]
 *
 * Flags: --name, --id, --folder, --tenant, --force, --yes, --dry-run, etc.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface UipCommand {
  /** True if this was parsed as a real uip invocation */
  isUipCommand: true;
  /** Full resource path, e.g. "orchestrator.queues" */
  resource: string;
  /** Verb, e.g. "delete", "list", "publish" */
  verb: string;
  /** Parsed flags */
  flags: Map<string, string | true>;
  /** Original text */
  raw: string;
}

export interface NotUipCommand {
  isUipCommand: false;
  raw: string;
}

export type ParsedCommand = UipCommand | NotUipCommand;

// ─── Known aliases ────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  or: "orchestrator",
  sol: "solution",
  adm: "admin",
  ca: "codedagent",
};

// ─── Known resource paths (from uip --help) ───────────────────────────

const ORCHESTRATOR_SUBS = new Set([
  "queues", "robots", "jobs", "assets", "machines",
  "folders", "processes", "environments", "packages",
  "schedules", "triggers", "webhooks", "stats",
  "library", "auditlog", "settings",
]);

const SOLUTION_VERBS = new Set([
  "init", "pack", "publish", "deploy", "activate",
  "deactivate", "test", "list", "download",
]);

const ADMIN_SUBS = new Set([
  "tenants", "users", "roles", "groups", "licensing",
  "settings", "auditlog",
]);

// ─── Destructive verbs ────────────────────────────────────────────────

const DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "purge", "deactivate", "unpublish",
  "stop", "kill", "disable",
]);

// ─── Dangerous flags ──────────────────────────────────────────────────

const DANGEROUS_FLAGS = new Set(["force", "yes", "skip-confirmation"]);

// ─── Tokenizer ────────────────────────────────────────────────────────

/**
 * Extract potential uip command(s) from mixed text.
 * Returns all uip invocations found, or [] if none.
 */
export function extractUipCommands(text: string): string[] {
  const commands: string[] = [];

  // Match `uip ...` at word boundary, extending until end of line or next unrelated token
  // Handles multi-line text like "Run uip or queues delete --id 42 && uip sol pack"
  const uipRegex = /(?:^|&&|;|\|)\s*uip\s+/gi;
  let match: RegExpExecArray | null;

  while ((match = uipRegex.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const rest = text.slice(start);
    // Take until end of logical command (newline, &&, |, ;, or end of string)
    const endMatch = rest.search(/(?:&&|\||;|\n|$)/);
    const end = endMatch === -1 ? rest.length : endMatch;
    const cmdText = rest.slice(0, end).trim();
    if (cmdText) {
      commands.push("uip " + cmdText);
    }
  }

  // Also check if the entire text starts with `uip`
  if (/^uip\s/.test(text.trim()) && commands.length === 0) {
    commands.push(text.trim());
  }

  return commands;
}

/**
 * Tokenize a single uip command string into structured form.
 */
export function tokenizeUipCommand(command: string): ParsedCommand {
  const raw = command.trim();

  // Must start with `uip`
  if (!/^uip\s/.test(raw)) {
    return { isUipCommand: false, raw };
  }

  // Split into tokens (respecting quoted strings)
  const tokens = shellSplit(raw);
  if (tokens.length < 2) {
    return { isUipCommand: false, raw };
  }

  // Skip the "uip" binary itself
  let i = 1;
  const parts: string[] = [];
  const flags = new Map<string, string | true>();

  // Collect positional args until we hit a flag (-- or -)
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      // Check if next token is the value (not another flag)
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
        flags.set(flagName, tokens[i + 1]);
        i += 2;
      } else {
        flags.set(flagName, true);
        i++;
      }
    } else if (token.startsWith("-") && token.length === 2) {
      // Short flag like -f
      const flagName = token.slice(1);
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
        flags.set(flagName, tokens[i + 1]);
        i += 2;
      } else {
        flags.set(flagName, true);
        i++;
      }
    } else {
      // Positional argument — resolve aliases
      const resolved = ALIASES[token.toLowerCase()] ?? token.toLowerCase();
      parts.push(resolved);
      i++;
    }
  }

  if (parts.length === 0) {
    return { isUipCommand: false, raw };
  }

  // Build resource path and verb from positional parts
  const { resource, verb } = resolveResourceAndVerb(parts);

  return {
    isUipCommand: true,
    resource,
    verb,
    flags,
    raw,
  };
}

// ─── Resource/verb resolution ─────────────────────────────────────────

function resolveResourceAndVerb(parts: string[]): { resource: string; verb: string } {
  // Pattern: uip orchestrator <sub> <verb>
  //          uip admin <sub> <verb>
  //          uip solution <verb>
  //          uip rpa <verb>
  //          uip <verb> (top-level)

  const first = parts[0];

  if (first === "orchestrator" && parts.length >= 3 && ORCHESTRATOR_SUBS.has(parts[1])) {
    return {
      resource: `orchestrator.${parts[1]}`,
      verb: parts[2],
    };
  }

  if (first === "orchestrator" && parts.length >= 2) {
    // orchestrator with no known sub — verb might be second part
    return {
      resource: "orchestrator",
      verb: parts[1],
    };
  }

  if (first === "admin" && parts.length >= 3 && ADMIN_SUBS.has(parts[1])) {
    return {
      resource: `admin.${parts[1]}`,
      verb: parts[2],
    };
  }

  if (first === "admin" && parts.length >= 2) {
    return {
      resource: "admin",
      verb: parts[1],
    };
  }

  if (first === "solution" && parts.length >= 2) {
    return {
      resource: "solution",
      verb: parts[1],
    };
  }

  // rpa, codedagent, config, auth, skills — verb is second part
  if (parts.length >= 2) {
    return {
      resource: first,
      verb: parts[1],
    };
  }

  return {
    resource: first,
    verb: "",
  };
}

// ─── Analysis helpers ─────────────────────────────────────────────────

export function isDestructive(cmd: UipCommand): boolean {
  return DESTRUCTIVE_VERBS.has(cmd.verb);
}

export function hasDangerousFlag(cmd: UipCommand): string[] {
  const found: string[] = [];
  for (const flag of DANGEROUS_FLAGS) {
    if (cmd.flags.has(flag)) found.push(`--${flag}`);
  }
  // Also check common aliases
  if (cmd.flags.has("f")) found.push("-f");
  return found;
}

export function hasScopeFlag(cmd: UipCommand): { hasFolder: boolean; hasTenant: boolean } {
  return {
    hasFolder: cmd.flags.has("folder"),
    hasTenant: cmd.flags.has("tenant"),
  };
}

// ─── Shell-like split (handles quoted strings) ────────────────────────

function shellSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}
