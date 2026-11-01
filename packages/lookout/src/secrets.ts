/**
 * Secrets Scanner — detect credentials in file content before writing
 *
 * Scans .xaml, .cs, .json, .config, .env files for hardcoded secrets.
 * On detection, suggests the Orchestrator Asset to use instead.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface SecretFinding {
  /** Type of secret found */
  type: string;
  /** File path (or "<task>" for inline text) */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** The pattern that matched (not the value!) */
  pattern: string;
  /** Suggested Orchestrator Asset name */
  suggestion: string;
}

// ─── Secret patterns ──────────────────────────────────────────────────

interface SecretPattern {
  pattern: RegExp;
  type: string;
  suggestion: (match: string, key?: string) => string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Hardcoded passwords
  {
    pattern: /["'](?:password|passwd|pwd|Password|Passwd|Pwd)["']\s*[:=]\s*["'][^"']+["']/i,
    type: "hardcoded-password",
    suggestion: (_m, key) => `Use Orchestrator Asset "${key ?? "credential"}_password" instead of hardcoding.`,
  },
  // API keys
  {
    pattern: /["'](?:apiKey|api_key|apikey|ApiKey|API_KEY)["']\s*[:=]\s*["'][^"']+["']/i,
    type: "hardcoded-api-key",
    suggestion: (_m, key) => `Use Orchestrator Asset "${key ?? "credential"}_api_key" instead of hardcoding.`,
  },
  // Tokens
  {
    pattern: /["'](?:token|refreshToken|access_token|Token|AccessToken|RefreshToken)["']\s*[:=]\s*["'][^"']+["']/i,
    type: "hardcoded-token",
    suggestion: (_m, key) => `Use Orchestrator Asset "${key ?? "credential"}_token" instead of hardcoding.`,
  },
  // Client secrets (OAuth)
  {
    pattern: /["'](?:clientSecret|client_secret|ClientSecret|CLIENT_SECRET)["']\s*[:=]\s*["'][^"']+["']/i,
    type: "hardcoded-client-secret",
    suggestion: (_m, key) => `Use Orchestrator Asset "${key ?? "oauth"}_client_secret" instead of hardcoding.`,
  },
  // Connection strings
  {
    pattern: /["'](?:connectionString|connection_string|ConnectionString|CONNECTION_STRING)["']\s*[:=]\s*["'][^"']+["']/i,
    type: "hardcoded-connection-string",
    suggestion: () => `Use Orchestrator Asset "db_connection_string" instead of hardcoding. Store credentials separately.`,
  },
  // AWS access keys (in any context)
  {
    pattern: /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/,
    type: "aws-access-key",
    suggestion: () => `Use Orchestrator Asset "aws_access_key" or environment variable AWS_ACCESS_KEY_ID instead.`,
  },
  // GitHub tokens
  {
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/,
    type: "github-token",
    suggestion: () => `Use Orchestrator Asset "github_token" or environment variable GITHUB_TOKEN instead.`,
  },
  // UiPath PAT references with inline values
  {
    pattern: /UIPATH_PAT\s*[:=]\s*["'][^"']+["']/i,
    type: "uipath-pat",
    suggestion: () => `Use environment variable UIPATH_PAT (set in CI/CD) or Orchestrator Asset "uipath_pat" instead.`,
  },
  // Generic secret= assignments in .env style
  {
    pattern: /^(?:SECRET|SECRET_KEY|SECRET_VALUE|PRIVATE_KEY)\s*[:=]\s*.+/im,
    type: "generic-secret",
    suggestion: () => `Move to Orchestrator Asset or a secrets manager. Never commit to source control.`,
  },
];

// ─── File extension allowlist ─────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([
  ".json", ".xaml", ".cs", ".config", ".xml", ".env",
  ".yaml", ".yml", ".toml", ".ini", ".ps1", ".py",
]);

const SCANNABLE_FILENAMES = new Set([
  "project.json", "appsettings.json", "launchSettings.json",
  ".env", ".env.local", ".env.production", ".env.staging",
  "secrets.json", "credentials.json",
]);

// ─── Scanner ──────────────────────────────────────────────────────────

/**
 * Check if a file path should be scanned for secrets.
 */
export function shouldScanFile(filePath: string): boolean {
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1];

  if (SCANNABLE_FILENAMES.has(filename)) return true;

  const ext = filename.lastIndexOf(".");
  if (ext >= 0) {
    const extension = filename.slice(ext).toLowerCase();
    return SCANNABLE_EXTENSIONS.has(extension);
  }

  return false;
}

/**
 * Scan file content for secrets. Returns findings with line numbers.
 */
export function scanForSecrets(content: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { pattern, type, suggestion } of SECRET_PATTERNS) {
      // Reset regex lastIndex for each line
      const regex = new RegExp(pattern.source, pattern.flags);
      const match = regex.exec(line);

      if (match) {
        // Extract the key name for the suggestion
        const keyMatch = line.match(/["'](\w+)["']\s*[:=]/);
        const key = keyMatch ? keyMatch[1] : undefined;

        findings.push({
          type,
          file: filePath,
          line: i + 1,
          pattern: type, // Don't include the actual matched text
          suggestion: suggestion(match[0], key),
        });
      }
    }
  }

  return findings;
}

/**
 * Scan a single line/string for secrets (e.g. a command string).
 * Returns simplified findings without line numbers.
 */
export function scanStringForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const { pattern, type, suggestion } of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);

    if (match) {
      findings.push({
        type,
        file: "<command>",
        line: 0,
        pattern: type,
        suggestion: suggestion(match[0]),
      });
    }
  }

  return findings;
}
