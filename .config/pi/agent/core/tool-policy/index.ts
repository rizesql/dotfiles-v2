/**
 * tool policy evaluation for tool calls.
 *
 * reads rules from ~/.pi/agent/tool-policy.json. these rules are product
 * guardrails for tool routing and ergonomics, not a security boundary.
 * rules are evaluated first-match-wins, matching tool name and params via
 * glob patterns. default action when no rule matches: allow.
 *
 * shape mirrors a simple permission rule format (tool + glob matches + action):
 *   { tool, matches?, action, message? }
 *
 * only "allow" and "reject" actions for now — no "ask" or "delegate"
 * because pi's tool execute API has no confirmation mechanism.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expandPath, isPathWithin, resolveToAbsolute } from "#core/fs";

// --- types ---

type ToolPolicyPattern = string | string[];

export interface ToolPolicyRule {
  tool: string;
  matches?: {
    cmd?: ToolPolicyPattern;
    cwd?: ToolPolicyPattern;
    path?: ToolPolicyPattern;
    within?: ToolPolicyPattern;
  };
  action: "allow" | "reject";
  message?: string;
}

export interface ToolPolicyParams {
  cmd?: string;
  cwd?: string;
  path?: string;
  paths?: string[];
  sessionCwd?: string;
}

export interface ToolPolicyVerdict {
  action: "allow" | "reject";
  message?: string;
}

// --- glob matching ---

/**
 * convert a simple glob pattern (only `*` wildcards) to a regex.
 * covers common cases: `*git push*`, `rm *`, `*`.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcards}$`, "i");
}

function toPatterns(patterns: ToolPolicyPattern): string[] {
  return Array.isArray(patterns) ? patterns : [patterns];
}

function matchesGlob(value: string, patterns: ToolPolicyPattern): boolean {
  return toPatterns(patterns).some((pattern) => globToRegex(pattern).test(value));
}

function collectObservedPaths(params: ToolPolicyParams): string[] {
  return [params.path, ...(params.paths ?? [])].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function collectWithinPaths(params: ToolPolicyParams): string[] {
  const observedPaths = collectObservedPaths(params);

  if (typeof params.cwd === "string" && params.cwd.length > 0) {
    observedPaths.push(params.cwd);
  }

  return observedPaths;
}

function resolvePathLike(value: string, sessionCwd: string | undefined): string | null {
  if (sessionCwd) return resolveToAbsolute(value, sessionCwd);

  const expanded = expandPath(value);
  return path.isAbsolute(expanded) ? expanded : null;
}

function matchesWithin(params: ToolPolicyParams, roots: ToolPolicyPattern): boolean {
  const observedPaths = collectWithinPaths(params);
  if (observedPaths.length === 0) return false;

  const resolvedRoots = toPatterns(roots)
    .map((root) => resolvePathLike(root, params.sessionCwd))
    .filter((root): root is string => root !== null);
  if (resolvedRoots.length === 0) return false;

  return observedPaths.every((observedPath) => {
    const resolvedTarget = resolvePathLike(observedPath, params.sessionCwd);
    if (!resolvedTarget) return false;
    return resolvedRoots.some((root) => isPathWithin(root, resolvedTarget));
  });
}

// --- evaluation ---

export function evaluateToolPolicy(
  toolName: string,
  params: ToolPolicyParams,
  rules: ToolPolicyRule[],
): ToolPolicyVerdict {
  for (const rule of rules) {
    if (!globToRegex(rule.tool).test(toolName)) continue;

    if (rule.matches?.cmd && !matchesGlob(params.cmd ?? "", rule.matches.cmd)) {
      continue;
    }

    if (rule.matches?.cwd) {
      if (!params.cwd || !matchesGlob(params.cwd, rule.matches.cwd)) continue;
    }

    if (rule.matches?.path) {
      const observedPaths = collectObservedPaths(params);
      if (
        observedPaths.length === 0 ||
        !observedPaths.some((observedPath) =>
          matchesGlob(observedPath, rule.matches!.path!),
        )
      ) {
        continue;
      }
    }

    if (rule.matches?.within && !matchesWithin(params, rule.matches.within)) {
      continue;
    }

    return { action: rule.action, message: rule.message };
  }

  return { action: "allow" };
}

// --- loading ---

const TOOL_POLICY_PATH = path.join(os.homedir(), ".pi", "agent", "tool-policy.json");

export function loadToolPolicy(): ToolPolicyRule[] {
  try {
    const raw = fs.readFileSync(TOOL_POLICY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
