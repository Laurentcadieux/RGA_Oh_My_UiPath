/**
 * Deep Interview Adapter for UiPath Automation Design
 *
 * Adapts OMC's deep-interview pattern to UiPath-specific automation design.
 * Produces a structured interview that guides the user through:
 * - Process identification and scope
 * - Input/output data contracts
 * - Exception handling strategy
 * - Orchestrator integration (queues, assets, jobs)
 * - Human-in-the-loop requirements
 * - Target environment and deployment considerations
 *
 * The interview output feeds directly into the autopilot pipeline
 * as the "ralplan" stage input.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { UiPathProjectType } from "../discovery/index.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface InterviewQuestion {
  /** Question ID */
  id: string;
  /** The question text */
  question: string;
  /** Category for grouping */
  category: InterviewCategory;
  /** Priority (1 = must-answer, 2 = important, 3 = nice-to-have) */
  priority: 1 | 2 | 3;
  /** Suggested answers or hints */
  hints?: string[];
  /** Whether this question is specific to a project type */
  projectTypes?: UiPathProjectType[];
  /** User's answer (filled during interview) */
  answer?: string;
  /** Whether answered */
  answered: boolean;
}

export type InterviewCategory =
  | "process-scope"
  | "data-contract"
  | "error-handling"
  | "orchestrator"
  | "human-loop"
  | "deployment"
  | "testing"
  | "security";

export interface InterviewSession {
  /** Session ID */
  id: string;
  /** When created */
  createdAt: string;
  /** Project type (if detected) */
  projectType?: UiPathProjectType;
  /** All questions */
  questions: InterviewQuestion[];
  /** Status */
  status: "pending" | "in-progress" | "complete";
  /** Completed question count */
  completedCount: number;
  /** Total question count */
  totalCount: number;
}

export interface InterviewResult {
  /** The completed session */
  session: InterviewSession;
  /** Generated design document (markdown) */
  designDocument: string;
  /** Suggested autopilot pipeline input */
  pipelineInput: {
    task: string;
    context: string;
    projectType: UiPathProjectType;
    skills: string[];
  };
}

// ─── Question Banks ───────────────────────────────────────────────────

const BASE_QUESTIONS: Omit<InterviewQuestion, "answer" | "answered">[] = [
  // Process scope
  {
    id: "process-name",
    question: "What is the name and purpose of this automation?",
    category: "process-scope",
    priority: 1,
    hints: ["e.g. 'Invoice Processing' — extract, validate, and post invoices from email to ERP"],
  },
  {
    id: "process-trigger",
    question: "How is this process triggered?",
    category: "process-scope",
    priority: 1,
    hints: ["Scheduled (time-based)", "Event-driven (email, queue, file watcher)", "On-demand (human initiation)", "API call"],
  },
  {
    id: "process-volume",
    question: "What is the expected volume and frequency?",
    category: "process-scope",
    priority: 2,
    hints: ["Transactions per day/week", "Peak vs. average volume", "SLA requirements"],
  },
  {
    id: "process-boundaries",
    question: "What is explicitly OUT of scope?",
    category: "process-scope",
    priority: 2,
    hints: ["Edge cases to defer", "Manual steps that won't be automated", "Downstream processes not affected"],
  },

  // Data contract
  {
    id: "data-input",
    question: "What are the input data sources?",
    category: "data-contract",
    priority: 1,
    hints: ["Email attachments", "SharePoint/OneDrive files", "Database tables", "API endpoints", "Queue items", "Orchestrator Assets"],
  },
  {
    id: "data-output",
    question: "What are the output targets?",
    category: "data-contract",
    priority: 1,
    hints: ["ERP system", "Database", "Email notification", "Queue (for next process)", "File system"],
  },
  {
    id: "data-transformations",
    question: "What data transformations or validations are needed?",
    category: "data-contract",
    priority: 2,
    hints: ["Field mapping", "Format conversion", "Business validation rules", "Data enrichment"],
  },

  // Error handling
  {
    id: "error-strategy",
    question: "What is the exception handling strategy?",
    category: "error-handling",
    priority: 1,
    hints: ["Retry logic (how many attempts, delay)", "Business vs. system exception separation", "Dead-letter/failed item handling"],
  },
  {
    id: "error-notification",
    question: "How should failures be communicated?",
    category: "error-handling",
    priority: 2,
    hints: ["Email alert", "Slack/Teams notification", "Orchestrator alert", "Dashboard update"],
  },

  // Orchestrator
  {
    id: "orch-queues",
    question: "Does this process use Orchestrator Queues?",
    category: "orchestrator",
    priority: 1,
    hints: ["Yes — producer/consumer pattern", "No — standalone execution", "Maybe — need guidance"],
  },
  {
    id: "orch-assets",
    question: "What credentials and configuration need to be stored as Assets?",
    category: "orchestrator",
    priority: 2,
    hints: ["Database credentials", "API keys", "File paths", "Environment-specific settings"],
  },
  {
    id: "orch-environment",
    question: "What are the target Orchestrator environments?",
    category: "orchestrator",
    priority: 1,
    hints: ["Dev → Test → Prod", "Single tenant", "Multiple tenants/folders"],
  },

  // Human-in-the-loop
  {
    id: "hitl-needed",
    question: "Are there steps requiring human judgment or action?",
    category: "human-loop",
    priority: 1,
    hints: ["Yes — exception review", "Yes — approval step", "Yes — data entry for edge cases", "No — fully automated"],
  },
  {
    id: "hitl-action",
    question: "What should the human do and how urgent is it?",
    category: "human-loop",
    priority: 2,
    hints: ["Validate extracted data", "Approve high-value transactions", "Resolve exceptions", "SLA for response time"],
    projectTypes: ["classic-rpa", "coded-automation"],
  },

  // Deployment
  {
    id: "deploy-robot",
    question: "What type of robot will execute this?",
    category: "deployment",
    priority: 1,
    hints: ["Attended (human-triggered)", "Unattended (server robot)", "Floating (dynamic allocation)"],
  },
  {
    id: "deploy-runtime",
    question: "What is the target runtime?",
    category: "deployment",
    priority: 1,
    hints: ["Windows", "Cross-platform (Linux/Mac)", "Cloud"],
    projectTypes: ["classic-rpa", "coded-automation", "cross-platform"],
  },

  // Testing
  {
    id: "test-strategy",
    question: "What is the testing strategy?",
    category: "testing",
    priority: 2,
    hints: ["Unit test individual components", "Integration test with test data", "RPA test suite (UiPath Testing)", "Manual validation only"],
  },

  // Security
  {
    id: "security-considerations",
    question: "Are there security or compliance requirements?",
    category: "security",
    priority: 2,
    hints: ["PII/PHI data handling", "SOX compliance", "GDPR data retention", "Audit logging requirements"],
  },
];

// Agent-specific questions
const AGENT_QUESTIONS: Omit<InterviewQuestion, "answer" | "answered">[] = [
  {
    id: "agent-trigger",
    question: "What events or messages trigger this agent?",
    category: "process-scope",
    priority: 1,
    hints: ["Email arrival", "Queue item", "Webhook", "Schedule", "Chat message"],
    projectTypes: ["coded-agent"],
  },
  {
    id: "agent-tools",
    question: "What tools/APIs does this agent need access to?",
    category: "data-contract",
    priority: 1,
    hints: ["HTTP requests", "Database queries", "File operations", "Orchestrator API", "External APIs"],
    projectTypes: ["coded-agent"],
  },
  {
    id: "agent-memory",
    question: "Does the agent need conversation memory or context across invocations?",
    category: "data-contract",
    priority: 2,
    hints: ["Yes — maintain state", "No — stateless", "Session-scoped only"],
    projectTypes: ["coded-agent"],
  },
  {
    id: "agent-guardrails",
    question: "What guardrails or approval steps does the agent need?",
    category: "human-loop",
    priority: 1,
    hints: ["Human approval for production changes", "Output validation", "Rate limiting", "Scope restrictions"],
    projectTypes: ["coded-agent"],
  },
];

// ─── Interview Engine ─────────────────────────────────────────────────

/**
 * Create a new interview session.
 */
export function createInterview(projectType?: UiPathProjectType): InterviewSession {
  // Select relevant questions
  const relevantBase = BASE_QUESTIONS.filter(q => {
    if (!q.projectTypes) return true;
    if (!projectType || projectType === "unknown") return true;
    return q.projectTypes.includes(projectType);
  });

  const relevantAgent = projectType === "coded-agent"
    ? AGENT_QUESTIONS
    : [];

  const allQuestions = [...relevantBase, ...relevantAgent]
    .sort((a, b) => a.priority - b.priority) // priority 1 first
    .map(q => ({ ...q, answer: undefined, answered: false }));

  return {
    id: `interview-${Date.now()}`,
    createdAt: new Date().toISOString(),
    projectType,
    questions: allQuestions,
    status: "pending",
    completedCount: 0,
    totalCount: allQuestions.length,
  };
}

/**
 * Answer a question in the interview.
 */
export function answerQuestion(
  session: InterviewSession,
  questionId: string,
  answer: string
): InterviewSession {
  const updated = { ...session };
  const idx = updated.questions.findIndex(q => q.id === questionId);
  if (idx === -1) return updated;

  updated.questions = [...updated.questions];
  updated.questions[idx] = { ...updated.questions[idx], answer, answered: true };

  updated.completedCount = updated.questions.filter(q => q.answered).length;
  updated.status = updated.completedCount === updated.totalCount
    ? "complete"
    : updated.completedCount > 0
      ? "in-progress"
      : "pending";

  return updated;
}

/**
 * Get the next unanswered question (priority-sorted).
 */
export function getNextQuestion(session: InterviewSession): InterviewQuestion | null {
  return session.questions.find(q => !q.answered) ?? null;
}

/**
 * Batch-answer from a map of questionId → answer.
 */
export function batchAnswer(
  session: InterviewSession,
  answers: Record<string, string>
): InterviewSession {
  let current = session;
  for (const [id, answer] of Object.entries(answers)) {
    current = answerQuestion(current, id, answer);
  }
  return current;
}

/**
 * Generate the design document from a completed interview.
 */
export function generateDesignDocument(session: InterviewSession): string {
  const byCategory = new Map<InterviewCategory, InterviewQuestion[]>();
  for (const q of session.questions) {
    const existing = byCategory.get(q.category) ?? [];
    existing.push(q);
    byCategory.set(q.category, existing);
  }

  const CATEGORY_LABELS: Record<InterviewCategory, string> = {
    "process-scope": "Process Scope",
    "data-contract": "Data Contract",
    "error-handling": "Error Handling",
    "orchestrator": "Orchestrator Integration",
    "human-loop": "Human-in-the-Loop",
    "deployment": "Deployment",
    "testing": "Testing",
    "security": "Security",
  };

  let doc = `# Automation Design Document\n\n`;
  doc += `> Generated from interview session ${session.id}\n`;
  doc += `> Project type: ${session.projectType ?? "unknown"}\n`;
  doc += `> Date: ${session.createdAt}\n\n`;

  for (const [category, questions] of byCategory) {
    doc += `## ${CATEGORY_LABELS[category]}\n\n`;
    for (const q of questions) {
      doc += `**${q.question}**\n\n`;
      doc += `${q.answered ? q.answer : "_(not answered)_"}\n\n`;
    }
  }

  return doc;
}

/**
 * Generate autopilot pipeline input from a completed interview.
 */
export function generatePipelineInput(session: InterviewSession): InterviewResult["pipelineInput"] {
  const processName = session.questions.find(q => q.id === "process-name")?.answer ?? "Unnamed automation";
  const trigger = session.questions.find(q => q.id === "process-trigger")?.answer ?? "unspecified";
  const inputs = session.questions.find(q => q.id === "data-input")?.answer ?? "unspecified";
  const outputs = session.questions.find(q => q.id === "data-output")?.answer ?? "unspecified";

  // Determine skills based on answers
  const skills: string[] = [];
  const projectType = session.projectType ?? "unknown";

  if (projectType === "coded-agent") skills.push("uipath-agents");
  else if (projectType === "coded-automation") skills.push("uipath-coded-apps");
  else skills.push("uipath-rpa");

  if (session.questions.find(q => q.id === "hitl-needed" && q.answer?.toLowerCase().includes("yes"))) {
    skills.push("uipath-human-in-the-loop");
  }
  if (session.questions.find(q => q.id === "test-strategy" && q.answer?.toLowerCase().includes("test"))) {
    skills.push("uipath-test");
  }

  return {
    task: `Build ${processName} automation: ${trigger} trigger, ${inputs} → ${outputs}`,
    context: generateDesignDocument(session),
    projectType,
    skills,
  };
}

/**
 * Full pipeline: create interview, format for display, generate result.
 */
export function completeInterview(
  answers: Record<string, string>,
  projectType?: UiPathProjectType
): InterviewResult {
  let session = createInterview(projectType);
  session = batchAnswer(session, answers);

  return {
    session,
    designDocument: generateDesignDocument(session),
    pipelineInput: generatePipelineInput(session),
  };
}
