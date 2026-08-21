/**
 * bash tool — replaces pi's built-in with enhanced command execution.
 *
 * differences from pi's built-in:
 * - `cmd` + `cwd` params (model-compatible interface, not pi's `command`)
 * - auto-splits `cd dir && cmd` into cwd + command (fallback for models)
 * - trailing `&` starts a tracked background process and returns immediately
 * - git commit trailer injection (session ID)
 * - git lock serialization via withFileLock (prevents concurrent git ops)
 * - SIGTERM → SIGKILL fallback on cancel/timeout (pi goes straight to SIGKILL)
 * - output truncation with head + tail (first/last N lines, not just tail)
 * - constant memory via OutputBuffer (no unbounded string growth)
 * - tool policy rules from ~/.pi/agent/tool-policy.json (allow/reject)
 *
 * shadows pi's built-in `bash` tool via same-name registration.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getShellConfig, highlightCode } from "@earendil-works/pi-coding-agent";
import { withPromptPatch } from "#core/prompt-patch";
import { boxRendererWindowed, type BoxSection, type Excerpt } from "#core/box-format";
import { getText, getTruncateToWidth } from "#core/tui";
import { Type } from "typebox";
import { withFileLock } from "#core/mutex";
import * as toolPolicy from "#core/tool-policy";
import { resolveToAbsolute } from "#core/fs";
import { OutputBuffer } from "#core/output-buffer";
import { getEnabledExtensionConfig, type ExtensionConfigSchema } from "#core/config";

type BashExtConfig = {
  headLines: number;
  tailLines: number;
  sigkillDelayMs: number;
};

type BackgroundProcess = {
  pid: number;
  command: string;
  cwd: string;
  logPath: string;
  ownerSessionId?: string;
  startedAt: string;
  timeoutHandle?: ReturnType<typeof setTimeout>;
};

type BackgroundState = {
  nextId: number;
  processes: Map<string, BackgroundProcess>;
};

type BashProcessStatus = "completed" | "failed" | "aborted" | "timed_out" | "spawn_error";

type BashExtensionDeps = {
  getEnabledExtensionConfig: typeof getEnabledExtensionConfig;
  withPromptPatch: typeof withPromptPatch;
};

const CONFIG_DEFAULTS: BashExtConfig = {
  headLines: 50,
  tailLines: 50,
  sigkillDelayMs: 3000,
};

const DEFAULT_DEPS: BashExtensionDeps = {
  getEnabledExtensionConfig,
  withPromptPatch,
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isBashConfig(value: Record<string, unknown>): value is BashExtConfig {
  return (
    isPositiveInteger(value.headLines) &&
    isPositiveInteger(value.tailLines) &&
    typeof value.sigkillDelayMs === "number" &&
    Number.isInteger(value.sigkillDelayMs) &&
    value.sigkillDelayMs >= 0
  );
}

const BASH_CONFIG_SCHEMA: ExtensionConfigSchema<BashExtConfig> = {
  validate: isBashConfig,
};

// --- shell config ---

/**
 * uses pi's getShellConfig() for cross-platform shell resolution.
 */

// --- command preprocessing ---

/**
 * models often emit leading `cd ... &&` out of unix habit. normalize that
 * prefix into `cwd + command` so execution metadata keeps the real directory.
 */
function splitCdCommand(cmd: string): { cwd: string; command: string } | null {
  const match = cmd.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*(.+)$/s);
  if (!match) return null;
  const dir = match[1] ?? match[2] ?? match[3] ?? "";
  const command = match[4];
  if (!command) return null;
  return { cwd: dir, command };
}

function parseBackgroundCommand(cmd: string): {
  command: string;
  background: boolean;
} {
  if (!/\s*&\s*$/.test(cmd)) return { command: cmd, background: false };
  return {
    command: cmd.replace(/\s*&\s*$/, ""),
    background: true,
  };
}

function isExplicitPathToken(token: string): boolean {
  return /^(\/|\.\/|\.\.\/|~\/)/.test(token);
}

function extractPathTokenCandidates(token: string): string[] {
  const candidates = [token];
  const equalsIndex = token.indexOf("=");
  if (equalsIndex !== -1 && equalsIndex < token.length - 1) {
    candidates.push(token.slice(equalsIndex + 1));
  }

  const redirectionMatch = token.match(/^\d*(?:>>?|<<?|&>>?|&>)(.+)$/);
  if (redirectionMatch?.[1]) candidates.push(redirectionMatch[1]);

  return candidates.filter(isExplicitPathToken);
}

/**
 * conservative path extraction for tool policy checks.
 *
 * this is intentionally token-based, not a shell parser. it only tracks
 * explicit path-shaped args we care about for policy: absolute paths plus
 * `./`, `../`, and `~/` forms, including simple `flag=path` and redirection
 * shapes.
 */
function extractExplicitPathArgs(cmd: string, cwd: string): string[] {
  const paths = new Set<string>();

  for (const match of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (!token) continue;

    for (const candidate of extractPathTokenCandidates(token)) {
      paths.add(resolveToAbsolute(candidate, cwd));
    }
  }

  return [...paths];
}

type CommandDisplayRow = {
  text: string;
  separator?: string;
  command?: false;
};

type Heredoc = {
  delimiter: string;
  stripTabs: boolean;
};

function unquoteShellWord(word: string): string {
  let result = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of word) {
    if (escaped) {
      result += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else result += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else {
      result += char;
    }
  }
  if (escaped) result += "\\";
  return result;
}

function matchHeredoc(cmd: string, index: number): Heredoc | null {
  const match = cmd.slice(index).match(/^<<(-)?[ \t]*([^\s;|&<>]+)/);
  const word = match?.[2];
  return word === undefined
    ? null
    : { delimiter: unquoteShellWord(word), stripTabs: match?.[1] === "-" };
}

function isCommentOnly(text: string): boolean {
  return /^(?:[({]\s*)*#/.test(text.trimStart());
}

/**
 * split compound shell input into display rows without changing execution.
 *
 * amp treats control operators as visual boundaries: each command or pipeline
 * stage gets one collapsed row, while quoted operators remain ordinary args.
 * this lexer is display-only; bash remains the source of truth for semantics.
 */
function splitCommandDisplayRows(cmd: string): CommandDisplayRow[] {
  const rows: CommandDisplayRow[] = [];
  const pendingHeredocs: Heredoc[] = [];
  let activeHeredoc: Heredoc | undefined;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inComment = false;
  let escaped = false;
  let nestedParenDepth = 0;

  const push = (end: number, separator?: string, command = true) => {
    const text = cmd
      .slice(start, end)
      .replace(/[ \t]*\\\r?\n[ \t]*/g, " ")
      .trim();
    if (text) {
      rows.push({
        text,
        ...(separator ? { separator } : {}),
        ...(!command ? { command: false as const } : {}),
      });
    }
  };

  for (let i = 0; i < cmd.length; i++) {
    if (activeHeredoc) {
      const newline = cmd.indexOf("\n", i);
      const end = newline === -1 ? cmd.length : newline;
      const rawLine = cmd.slice(i, end).replace(/\r$/, "");
      const comparable = activeHeredoc.stripTabs ? rawLine.replace(/^\t+/, "") : rawLine;

      push(end, newline === -1 ? undefined : "\n", false);
      if (comparable === activeHeredoc.delimiter) {
        activeHeredoc = pendingHeredocs.shift();
      }
      start = end + 1;
      if (newline === -1) break;
      i = end;
      continue;
    }

    const ch = cmd[i];
    const next = cmd[i + 1];
    if (!ch) continue;

    if (inComment) {
      if (ch !== "\n") continue;
      const commentOnly = isCommentOnly(cmd.slice(start, i));
      push(i, "\n", !commentOnly);
      start = i + 1;
      inComment = false;
      activeHeredoc = pendingHeredocs.shift();
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }

    if (inBacktick) {
      if (ch === "`") inBacktick = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      continue;
    }

    if (nestedParenDepth > 0) {
      if (ch === "(") nestedParenDepth++;
      if (ch === ")") nestedParenDepth--;
      continue;
    }
    if (ch === "$" && next === "(") {
      nestedParenDepth = 1;
      i++;
      continue;
    }
    if (ch === "(" && next === "(") {
      nestedParenDepth = 2;
      i++;
      continue;
    }

    if (ch === "#" && (i === start || /[\s;|&(){}]/.test(cmd[i - 1] ?? ""))) {
      inComment = true;
      continue;
    }

    if (ch === "<" && next === "<") {
      const heredoc = matchHeredoc(cmd, i);
      if (heredoc) pendingHeredocs.push(heredoc);
    }

    let separator: string | undefined;
    let separatorLength = 1;
    if (ch === "&" && next === "&") {
      separator = "&&";
      separatorLength = 2;
    } else if (ch === "|" && next === "|") {
      separator = "||";
      separatorLength = 2;
    } else if (ch === "|" && next === "&") {
      separator = "|&";
      separatorLength = 2;
    } else if (ch === "|") {
      separator = "|";
    } else if (ch === ";" && next === ";") {
      separator = ";;";
      separatorLength = 2;
    } else if (ch === ";") {
      separator = ";";
    } else if (ch === "\n") {
      separator = "\n";
    }

    if (!separator) continue;

    push(i, separator);
    i += separatorLength - 1;
    start = i + 1;
    if (separator === "\n") activeHeredoc = pendingHeredocs.shift();
  }

  const commentOnly = inComment && isCommentOnly(cmd.slice(start));
  push(cmd.length, undefined, !commentOnly);
  return rows.length > 0 ? rows : [{ text: cmd.trim() || "..." }];
}

function styleCollapsedCommandRow(
  row: CommandDisplayRow,
  first: boolean,
  theme: any,
): string {
  const prefix = first ? `${theme.fg("accent", "$")} ` : "  ";
  const separator = row.separator
    ? row.separator === "\n"
      ? " \\"
      : ` ${row.separator} \\`
    : "";
  if (row.command === false) {
    return prefix + theme.fg("muted", row.text + separator);
  }

  const match = row.text.match(/^((?:(?:\{|\(|!)\s+)*)(\S+)(.*)$/s);
  if (!match) return prefix + theme.fg("muted", row.text + separator);

  const structure = match[1] ?? "";
  const command = match[2] ?? row.text;
  const args = match[3] ?? "";
  return (
    prefix +
    theme.fg("text", structure) +
    theme.fg("text", theme.bold(command)) +
    theme.fg("muted", args + separator)
  );
}

function normalizeCommandPolicyStage(text: string): string {
  let stage = text.trim();
  const caseCommand = stage.match(/^case\b.*\bin\b.*\)\s*(.+)$/s)?.[1];
  if (caseCommand) stage = caseCommand;

  while (stage) {
    const normalized = stage
      .replace(/^[{}()]\s*/, "")
      .replace(/^!\s*/, "")
      .replace(/^(?:if|while|until|elif|then|do|else)\b\s*/, "")
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, "");
    if (normalized === stage) break;
    stage = normalized;
  }
  return stage;
}

function getCommandPolicyCandidates(command: string): string[] {
  return [
    ...new Set([
      command,
      ...splitCommandDisplayRows(command)
        .filter((row) => row.command !== false)
        .map((row) => normalizeCommandPolicyStage(row.text))
        .filter(Boolean),
    ]),
  ];
}

function isGitCommand(cmd: string): boolean {
  return /\bgit\s+/.test(cmd);
}

/**
 * inject session ID trailer into git commit commands so commits
 * are traceable back to the pi session that authored them.
 * skips if trailers are already present (model added them manually).
 */
function injectGitTrailers(cmd: string, sessionId: string): string {
  if (!/\bgit\s+commit\b/.test(cmd)) return cmd;
  if (/--trailer/.test(cmd)) return cmd;
  return cmd.replace(
    /\bgit\s+commit\b/,
    `git commit --trailer "Session-Id: ${sessionId}"`,
  );
}

// --- process management ---

/**
 * SIGTERM the process group first, escalate to SIGKILL after delay.
 * pi's built-in goes straight to SIGKILL via killProcessTree().
 * graceful fallback so processes can clean up.
 */
function killGracefully(pid: number, delayMs: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }

  setTimeout(() => {
    try {
      process.kill(-pid, 0);
      process.kill(-pid, "SIGKILL");
    } catch {
      // already dead
    }
  }, delayMs);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createBackgroundState(): BackgroundState {
  return {
    nextId: 1,
    processes: new Map(),
  };
}

function getBackgroundLogPath(id: string): string {
  return path.join(os.tmpdir(), `pi-bash-${id}.log`);
}

async function terminateBackgroundProcess(
  processInfo: BackgroundProcess,
  delayMs: number,
): Promise<void> {
  if (processInfo.timeoutHandle) clearTimeout(processInfo.timeoutHandle);
  if (!isPidAlive(processInfo.pid)) return;

  killGracefully(processInfo.pid, delayMs);

  const startedAt = Date.now();
  while (Date.now() - startedAt < delayMs + 500) {
    if (!isPidAlive(processInfo.pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function cleanupBackgroundProcesses(
  backgroundState: BackgroundState,
  delayMs: number,
): Promise<void> {
  const entries = [...backgroundState.processes.entries()];
  backgroundState.processes.clear();
  backgroundState.nextId = 1;

  await Promise.all(
    entries.map(async ([, processInfo]) => {
      await terminateBackgroundProcess(processInfo, delayMs);
    }),
  );
}

/** per-block excerpts for collapsed display — head 3 + tail 5 = 8 visual lines */
const COLLAPSED_EXCERPTS: Excerpt[] = [
  { focus: "head" as const, context: 3 },
  { focus: "tail" as const, context: 5 },
];

// --- tool factory ---

export function createBashTool(
  backgroundState: BackgroundState = createBackgroundState(),
  config: BashExtConfig = CONFIG_DEFAULTS,
): ToolDefinition<any> {
  return {
    name: "bash",
    label: "Bash",
    description:
      "Executes the given shell command using bash.\n\n" +
      "- Compound commands run in one shell invocation and display one stage per line\n" +
      "- A leading `cd dir && cmd` is normalized into `cwd` + `cmd` for compatibility with model habits\n" +
      "- A trailing `&` runs the command in the background and returns immediately with a PID and log path\n" +
      "- Do NOT use interactive commands (REPLs, editors, password prompts)\n" +
      `- Output shows first ${config.headLines} and last ${config.tailLines} lines; middle is truncated for large outputs\n` +
      "- Environment variables and `cd` do not persist between commands; use the `cwd` parameter instead\n" +
      "- Commands run in the workspace root by default; only use `cwd` when you need a different directory\n" +
      '- ALWAYS quote file paths: `cat "path with spaces/file.txt"`\n' +
      "- Use ffgrep instead of grep, the Read tool instead of cat\n" +
      "- Only run `git commit` and `git push` if explicitly instructed by the user.",

    parameters: Type.Object({
      cmd: Type.String({
        description: "The shell command to execute.",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory for the command (absolute path). Defaults to workspace root.",
        }),
      ),
      timeout: Type.Optional(
        Type.Number({
          description: "Timeout in seconds.",
          minimum: 1,
          maximum: 2147483,
        }),
      ),
    }),

    renderCall(args: any, theme: any, context: any) {
      const Text = getText();
      const cmd = args.cmd || args.command || "...";
      const timeoutSuffix = args.timeout
        ? theme.fg("muted", ` (timeout ${args.timeout}s)`)
        : "";

      if (context.expanded) {
        const highlighted = highlightCode(cmd, "bash");
        highlighted[0] = `${theme.fg("accent", "$")} ${highlighted[0] ?? ""}`;
        if (timeoutSuffix) {
          const last = highlighted.length - 1;
          highlighted[last] = `${highlighted[last] ?? ""}${timeoutSuffix}`;
        }
        return new Text(highlighted.join("\n"), 0, 0);
      }

      const rows = splitCommandDisplayRows(cmd).map((row, index) =>
        styleCollapsedCommandRow(row, index === 0, theme),
      );
      if (timeoutSuffix) rows[rows.length - 1] += timeoutSuffix;

      return {
        render(width: number): string[] {
          const truncateToWidth = getTruncateToWidth();
          return rows.map((row) => truncateToWidth(row, width, "…"));
        },
        invalidate() {},
      };
    },

    renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
      const Text = getText();
      const content = result.content?.[0];
      if (!content || content.type !== "text")
        return new Text(theme.fg("dim", "(no output)"), 0, 0);

      // extract command from structured details (preferred) or parse from content
      let text: string = content.text;
      let command: string = result.details?.command ?? "";
      if (!command && text.startsWith("$ ")) {
        const firstNewline = text.indexOf("\n");
        if (firstNewline !== -1) {
          command = text.slice(2, firstNewline);
        }
      }
      // strip `$ command\n\n` prefix — renderCall already shows it
      if (text.startsWith("$ ")) {
        const sep = text.indexOf("\n\n");
        if (sep !== -1) {
          text = text.slice(sep + 2);
        }
      }

      if (!text || text === "(no output)")
        return new Text(theme.fg("dim", "(no output)"), 0, 0);

      const lines = text.split("\n");

      const buildSections = (): BoxSection[] => [
        {
          blocks: [
            {
              lines: lines.map((l) => ({
                text: theme.fg("toolOutput", l),
                highlight: true,
              })),
            },
          ],
        },
      ];

      return boxRendererWindowed(
        buildSections,
        {
          collapsed: { excerpts: COLLAPSED_EXCERPTS },
          expanded: {},
        },
        undefined,
        expanded,
      );
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const p = params as { cmd: string; cwd?: string; timeout?: number };
      if (
        p.timeout !== undefined &&
        (!Number.isFinite(p.timeout) || p.timeout <= 0 || p.timeout > 2147483)
      ) {
        throw new Error("timeout must be between 1 and 2147483 seconds");
      }

      const parsed = parseBackgroundCommand(p.cmd);
      let command = parsed.command;
      let effectiveCwd = p.cwd ? resolveToAbsolute(p.cwd, ctx.cwd) : ctx.cwd;

      const cdSplit = splitCdCommand(command);
      if (cdSplit) {
        effectiveCwd = resolveToAbsolute(cdSplit.cwd, effectiveCwd);
        command = cdSplit.command;
      }

      const pathTargets = extractExplicitPathArgs(command, effectiveCwd);
      const policyRules = toolPolicy.loadToolPolicy();
      for (const policyCommand of getCommandPolicyCandidates(command)) {
        const verdict = toolPolicy.evaluateToolPolicy(
          "bash",
          {
            cmd: policyCommand,
            cwd: effectiveCwd,
            paths: pathTargets,
            sessionCwd: ctx.cwd,
          },
          policyRules,
        );
        if (verdict.action === "reject") {
          const msg = verdict.message
            ? `command rejected: ${verdict.message}`
            : `command rejected by tool policy. command: ${policyCommand}`;
          throw new Error(msg);
        }
      }

      if (!fs.existsSync(effectiveCwd)) {
        throw new Error(`working directory does not exist: ${effectiveCwd}`);
      }

      const sessionId = ctx.sessionManager.getSessionId();
      command = injectGitTrailers(command, sessionId);
      const displayCommand = parsed.background ? `${command} &` : command;
      const env = createBashSessionEnvironment(ctx);

      const run = () =>
        parsed.background
          ? runBackgroundCommand(
              command,
              displayCommand,
              effectiveCwd,
              p.timeout,
              signal,
              backgroundState,
              config,
              env,
            )
          : runForegroundCommand(
              command,
              displayCommand,
              effectiveCwd,
              p.timeout,
              signal,
              onUpdate,
              config,
              env,
            );

      if (isGitCommand(command)) {
        const gitLockKey = path.join(effectiveCwd, ".git", "__pi_git_lock__");
        return withFileLock(gitLockKey, run);
      }

      return run();
    },
  };
}

// --- execution ---

const PI_SESSION_ENV_KEYS = [
  "PI_SESSION_ID",
  "PI_SESSION_FILE",
  "PI_PROVIDER",
  "PI_MODEL",
  "PI_REASONING_LEVEL",
] as const;

function createBashSessionEnvironment(ctx: any): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of PI_SESSION_ENV_KEYS) delete env[key];

  const sessionId = ctx.sessionManager?.getSessionId?.();
  const sessionFile = ctx.sessionManager?.getSessionFile?.();
  if (sessionId) env.PI_SESSION_ID = sessionId;
  if (sessionFile) env.PI_SESSION_FILE = sessionFile;
  if (ctx.model?.provider) env.PI_PROVIDER = ctx.model.provider;
  if (ctx.model?.id) env.PI_MODEL = ctx.model.id;
  if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;

  return env;
}

function hasFailedProcess(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const processDetails = (details as Record<string, unknown>).process;
  if (!processDetails || typeof processDetails !== "object") return false;
  const status = (processDetails as Record<string, unknown>).status;
  return typeof status === "string" && status !== "completed";
}

async function runForegroundCommand(
  command: string,
  displayCommand: string,
  cwd: string,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ((update: any) => void) | undefined,
  config: BashExtConfig,
  env: NodeJS.ProcessEnv,
): Promise<any> {
  const { shell, args } = getShellConfig();
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const child = spawn(shell, [...args, command], {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output = new OutputBuffer(config.headLines, config.tailLines);
    let terminationCause: "timeout" | "aborted" | undefined;
    let exitObserved = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let drainHandle: ReturnType<typeof setTimeout> | undefined;
    const terminate = (cause: "timeout" | "aborted") => {
      if (terminationCause || exitObserved) return;
      terminationCause = cause;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
      if (child.pid) killGracefully(child.pid, config.sigkillDelayMs);
    };
    const onAbort = () => terminate("aborted");

    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => terminate("timeout"), timeout * 1000);
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const handleData = (data: Buffer) => {
      output.add(data.toString("utf-8"));

      if (onUpdate) {
        const { text } = output.format();
        onUpdate({ content: [{ type: "text", text }] });
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);
    child.once("exit", () => {
      exitObserved = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
      drainHandle = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, 100);
    });

    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (drainHandle) clearTimeout(drainHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        content: [{ type: "text" as const, text: `command error: ${err.message}` }],
        details: {
          command: displayCommand,
          cwd,
          process: {
            pid: child.pid,
            processGroupId: child.pid,
            ownerSessionId: env.PI_SESSION_ID,
            startedAt,
            endedAt: new Date().toISOString(),
            status: "spawn_error" satisfies BashProcessStatus,
            exitCode: null,
            signal: null,
            timeoutSeconds: timeout,
            errorKind: "spawn_error",
          },
        },
        isError: true,
      });
    });

    child.on("close", (code, signalCode) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (drainHandle) clearTimeout(drainHandle);
      signal?.removeEventListener("abort", onAbort);

      const { text: outputText } = output.format();
      const finish = (
        text: string,
        status: BashProcessStatus,
        errorKind?: "aborted" | "timeout" | "nonzero_exit" | "signal_exit",
      ) =>
        resolve({
          content: [{ type: "text" as const, text }],
          details: {
            command: displayCommand,
            cwd,
            process: {
              pid: child.pid,
              processGroupId: child.pid,
              ownerSessionId: env.PI_SESSION_ID,
              startedAt,
              endedAt: new Date().toISOString(),
              status,
              exitCode: code,
              signal: signalCode,
              timeoutSeconds: timeout,
              errorKind,
            },
          },
          ...(errorKind ? { isError: true } : {}),
        });

      if (terminationCause === "aborted") {
        const text = outputText ? `${outputText}\n\ncommand aborted` : "command aborted";
        finish(text, "aborted", "aborted");
        return;
      }

      if (terminationCause === "timeout") {
        const text = outputText
          ? `${outputText}\n\ncommand timed out after ${timeout} seconds`
          : `command timed out after ${timeout} seconds`;
        finish(text, "timed_out", "timeout");
        return;
      }

      let result = `$ ${displayCommand}\n\n${outputText || "(no output)"}`;

      if (signalCode !== null) {
        result += `\n\nterminated by signal ${signalCode}`;
        finish(result, "failed", "signal_exit");
      } else if (code !== 0 && code !== null) {
        result += `\n\nexit code ${code}`;
        finish(result, "failed", "nonzero_exit");
      } else {
        finish(result, "completed");
      }
    });
  });
}

async function runBackgroundCommand(
  command: string,
  displayCommand: string,
  cwd: string,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
  backgroundState: BackgroundState,
  config: BashExtConfig,
  env: NodeJS.ProcessEnv,
): Promise<any> {
  const { shell, args } = getShellConfig();
  const id = `bg-${backgroundState.nextId++}`;
  const logPath = getBackgroundLogPath(id);
  const logFd = fs.openSync(logPath, "a");
  const startedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const child = spawn(shell, [...args, command], {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);

    if (signal?.aborted) {
      if (child.pid) killGracefully(child.pid, config.sigkillDelayMs);
      reject(new Error("command aborted"));
      return;
    }

    child.on("error", (err) => {
      backgroundState.processes.delete(id);
      reject(new Error(`command error: ${err.message}`));
    });

    const pid = child.pid;
    if (!pid) {
      backgroundState.processes.delete(id);
      reject(new Error("command error: failed to determine background pid"));
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (isPidAlive(pid)) killGracefully(pid, config.sigkillDelayMs);
      }, timeout * 1000);
    }

    backgroundState.processes.set(id, {
      pid,
      command,
      cwd,
      logPath,
      ownerSessionId: env.PI_SESSION_ID,
      startedAt,
      timeoutHandle,
    });

    child.on("close", () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      backgroundState.processes.delete(id);
    });

    child.unref();

    const timeoutNote =
      timeout && timeout > 0
        ? `\nwill be terminated after ${timeout} seconds if still running.`
        : "";

    resolve({
      content: [
        {
          type: "text" as const,
          text:
            `$ ${displayCommand}\n\nstarted background process ${id} (pid ${pid})` +
            `\nlog: ${logPath}` +
            "\nuse the read tool on the log path to inspect readiness or output." +
            `\nuse bash to stop it, e.g. \`kill ${pid}\`.` +
            timeoutNote,
        },
      ],
      details: {
        command: displayCommand,
        cwd,
        background: {
          id,
          pid,
          processGroupId: pid,
          logPath,
          ownerSessionId: env.PI_SESSION_ID,
          startedAt,
          status: "running",
          timeoutSeconds: timeout,
        },
      },
    });
  });
}

/**
 * bash also shadows a pi built-in, so disabling this extension should stop at
 * the wrapper boundary and reveal pi's native bash tool. sub-agents still ask
 * for the name `bash`; preserving that name avoids breaking tool selection
 * while letting config opt out of the stricter command policy here.
 */
function createBashExtension(
  deps: BashExtensionDeps = DEFAULT_DEPS,
): (pi: ExtensionAPI) => void {
  return function bashExtension(pi: ExtensionAPI): void {
    const { enabled, config: cfg } = deps.getEnabledExtensionConfig(
      "#core/bash",
      CONFIG_DEFAULTS,
      { schema: BASH_CONFIG_SCHEMA },
    );
    if (!enabled) return;

    const backgroundState = createBackgroundState();

    pi.registerTool(deps.withPromptPatch(createBashTool(backgroundState, cfg)));
    pi.on("tool_result", async (event) => {
      if (event.toolName.toLowerCase() === "bash" && hasFailedProcess(event.details)) {
        return { isError: true };
      }
    });
    pi.on("session_shutdown", async () => {
      await cleanupBackgroundProcesses(backgroundState, cfg.sigkillDelayMs);
    });
    pi.on("session_start", async (event) => {
      if (
        event.reason === "new" ||
        event.reason === "resume" ||
        event.reason === "fork"
      ) {
        await cleanupBackgroundProcesses(backgroundState, cfg.sigkillDelayMs);
      }
    });
  };
}

const bashExtension: (pi: ExtensionAPI) => void = createBashExtension();

export default bashExtension;
