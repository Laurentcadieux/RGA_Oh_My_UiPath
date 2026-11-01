/**
 * MCP Server for Claude Code integration
 *
 * Exposes oh-my-uipath-c operations as MCP tools so Claude Code
 * can call them directly (discover, scan, lifecycle, etc.)
 *
 * Start with: omu-c mcp
 */

import { createRequire } from "node:module";
import * as readline from "node:readline";

// Import omu-c modules
import { discoverProject, type UiPathProjectType } from "../discovery/index.js";
import { scanTask, type UiPathLookoutResult } from "../lookout/uipath-lookout.js";
import { isUipAvailable, getUipVersion, listAvailableSkills, uipExec } from "../uipathcli/index.js";
import { loadConfig } from "../config/loader.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

// ── MCP Protocol Types ─────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ── Tool Definitions ───────────────────────────────────────────────

const TOOLS: McpTool[] = [
  {
    name: "omu_discover",
    description: "Detect UiPath project type (classic-rpa, coded-automation, coded-agent, cross-platform, library, test-automation, data-service) and suggest relevant skills",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory to scan (default: cwd)" },
      },
    },
  },
  {
    name: "omu_scan",
    description: "UiPath-aware security & safety scan — checks for destructive operations, production flags, hardcoded secrets, scope violations",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Command string or directory to scan" },
      },
    },
  },
  {
    name: "omu_lifecycle",
    description: "UiPath solution lifecycle operations: init, pack, publish, deploy, activate, promote (pack→publish→deploy→activate), test-and-promote",
    inputSchema: {
      type: "object",
      properties: {
        step: {
          type: "string",
          enum: ["init", "pack", "publish", "deploy", "activate", "promote", "test-and-promote"],
          description: "Lifecycle step to execute",
        },
        projectDir: { type: "string", description: "Project directory (default: cwd)" },
        outputDir: { type: "string", description: "Output directory for pack" },
      },
      required: ["step"],
    },
  },
  {
    name: "omu_interview",
    description: "Start a deep automation design interview — walks through 8 categories (process scope, data contract, error handling, orchestrator, HITL, deployment, testing, security) to produce a design document",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Name for the automation project" },
        projectType: { type: "string", description: "Project type hint (classic-rpa, coded-automation, coded-agent)" },
      },
    },
  },
  {
    name: "omu_skills_list",
    description: "List available UiPath skills installed on this machine",
    inputSchema: { type: "object" },
  },
  {
    name: "omu_uip",
    description: "Execute a uipathcli (uip) command — proxy any uip CLI operation",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments to pass to uip CLI (e.g. ['robots', 'list', '--folder', 'Default'])",
        },
        output: { type: "string", enum: ["json", "text"], description: "Output format (default: json)" },
      },
      required: ["args"],
    },
  },
  {
    name: "omu_config",
    description: "Show the merged oh-my-uipath-c configuration",
    inputSchema: { type: "object" },
  },
];

// ── Tool Handlers ──────────────────────────────────────────────────

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    switch (name) {
      case "omu_discover": {
        const dir = (args.directory as string) || process.cwd();
        const result = await discoverProject(dir);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "omu_scan": {
        const target = (args.target as string) || process.cwd();
        const result = await scanTask(target);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "omu_lifecycle": {
        const step = args.step as string;
        const projectDir = (args.projectDir as string) || process.cwd();
        const outputDir = args.outputDir as string | undefined;

        const stepMap: Record<string, string[]> = {
          init: ["solution", "init"],
          pack: ["solution", "pack"],
          publish: ["solution", "publish"],
          deploy: ["solution", "deploy"],
          activate: ["solution", "activate"],
          promote: ["solution", "pack"],
          "test-and-promote": ["solution", "pack"],
        };

        const cmd = stepMap[step];
        if (!cmd) {
          return { content: [{ type: "text", text: `Unknown lifecycle step: ${step}` }] };
        }

        const uipArgs = [...cmd];
        if (outputDir) uipArgs.push("--output", outputDir);

        const result = await uipExec(uipArgs, { output: "json" });

        // For promote, chain pack → publish → deploy → activate
        if (step === "promote" && result.exitCode === 0) {
          for (const next of [["solution", "publish"], ["solution", "deploy"], ["solution", "activate"]]) {
            await uipExec(next, { output: "json" });
          }
        }

        return {
          content: [{
            type: "text",
            text: result.exitCode === 0
              ? `✅ ${step} completed${result.stdout ? "\n" + result.stdout : ""}`
              : `❌ ${step} failed (exit ${result.exitCode})${result.stderr ? "\n" + result.stderr : ""}`,
          }],
        };
      }

      case "omu_interview": {
        const { createInterview } = await import("../interview/index.js");
        const projectName = (args.projectName as string) || "untitled-automation";
        const projectType = args.projectType as string | undefined;

        const interview = createInterview(projectType as UiPathProjectType | undefined);
        const questions = interview.questions.map((q: any, i: number) => `${i + 1}. **${q.category}** — ${q.text}`).join("\n");

        return {
          content: [{
            type: "text",
            text: `## Deep Interview: ${projectName}\n\nProject type: ${projectType || "auto-detect"}\nTotal questions: ${interview.questions.length}\n\n### Questions:\n${questions}\n\nUse \`omu_interview_answer\` to provide answers, or run \`omu-c interview\` from the CLI for an interactive session.`,
          }],
        };
      }

      case "omu_skills_list": {
        const skills = await listAvailableSkills();
        const uipOk = await isUipAvailable();
        return {
          content: [{
            type: "text",
            text: uipOk
              ? `UiPath CLI: v${await getUipVersion()}\nSkills (${skills.length}): ${skills.join(", ")}`
              : "UiPath CLI not found — install from https://download.uipath.com/uipathcli/",
          }],
        };
      }

      case "omu_uip": {
        const cmdArgs = args.args as string[];
        const output = (args.output as string) || "json";
        const result = await uipExec(cmdArgs, { output: output as "json" | "text" });
        return {
          content: [{
            type: "text",
            text: result.exitCode === 0
              ? (output === "json" && result.data ? JSON.stringify(result.data, null, 2) : result.stdout)
              : `Error (exit ${result.exitCode}): ${result.stderr}`,
          }],
        };
      }

      case "omu_config": {
        const config = loadConfig();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(config, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

// ── MCP Protocol Handler ───────────────────────────────────────────

function makeResponse(id: number | string | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id: number | string | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      return makeResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "oh-my-uipath-c",
          version: pkg.version,
        },
      });

    case "tools/list":
      return makeResponse(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
      const result = await handleToolCall(toolName, toolArgs);
      return makeResponse(id, result);
    }

    case "notifications/initialized":
      // No response needed for notifications
      return { jsonrpc: "2.0", id: null };

    default:
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Stdio Transport ────────────────────────────────────────────────

export function startMcpServer(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on("line", async (line) => {
    try {
      const req = JSON.parse(line) as JsonRpcRequest;
      const resp = await handleRequest(req);
      // Notifications (no id) don't get responses
      if (req.id !== undefined) {
        process.stdout.write(JSON.stringify(resp) + "\n");
      }
    } catch (err: any) {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      };
      process.stdout.write(JSON.stringify(resp) + "\n");
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
