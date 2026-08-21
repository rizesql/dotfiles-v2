/**
 * shared pi process spawning for dedicated sub-agent tools.
 *
 * extracts the spawn-parse-collect loop from the generic subagent
 * extension into a reusable function. each dedicated tool (finder,
 * oracle, delegate) calls piSpawn() with its own config.
 *
 * uses shared interpolation from @bds_pi/interpolate for template variables
 * ({cwd}, {roots}, {date}, etc.) in system prompts.
 *
 * cancellation matters now that extensions get ctx.signal: child pi processes
 * should die when the parent turn is aborted, otherwise sub-agents keep
 * running after the user already bailed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  KnownApi,
  Message,
  Model,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveGlobalSettingsPath } from "#core/config";
import { interpolatePromptVars } from "#core/interpolate";

// --- types ---

/** sub-agent spawn accepts a registry model or a CLI `provider/modelId` string (JSON config). */
export type PiSpawnModel = Model<KnownApi> | string;

export function isPiSpawnModelValue(value: unknown): value is PiSpawnModel {
  if (typeof value === "string") return value.trim().length > 0;
  if (value !== null && typeof value === "object") {
    const m = value as Record<string, unknown>;
    return (
      typeof m.provider === "string" &&
      m.provider.trim().length > 0 &&
      typeof m.id === "string" &&
      m.id.trim().length > 0
    );
  }
  return false;
}

export function modelCliString(model: PiSpawnModel): string {
  return typeof model === "string" ? model : `${model.provider}/${model.id}`;
}

export function getToolCalls(messages: Message[]): RecordedToolCall[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    return message.content.flatMap((part) =>
      part.type === "toolCall"
        ? [
            {
              id: part.id,
              name: part.name,
              arguments: part.arguments,
            },
          ]
        : [],
    );
  });
}

export function getToolResults(
  messages: Message[],
  toolName?: string,
): ToolResultMessage<unknown>[] {
  return messages.filter(
    (message): message is ToolResultMessage<unknown> =>
      message.role === "toolResult" &&
      (toolName === undefined || message.toolName === toolName),
  );
}

export function getToolResultText(
  result: ToolResultMessage<unknown> | undefined,
): string {
  return (
    result?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? ""
  );
}

export function getNestedMessages(
  result: ToolResultMessage<unknown> | undefined,
): Message[] {
  if (!result?.details || typeof result.details !== "object") return [];
  const messages = (result.details as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (message): message is Message =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      ["user", "assistant", "toolResult"].includes(String(message.role)),
  );
}

function killSpawnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        child.kill(signal);
        return;
      }
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  cost: number;
  costBreakdown?: Usage["cost"];
  contextTokens: number;
  turns: number;
}

export interface PiSpawnSession {
  id?: string;
  leafId?: string;
  persist?: boolean;
  /** source session file to link from a fresh child session header. */
  parentSession?: string;
}

export interface PiSpawnSessionMeta {
  continueId?: string;
  sessionId?: string;
  sessionFile?: string;
  leafId?: string;
  unsupported?: string;
}

export interface RecordedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type PiSpawnStatus =
  "starting" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export type PiSpawnErrorKind =
  | "unsupported"
  | "setup"
  | "spawn"
  | "agent"
  | "exit"
  | "signal"
  | "transport"
  | "cancelled"
  | "timeout";

export interface PiSpawnOwner {
  sessionId?: string;
  sessionFile?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface PiSpawnLifecycle {
  pid: number | null;
  processGroupId: number | null;
  owner: PiSpawnOwner | null;
  startedAt: string;
  endedAt: string | null;
  status: PiSpawnStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorKind: PiSpawnErrorKind | null;
  cancellationRequestedAt: string | null;
  timeoutMs: number | null;
  timedOutAt: string | null;
}

export function isPiSpawnFailure(result: PiSpawnResult): boolean {
  return (
    result.lifecycle?.status === "failed" ||
    result.lifecycle?.status === "cancelled" ||
    result.lifecycle?.status === "timed_out" ||
    result.exitCode !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted"
  );
}

export interface PiSpawnResult {
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: PiSpawnModel;
  stopReason?: string;
  errorMessage?: string;
  session?: PiSpawnSessionMeta;
  lifecycle?: PiSpawnLifecycle;
}

export interface PiSpawnConfig {
  cwd: string;
  task: string;
  model?: PiSpawnModel;
  builtinTools?: string[];
  extensionTools?: string[];
  systemPromptBody?: string;
  signal?: AbortSignal;
  onUpdate?: (result: PiSpawnResult) => void;
  session?: PiSpawnSession;
  repo?: string;
  /**
   * override the global bds config path for the child process.
   *
   * when omitted, piSpawn propagates the parent's resolved global config path
   * via PI_BDS_CONFIG_PATH so sub-agents inherit extension gating.
   */
  configPath?: string;
  /**
   * inject a follow-up user message after the agent's first turn.
   *
   * uses pi's RPC mode instead of print mode. the follow-up is queued
   * eagerly at startup (not delivered until idle), so the agent loop's
   * getFollowUpMessages() finds it after exploration completes. the
   * process is killed after the second end_turn.
   *
   * primary use case: code_review — agent explores the diff first,
   * then receives the report format instructions.
   */
  followUp?: string;
  /**
   * additional environment variables to pass to the child process.
   *
   * useful for testing tool-policy.json by overriding HOME.
   */
  env?: Record<string, string | undefined>;
  owner?: PiSpawnOwner;
  timeoutMs?: number;
}

// --- helpers ---

function writePromptToTempFile(
  label: string,
  prompt: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = label.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

export function zeroUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

export function toToolUsage(
  usage: Pick<
    UsageStats,
    | "input"
    | "output"
    | "cacheRead"
    | "cacheWrite"
    | "cacheWrite1h"
    | "reasoning"
    | "cost"
    | "costBreakdown"
  >,
): Usage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: usage.cacheWrite1h } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
    totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: {
      input: usage.costBreakdown?.input ?? 0,
      output: usage.costBreakdown?.output ?? 0,
      cacheRead: usage.costBreakdown?.cacheRead ?? 0,
      cacheWrite: usage.costBreakdown?.cacheWrite ?? 0,
      total: usage.cost,
    },
  };
}

/**
 * resolve a prompt from either an inline string or a file.
 *
 * precedence: promptString (if non-empty) → readAgentPrompt(promptFile).
 * lets extensions externalize prompt content via config while
 * keeping shared .md prompt files as the default source.
 */
export function resolvePrompt(promptString: string, promptFile: string): string {
  if (promptString) return promptString;
  return readAgentPrompt(promptFile);
}

/**
 * read an agent prompt .md file, strip frontmatter, return body.
 * looks in ~/.pi/agent/agents/{filename}.
 */
export function readAgentPrompt(filename: string): string {
  const promptPath = path.join(os.homedir(), ".pi", "agent", "agents", filename);
  try {
    const content = fs.readFileSync(promptPath, "utf-8");
    if (content.startsWith("---")) {
      const endIdx = content.indexOf("\n---", 3);
      if (endIdx !== -1) return content.slice(endIdx + 4).trim();
    }
    return content;
  } catch {
    return "";
  }
}

interface ResolvedSessionRouting {
  args: string[];
  meta?: PiSpawnSessionMeta;
  sessionIdForPrompt?: string;
  unsupported?: string;
}

function normalizedSessionValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function configuredSessionDir(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const sessionDir = normalizedSessionValue(env.PI_CODING_AGENT_SESSION_DIR);
  if (!sessionDir) return undefined;
  return sessionDir === "~" || sessionDir.startsWith("~/")
    ? path.join(os.homedir(), sessionDir.slice(2))
    : sessionDir;
}

function readSessionHeaderId(filePath: string): string | undefined {
  try {
    const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return undefined;
    const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown };
    return header.type === "session" && typeof header.id === "string"
      ? header.id
      : undefined;
  } catch {
    return undefined;
  }
}

async function findLocalSessionFileByExactId(
  cwd: string,
  sessionId: string,
  sessionDir?: string,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const sessions = await SessionManager.list(cwd, sessionDir);
  return sessions.find((session) => session.id === sessionId)?.path;
}

function materializeSessionFile(sessionManager: SessionManager): void {
  const sessionFile = sessionManager.getSessionFile();
  const header = sessionManager.getHeader();
  if (!sessionFile || !header) {
    throw new Error("[#core/pi-spawn] failed to create child session header");
  }

  try {
    const fd = fs.openSync(sessionFile, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(header)}\n`);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readSessionHeaderId(sessionFile) === header.id) return;
    throw new Error(
      `[#core/pi-spawn] session file already exists with a different id: ${sessionFile}`,
    );
  }
}

async function createLinkedSessionFile(
  cwd: string,
  sessionDir: string | undefined,
  sessionId: string | undefined,
  parentSession: string | undefined,
): Promise<{ sessionId: string; sessionFile: string }> {
  if (sessionId) {
    const existing = await findLocalSessionFileByExactId(cwd, sessionId, sessionDir);
    if (existing) return { sessionId, sessionFile: existing };
  }

  const sessionManager = SessionManager.create(cwd, sessionDir, {
    ...(sessionId ? { id: sessionId } : {}),
    ...(parentSession ? { parentSession } : {}),
  });
  materializeSessionFile(sessionManager);

  const createdSessionId = sessionManager.getSessionId();
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    throw new Error("[#core/pi-spawn] failed to resolve child session file");
  }
  return { sessionId: createdSessionId, sessionFile };
}

function sessionMeta(
  sessionId: string | undefined,
  sessionFile: string | undefined,
  leafId: string | undefined,
): PiSpawnSessionMeta | undefined {
  const meta: PiSpawnSessionMeta = {};
  if (sessionId) {
    meta.sessionId = sessionId;
    meta.continueId = sessionId;
  }
  if (sessionFile) meta.sessionFile = sessionFile;
  if (leafId) meta.leafId = leafId;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

async function resolveSessionRouting(
  cwd: string,
  session: PiSpawnSession | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedSessionRouting> {
  const sessionId = normalizedSessionValue(session?.id);
  const leafId = normalizedSessionValue(session?.leafId);

  if (leafId) {
    return {
      args: [],
      meta: {
        ...(sessionId ? { sessionId, continueId: sessionId } : {}),
        leafId,
        unsupported: "leafId",
      },
      sessionIdForPrompt: sessionId,
      unsupported:
        "session.leafId is not supported yet; stable branch-target continuation is not wired.",
    };
  }

  if (session?.persist === false) {
    return { args: ["--no-session"] };
  }

  const linkedSession = await createLinkedSessionFile(
    cwd,
    configuredSessionDir(env),
    sessionId,
    normalizedSessionValue(session?.parentSession),
  );
  return {
    args: ["--session", linkedSession.sessionFile],
    meta: sessionMeta(linkedSession.sessionId, linkedSession.sessionFile, undefined),
    sessionIdForPrompt: linkedSession.sessionId,
  };
}

// --- spawn ---

export async function piSpawn(config: PiSpawnConfig): Promise<PiSpawnResult> {
  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
  ) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  const useRpc = !!config.followUp;
  const spawnEnv: Record<string, string | undefined> = {
    ...process.env,
    PI_BDS_CONFIG_PATH: config.configPath ?? resolveGlobalSettingsPath(),
    ...config.env,
  };
  if (config.extensionTools !== undefined) {
    if (config.extensionTools.length === 0) {
      spawnEnv.PI_INCLUDE_TOOLS = "NONE";
    } else {
      spawnEnv.PI_INCLUDE_TOOLS = config.extensionTools.join(",");
    }
  }

  const startedAt = new Date().toISOString();
  const parentSessionFile = normalizedSessionValue(config.session?.parentSession);
  const parentSessionId = parentSessionFile
    ? readSessionHeaderId(parentSessionFile)
    : undefined;
  const inferredOwner: PiSpawnOwner = {
    ...(parentSessionFile
      ? {
          sessionFile: parentSessionFile,
          ...(parentSessionId ? { sessionId: parentSessionId } : {}),
        }
      : {}),
    ...config.owner,
  };
  const lifecycle: PiSpawnLifecycle = {
    pid: null,
    processGroupId: null,
    owner: Object.keys(inferredOwner).length > 0 ? inferredOwner : null,
    startedAt,
    endedAt: null,
    status: "starting",
    exitCode: null,
    signal: null,
    errorKind: null,
    cancellationRequestedAt: null,
    timeoutMs: config.timeoutMs ?? null,
    timedOutAt: null,
  };
  const baseResult = (): PiSpawnResult => ({
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: zeroUsage(),
    lifecycle,
  });

  if (config.signal?.aborted) {
    lifecycle.status = "cancelled";
    lifecycle.errorKind = "cancelled";
    lifecycle.cancellationRequestedAt = startedAt;
    lifecycle.endedAt = startedAt;
    return {
      ...baseResult(),
      exitCode: 1,
      stopReason: "aborted",
      errorMessage: "pi process cancelled",
    };
  }

  let sessionRouting: ResolvedSessionRouting;
  try {
    sessionRouting = await resolveSessionRouting(config.cwd, config.session, spawnEnv);
  } catch (error) {
    lifecycle.status = "failed";
    lifecycle.errorKind = "setup";
    lifecycle.endedAt = new Date().toISOString();
    return {
      ...baseResult(),
      exitCode: 1,
      stopReason: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  const args: string[] = useRpc
    ? ["--mode", "rpc", ...sessionRouting.args]
    : ["--mode", "json", "-p", ...sessionRouting.args];

  if (config.model) args.push("--model", modelCliString(config.model));
  if (config.builtinTools !== undefined) {
    if (config.builtinTools.length === 0) {
      args.push("--no-tools");
    } else {
      args.push("--tools", config.builtinTools.join(","));
    }
  }

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;
  if (sessionRouting.unsupported) {
    lifecycle.endedAt = startedAt;
    lifecycle.status = "failed";
    lifecycle.errorKind = "unsupported";
  }

  const result: PiSpawnResult = {
    ...baseResult(),
    exitCode: sessionRouting.unsupported ? 1 : 0,
    ...(sessionRouting.meta ? { session: sessionRouting.meta } : {}),
    ...(sessionRouting.unsupported
      ? { stopReason: "error", errorMessage: sessionRouting.unsupported }
      : {}),
    lifecycle,
  };

  if (sessionRouting.unsupported) return result;

  try {
    if (config.systemPromptBody?.trim()) {
      const interpolated = interpolatePromptVars(config.systemPromptBody, config.cwd, {
        sessionId: sessionRouting.sessionIdForPrompt,
        repo: config.repo,
      });
      const tmp = writePromptToTempFile("subagent", interpolated);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    // in print mode, task is a CLI arg. in RPC mode, sent via stdin prompt command.
    if (!useRpc) {
      args.push(`Delegated task: ${config.task}`);
    }

    let wasAborted = false;
    let wasTimedOut = false;
    const debugEnabled = !!process.env.PI_SPAWN_DEBUG;
    const debug = (label: string, data?: Record<string, unknown>) => {
      if (!debugEnabled) return;
      const suffix = data ? ` ${JSON.stringify(data)}` : "";
      process.stderr.write(`[pi-spawn] ${label}${suffix}\n`);
    };

    const piBin = process.env.PI_BIN || "pi";
    const outcome = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      spawnError?: string;
      transportError?: string;
      rpcCompleted: boolean;
    }>((resolve) => {
      const proc = spawn(piBin, args, {
        cwd: config.cwd,
        detached: process.platform !== "win32",
        shell: false,
        stdio: [useRpc ? "pipe" : "ignore", "pipe", "pipe"],
        env: spawnEnv,
      });
      lifecycle.pid = proc.pid ?? null;
      lifecycle.processGroupId = process.platform !== "win32" ? (proc.pid ?? null) : null;
      lifecycle.status = "running";
      let transportError: string | undefined;
      proc.stdin?.on("error", (error) => {
        transportError = error.message;
        result.errorMessage = error.message;
        terminate();
      });

      // RPC state: track end_turns to know when to kill
      let endTurnCount = 0;
      let rpcCompleted = false;
      const expectedTurns = config.followUp ? 2 : 1;

      // send initial prompt via RPC stdin, then immediately queue follow_up.
      // follow_up is queued (not delivered) until the agent is idle, so the
      // agent loop's getFollowUpMessages() will find it after exploration.
      // sending it eagerly avoids a race where the loop exits before a
      // late follow_up arrives through the cross-process stdin/stdout round-trip.
      if (useRpc && proc.stdin) {
        const promptCmd = JSON.stringify({
          type: "prompt",
          message: `Delegated task: ${config.task}`,
        });
        debug("send_prompt");
        proc.stdin.write(promptCmd + "\n");

        if (config.followUp) {
          const followUpCmd = JSON.stringify({
            type: "follow_up",
            message: config.followUp,
          });
          debug("send_follow_up");
          proc.stdin.write(followUpCmd + "\n");
        }
      }

      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: { type?: string; message?: Message };
        try {
          event = JSON.parse(line) as { type?: string; message?: Message };
        } catch {
          return;
        }

        // skip RPC protocol responses (acks for prompt/follow_up/abort commands)
        if (event.type === "response") return;

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          result.messages.push(msg);

          if (msg.role === "assistant") {
            result.usage.turns++;
            const { usage } = msg;
            if (usage) {
              result.usage.input += usage.input || 0;
              result.usage.output += usage.output || 0;
              result.usage.cacheRead += usage.cacheRead || 0;
              result.usage.cacheWrite += usage.cacheWrite || 0;
              if (usage.cacheWrite1h !== undefined) {
                result.usage.cacheWrite1h =
                  (result.usage.cacheWrite1h ?? 0) + usage.cacheWrite1h;
              }
              if (usage.reasoning !== undefined) {
                result.usage.reasoning = (result.usage.reasoning ?? 0) + usage.reasoning;
              }
              result.usage.cost += usage.cost?.total || 0;
              const previousCost = result.usage.costBreakdown;
              result.usage.costBreakdown = {
                input: (previousCost?.input ?? 0) + (usage.cost?.input || 0),
                output: (previousCost?.output ?? 0) + (usage.cost?.output || 0),
                cacheRead: (previousCost?.cacheRead ?? 0) + (usage.cost?.cacheRead || 0),
                cacheWrite:
                  (previousCost?.cacheWrite ?? 0) + (usage.cost?.cacheWrite || 0),
                total: (previousCost?.total ?? 0) + (usage.cost?.total || 0),
              };
              result.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!result.model && msg.model) {
              result.model = `${msg.provider}/${msg.model}`;
            }
            if (msg.stopReason) result.stopReason = msg.stopReason;
            if (msg.errorMessage) result.errorMessage = msg.errorMessage;

            const { stopReason } = msg;
            const isTurnEnd = stopReason === "stop";
            debug("turn_end", {
              stopReason,
              isTurnEnd,
              endTurnCount,
              expectedTurns,
            });

            // RPC kill logic: terminate after expected number of end_turns.
            // follow_up was already queued eagerly at startup, so we just
            // count turns and kill when done.
            if (useRpc && isTurnEnd) {
              endTurnCount++;
              if (endTurnCount >= expectedTurns) {
                rpcCompleted = true;
                debug("kill_after_turn", { endTurnCount });
                terminate();
              }
            }

            // RPC: if agent errors, terminate immediately
            if (useRpc && (stopReason === "error" || stopReason === "aborted")) {
              debug("kill_after_error", { stopReason });
              terminate();
            }
          }

          if (config.onUpdate) config.onUpdate({ ...result });
        }

        if (event.type === "tool_result_end" && event.message) {
          result.messages.push(event.message as Message);
          if (config.onUpdate) config.onUpdate({ ...result });
        }
      };

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr!.on("data", (data: Buffer) => {
        result.stderr += data.toString();
      });

      let killTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let settled = false;
      const finish = (value: {
        code: number | null;
        signal: NodeJS.Signals | null;
        spawnError?: string;
      }) => {
        if (settled) return;
        settled = true;
        if (config.signal) config.signal.removeEventListener("abort", killProc);
        if (killTimer) clearTimeout(killTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (buffer.trim()) processLine(buffer);
        resolve({ ...value, rpcCompleted, transportError });
      };
      const terminate = () => {
        if (killTimer) return;
        killSpawnedProcess(proc, "SIGTERM");
        killTimer = setTimeout(() => {
          killSpawnedProcess(proc, "SIGKILL");
        }, 5000);
      };
      const killProc = () => {
        if (wasAborted || wasTimedOut || settled) return;
        wasAborted = true;
        lifecycle.cancellationRequestedAt = new Date().toISOString();
        terminate();
      };

      proc.on("close", (code, signal) => {
        finish({ code, signal });
      });

      proc.on("error", (error) => {
        finish({ code: null, signal: null, spawnError: error.message });
      });

      if (config.signal) {
        if (config.signal.aborted) killProc();
        else config.signal.addEventListener("abort", killProc, { once: true });
      }
      if (config.timeoutMs !== undefined) {
        timeoutTimer = setTimeout(() => {
          if (wasAborted || wasTimedOut || settled) return;
          wasTimedOut = true;
          lifecycle.timedOutAt = new Date().toISOString();
          terminate();
        }, config.timeoutMs);
      }
    });

    lifecycle.endedAt = new Date().toISOString();
    lifecycle.exitCode = outcome.code;
    lifecycle.signal = outcome.signal;
    result.exitCode = outcome.code ?? (outcome.spawnError ? 1 : 0);
    if (wasAborted) {
      result.exitCode = 1;
      result.stopReason = "aborted";
      result.errorMessage ??= "pi process cancelled";
      lifecycle.status = "cancelled";
      lifecycle.errorKind = "cancelled";
    } else if (wasTimedOut) {
      result.exitCode = 1;
      result.stopReason = "aborted";
      result.errorMessage ??= `pi process timed out after ${config.timeoutMs}ms`;
      lifecycle.status = "timed_out";
      lifecycle.errorKind = "timeout";
    } else if (outcome.spawnError) {
      result.exitCode = 1;
      result.errorMessage = outcome.spawnError;
      lifecycle.status = "failed";
      lifecycle.errorKind = "spawn";
    } else if (outcome.transportError) {
      result.exitCode = 1;
      lifecycle.status = "failed";
      lifecycle.errorKind = "transport";
    }
    // RPC processes are killed intentionally — don't treat SIGTERM exit as error
    const expectedRpcTermination =
      useRpc &&
      outcome.rpcCompleted &&
      (result.stopReason === "end_turn" || result.stopReason === "stop");
    if (expectedRpcTermination) {
      result.exitCode = 0;
      lifecycle.status = "succeeded";
      lifecycle.errorKind = null;
    } else if (
      !wasAborted &&
      !wasTimedOut &&
      !outcome.spawnError &&
      !outcome.transportError &&
      useRpc &&
      !outcome.rpcCompleted
    ) {
      result.exitCode = result.exitCode || 1;
      result.errorMessage ??= "pi RPC ended before all expected turns completed";
      lifecycle.status = "failed";
      lifecycle.errorKind = "agent";
    } else if (
      !wasAborted &&
      !wasTimedOut &&
      !outcome.spawnError &&
      !outcome.transportError &&
      (result.stopReason === "error" || result.stopReason === "aborted")
    ) {
      lifecycle.status = "failed";
      lifecycle.errorKind = "agent";
    } else if (
      !wasAborted &&
      !wasTimedOut &&
      !outcome.spawnError &&
      !outcome.transportError &&
      outcome.signal
    ) {
      result.exitCode = 1;
      result.errorMessage ??= `pi process terminated by signal ${outcome.signal}`;
      lifecycle.status = "failed";
      lifecycle.errorKind = "signal";
    } else if (
      !wasAborted &&
      !wasTimedOut &&
      !outcome.spawnError &&
      !outcome.transportError &&
      outcome.code !== 0
    ) {
      result.errorMessage ??= `pi process exited with code ${outcome.code}`;
      lifecycle.status = "failed";
      lifecycle.errorKind = "exit";
    } else if (
      !wasAborted &&
      !wasTimedOut &&
      !outcome.spawnError &&
      !outcome.transportError
    ) {
      lifecycle.status = "succeeded";
      lifecycle.errorKind = null;
    }
    return result;
  } finally {
    if (tmpPromptPath)
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    if (tmpPromptDir)
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
  }
}
