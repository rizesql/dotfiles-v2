/**
 * read_session tool — extract relevant context from a pi session via sub-agent.
 *
 * loads a full session tree (all branches), renders it as structured markdown,
 * then spawns a gemini flash sub-agent to extract only the information
 * relevant to the stated goal. the agent sees the complete tree — including
 * abandoned branches — so it can understand decision points and context.
 *
 * branch awareness: if a leaf_id is provided, the target branch is annotated
 * in the rendered output so the agent knows which path to focus on.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getEnabledExtensionConfig, type ExtensionConfigSchema } from "#core/config.ts";
import { withPromptPatch } from "#core/prompt-patch.ts";
import { headTailChars } from "#core/output-buffer.ts";
import { walkDirSync } from "#core/fs.ts";
import {
  boxRendererWindowed,
  renderLifecycleCall,
  textSection,
  type Excerpt,
} from "#core/box-format.ts";
import { Text } from "@earendil-works/pi-tui";

const COLLAPSED_EXCERPTS: Excerpt[] = [
  { focus: "head" as const, context: 5 },
  { focus: "tail" as const, context: 5 },
];

type ReadSessionExtConfig = {
  sessionsDirs?: string[];
  maxChars: number;
};

const CONFIG_DEFAULTS: ReadSessionExtConfig = {
  sessionsDirs: [
    process.env.PI_CODING_AGENT_SESSION_DIR ||
      path.join(os.homedir(), ".local", "share", "pi", "sessions"),
    path.join(os.homedir(), ".pi", "agent", "sessions"),
  ],
  maxChars: 120_000,
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadSessionConfig(
  value: Record<string, unknown>,
): value is ReadSessionExtConfig {
  return (
    (value.sessionsDir === undefined || isNonEmptyString(value.sessionsDir)) &&
    (value.sessionsDirs === undefined ||
      (Array.isArray(value.sessionsDirs) &&
        value.sessionsDirs.length > 0 &&
        value.sessionsDirs.every(isNonEmptyString))) &&
    (value.sessionsDir !== undefined || value.sessionsDirs !== undefined) &&
    typeof value.maxChars === "number" &&
    Number.isInteger(value.maxChars) &&
    value.maxChars >= 1
  );
}

const READ_SESSION_CONFIG_SCHEMA: ExtensionConfigSchema<ReadSessionExtConfig> = {
  validate: isReadSessionConfig,
};

// --- session parsing (shared types with search-sessions) ---

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

interface MessageContent {
  role: string;
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  [key: string]: unknown;
}

// --- session rendering ---

export interface ReadSessionParams {
  session_id: string;
  goal: string;
  leaf_id?: string;
}

function findSessionFile(sessionId: string, sessionsDirs: string[]) {
  if (sessionId.length === 0) {
    return null;
  }

  for (const sessionsDir of sessionsDirs) {
    if (!fs.existsSync(sessionsDir)) {
      continue;
    }

    const matches = walkDirSync(sessionsDir, {
      filter: (entry, absolutePath) => {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
          return false;
        }

        try {
          const firstLine = fs.readFileSync(absolutePath, "utf-8").split("\n")[0];
          if (!firstLine) {
            return false;
          }

          const header = JSON.parse(firstLine);
          return (
            header.type === "session" &&
            typeof header.id === "string" &&
            header.id.startsWith(sessionId)
          );
        } catch {
          return false;
        }
      },
    });
    if (matches.length > 1) {
      throw new Error(`ambiguous session id prefix: ${sessionId}`);
    }
    if (matches[0]) {
      return matches[0];
    }
  }

  return null;
}

function resolveSessionsDirs(config: { sessionsDir?: string; sessionsDirs?: string[] }) {
  const configured = config.sessionsDir
    ? [config.sessionsDir]
    : (config.sessionsDirs ?? CONFIG_DEFAULTS.sessionsDirs!);
  return [
    ...new Set(
      configured.map((sessionsDir) =>
        path.resolve(sessionsDir.replace(/^~(?=$|\/)/, os.homedir())),
      ),
    ),
  ];
}

function renderSessionTree(
  filePath: string,
  targetLeafId: string | undefined,
  maxChars: number,
) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const entries: SessionEntry[] = [];
  let sessionId = "";
  let sessionName = "";
  let cwd = "";
  let timestamp = "";

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "session") {
        sessionId = entry.id;
        cwd = entry.cwd || "";
        timestamp = entry.timestamp || "";
      }
      if (entry.type === "session_info" && entry.name) {
        sessionName = entry.name;
      }
      if (entry.id) {
        entries.push(entry);
      }
    } catch {
      /* skip */
    }
  }

  // build tree
  const byId = new Map<string, SessionEntry>();
  const children = new Map<string, string[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    const parent = e.parentId ?? "__root__";
    if (!children.has(parent)) {
      children.set(parent, []);
    }

    children.get(parent)!.push(e.id);
  }

  // find target branch path (leaf → root) for annotation
  const targetPath = new Set<string>();
  if (targetLeafId) {
    let current = targetLeafId;
    while (current) {
      targetPath.add(current);
      const entry = byId.get(current);
      if (!entry?.parentId) {
        break;
      }

      current = entry.parentId;
    }
  }

  // detect branch points (entries with >1 child)
  const branchPoints = new Set<string>();
  for (const [parentId, kids] of children.entries()) {
    if (kids.length > 1) {
      branchPoints.add(parentId);
    }
  }

  // render as markdown via DFS
  const parts: string[] = [];
  parts.push(`# session: ${sessionName || sessionId}`);
  parts.push(`id: ${sessionId}`);
  parts.push(`workspace: ${cwd}`);
  parts.push(`started: ${timestamp}`);
  if (targetLeafId) {
    parts.push(`target branch leaf: ${targetLeafId}`);
  }
  parts.push("");

  const renderEntry = (entryId: string, depth: number) => {
    const entry = byId.get(entryId);
    if (!entry) {
      return;
    }

    const isTarget = targetPath.has(entryId);
    const marker = isTarget ? " [TARGET BRANCH]" : "";

    // check if this is a branch point
    const kids = children.get(entryId) || [];
    if (kids.length > 1) {
      parts.push(`\n--- branch point (${kids.length} paths) ---\n`);
    }

    if (entry.type === "message") {
      const msg = entry.message as MessageContent | undefined;
      if (!msg) {
        return;
      }

      if (msg.role === "user") {
        const textParts =
          msg.content
            ?.filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n") || "";
        if (textParts) {
          parts.push(`## user${marker}`);
          parts.push(textParts);
          parts.push("");
        }
      } else if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolCalls: string[] = [];

        for (const part of msg.content || []) {
          if (part.type === "text" && part.text) {
            textParts.push(part.text);
          } else if (part.type === "toolCall") {
            const args = part.arguments
              ? JSON.stringify(part.arguments).slice(0, 200)
              : "";
            toolCalls.push(`${part.name}(${args})`);
          }
          // skip thinking blocks — they're internal
        }

        if (textParts.length > 0 || toolCalls.length > 0) {
          parts.push(`## assistant${marker}`);
          if (textParts.length > 0) {
            parts.push(textParts.join("\n"));
          }
          if (toolCalls.length > 0) {
            parts.push(`\ntool calls: ${toolCalls.join(", ")}`);
          }
          parts.push("");
        }
      } else if (msg.role === "toolResult") {
        const toolName = msg.toolName || "?";
        const textContent =
          msg.content
            ?.filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n") || "";
        // truncate tool results to avoid overwhelming the context
        const truncated =
          textContent.length > 500
            ? `${textContent.slice(0, 500)}... (truncated)`
            : textContent;
        if (truncated) {
          parts.push(`### ${toolName} result${msg.isError ? " (ERROR)" : ""}${marker}`);
          parts.push(truncated);
          parts.push("");
        }
      }
    } else if (entry.type === "model_change") {
      parts.push(`*model changed to ${String(entry.modelId)}*\n`);
    }

    // render children
    for (const childId of kids) {
      renderEntry(childId, depth + 1);
    }
  };

  // start from root entries (parentId is null or points to non-existent)
  const rootIds = children.get("__root__") || [];
  // also find entries whose parentId doesn't exist in byId (orphan roots)
  for (const e of entries) {
    if (e.parentId && !byId.has(e.parentId) && !rootIds.includes(e.id)) {
      rootIds.push(e.id);
    }
  }

  for (const rootId of rootIds) {
    renderEntry(rootId, 0);
  }

  let markdown = parts.join("\n");
  const truncated = headTailChars(markdown, maxChars);
  if (truncated.truncated) {
    markdown = truncated.text;
  }

  return { markdown, sessionName, sessionId };
}

export default function readSessionExtension(pi: ExtensionAPI) {
  const { enabled, config: config_ } = getEnabledExtensionConfig(
    "@bds_pi/read-session",
    CONFIG_DEFAULTS,
    { schema: READ_SESSION_CONFIG_SCHEMA },
  );

  if (!enabled) {
    return;
  }

  const config = {
    sessionsDirs: resolveSessionsDirs(config_),
    maxChars: config_.maxChars,
  };

  return pi.registerTool(
    withPromptPatch({
      name: "read_session",
      label: "Read Session",
      description:
        "Read and extract relevant content from a past pi session.\n\n" +
        "Loads the full session branch and returns conversation history without spawning sub-agents.\n" +
        "Use `search_sessions` first to find session IDs.",

      parameters: Type.Object({
        session_id: Type.String({
          description: "The session ID to read (from search_sessions results).",
        }),
        goal: Type.String({
          description:
            "What information you're looking for. Be specific about what to extract.",
        }),
        leaf_id: Type.Optional(
          Type.String({
            description:
              "Optional branch leaf ID to focus on. The AI will see all branches " +
              "but prioritize the target branch.",
          }),
        ),
      }),

      async execute(_toolCallId, params) {
        const sessionFile = findSessionFile(params.session_id, config.sessionsDirs);
        if (!sessionFile) {
          throw new Error(`session not found: ${params.session_id}`);
        }

        // render session tree
        const { markdown } = renderSessionTree(
          sessionFile,
          params.leaf_id,
          config.maxChars,
        );

        if (!markdown.trim()) {
          return {
            content: [{ type: "text" as const, text: "(session is empty)" }],
            details: { sessionId: params.session_id },
          };
        }

        const header = params.goal ? `## Goal: ${params.goal}\n\n` : "";

        return {
          content: [{ type: "text" as const, text: header + markdown }],
          details: { sessionId: params.session_id },
        };
      },

      renderCall(args, theme, context) {
        const preview = args.goal ? `${args.session_id} — ${args.goal}` : args.session_id;
        return renderLifecycleCall(
          new Text(
            theme.fg("toolTitle", theme.bold("read_session ")) +
              theme.fg("dim", preview || "..."),
            0,
            0,
          ),
          theme,
          context,
        );
      },

      renderResult(result, { expanded }) {
        const first = result.content?.[0];
        const text =
          first && typeof first === "object" && "text" in first ? first.text : "";

        return boxRendererWindowed(
          () => [textSection("session transcript", text || "-")],
          { collapsed: { maxSections: 1, excerpts: COLLAPSED_EXCERPTS }, expanded: {} },
          undefined,
          expanded,
        );
      },
    }),
  );
}
