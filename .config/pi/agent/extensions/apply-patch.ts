import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  renderDiff,
  withFileMutationQueue,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type, type Static, type TObject, type TString } from "typebox";
import {
  applyPatchChunks,
  parseCodexPatch,
  type PatchOperation,
} from "#core/codex-patch";
import { resolveToAbsolute } from "#core/fs";
import * as fileTracker from "#core/file-tracker";
import { withFileLocks } from "#core/mutex";
import * as toolPolicy from "#core/tool-policy";

const APPLY_PATCH_GRAMMAR = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

const ApplyPatchParameters: TObject<{ input: TString }> = Type.Object(
  {
    input: Type.String({
      description:
        "Complete Codex patch envelope from *** Begin Patch through *** End Patch.",
    }),
  },
  { additionalProperties: false },
);

export type ApplyPatchParams = Static<typeof ApplyPatchParameters>;

interface Snapshot {
  path: string;
  exists: boolean;
  content?: string;
  mode?: number;
}

const mutationFs = {
  writeFileSync(file: string, content: string): void {
    fs.writeFileSync(file, content, "utf8");
  },
};

export interface ApplyPatchChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  diff: string;
}

interface PlannedChange extends ApplyPatchChange {
  before: string;
  after: string;
}

export interface ApplyPatchDetails {
  changes: ApplyPatchChange[];
}

const REDACTION_PATTERNS = [
  /\[REDACTED\]/i,
  /\[\.\.\.omitted.*?\]/i,
  /\[(?:rest|remaining) of .{1,40} unchanged\]/i,
  /\/\/ \.\.\.(?: rest| remaining)? (?:of )?(?:the )?(?:file|code|content|implementation).*(?:unchanged|omitted)/i,
  /(?:\/\/|#) \.\.\. existing (?:code|content|implementation)/i,
];

function assertNoRedaction(operation: PatchOperation): void {
  const beforeLines =
    operation.type === "update"
      ? operation.chunks.flatMap((chunk) => chunk.oldLines)
      : [];
  const afterLines =
    operation.type === "add"
      ? operation.content.split("\n")
      : operation.type === "update"
        ? operation.chunks.flatMap((chunk) => chunk.newLines)
        : [];
  for (const pattern of REDACTION_PATTERNS) {
    const beforeCount = beforeLines.filter((line) => pattern.test(line)).length;
    const matches = afterLines.filter((line) => pattern.test(line));
    if (matches.length > beforeCount) {
      throw new Error(
        `patch rejected: added content contains placeholder '${matches[0]}'; include the actual content`,
      );
    }
  }
}

function snapshot(file: string): Snapshot {
  let pathStat: fs.Stats;
  try {
    pathStat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: file, exists: false };
    }
    throw error;
  }
  if (pathStat.isSymbolicLink()) {
    throw new Error(`symbolic link paths are not supported: ${file}`);
  }
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  if (stat.nlink > 1) {
    throw new Error(`hard-linked files are not supported: ${file}`);
  }
  return {
    path: file,
    exists: true,
    content: fs.readFileSync(file, "utf8"),
    mode: stat.mode,
  };
}

function operationPaths(
  operation: PatchOperation,
  cwd: string,
): { source: string; destination?: string } {
  const source = path.resolve(resolveToAbsolute(operation.path, cwd));
  const destination =
    operation.type === "update" && operation.movePath
      ? path.resolve(resolveToAbsolute(operation.movePath, cwd))
      : undefined;
  if (destination === source) {
    throw new Error(`patch move source and destination are identical: ${source}`);
  }
  return { source, destination };
}

function canonicalMutationPath(file: string): string {
  const suffix: string[] = [];
  let ancestor = file;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

function usesCaseInsensitivePaths(file: string): boolean {
  let ancestor = file;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
  while (true) {
    const name = path.basename(ancestor);
    const index = name.search(/[a-z]/i);
    if (index >= 0) {
      const character = name[index]!;
      const swapped =
        character === character.toLowerCase()
          ? character.toUpperCase()
          : character.toLowerCase();
      const variant = path.join(
        path.dirname(ancestor),
        `${name.slice(0, index)}${swapped}${name.slice(index + 1)}`,
      );
      if (variant !== ancestor && fs.existsSync(variant)) {
        return fs.realpathSync(variant) === fs.realpathSync(ancestor);
      }
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
}

function pathComparisonKey(file: string): string {
  return usesCaseInsensitivePaths(file) ? file.toLowerCase() : file;
}

function assertNoPathHierarchyConflicts(files: string[]): void {
  for (const ancestor of files) {
    for (const descendant of files) {
      if (ancestor === descendant) continue;
      const relative = path.relative(ancestor, descendant);
      if (
        relative &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative)
      ) {
        throw new Error(
          `patch paths cannot contain one another: ${ancestor}, ${descendant}`,
        );
      }
    }
  }
}

function describeCall(input: string): string {
  const paths = input.split("\n").flatMap((line) => {
    const match = line.match(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/);
    return match?.[1] ? [match[1]] : [];
  });
  return paths.length > 0 ? paths.join(", ") : "...";
}

function formatResult(changes: ApplyPatchChange[]): string {
  const marker = { added: "A", modified: "M", deleted: "D" } as const;
  return changes.map((change) => `${marker[change.kind]} ${change.path}`).join("\n");
}

function missingParentDirectories(files: string[]): string[] {
  const missing = new Set<string>();
  for (const file of files) {
    let directory = path.dirname(file);
    while (!fs.existsSync(directory)) {
      missing.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...missing].sort((a, b) => b.length - a.length);
}

function restoreSnapshots(
  snapshots: Snapshot[],
  createdDirectories: string[] = [],
): void {
  const errors: unknown[] = [];
  for (const before of snapshots) {
    try {
      if (!before.exists) {
        fs.rmSync(before.path, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(before.path), { recursive: true });
      mutationFs.writeFileSync(before.path, before.content ?? "");
      if (before.mode !== undefined) fs.chmodSync(before.path, before.mode);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const directory of createdDirectories) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        errors.push(error);
      }
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "apply_patch rollback was incomplete");
  }
}

function withMutationQueues<T>(files: string[], fn: () => Promise<T>): Promise<T> {
  const paths = [...new Set(files)].sort();
  const acquire = (index: number): Promise<T> => {
    const file = paths[index];
    return file ? withFileMutationQueue(file, () => acquire(index + 1)) : fn();
  };
  return acquire(0);
}

function commitChanges(
  snapshots: Snapshot[],
  finalContents: Map<string, string | undefined>,
  finalModes: Map<string, number | undefined>,
  createdDirectories: string[],
): void {
  try {
    for (const before of snapshots) {
      const after = finalContents.get(before.path);
      if (after === undefined) {
        fs.rmSync(before.path, { force: true });
      } else {
        fs.mkdirSync(path.dirname(before.path), { recursive: true });
        mutationFs.writeFileSync(before.path, after);
        const mode = finalModes.get(before.path);
        if (mode !== undefined) fs.chmodSync(before.path, mode);
      }
    }
  } catch (error) {
    try {
      restoreSnapshots(snapshots, createdDirectories);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "apply_patch failed and rollback was incomplete",
      );
    }
    throw error;
  }
}

export function createApplyPatchTool(): ToolDefinition<
  typeof ApplyPatchParameters,
  ApplyPatchDetails
> {
  return {
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a Codex-format patch as a validated batch. Supports Add File, Update File, Delete File, Move to, multiple files, and multiple hunks. Every update must match before commit; ordinary write or tracking failures are rolled back. Process termination during commit is not crash-safe.",
    promptSnippet: "Apply precise Codex-format patches to one or more files",
    promptGuidelines: [
      "Use apply_patch for all text file creation, modification, deletion, and moves instead of edit, write, or shell redirection.",
      "Keep apply_patch hunks small and include enough unchanged context for an unambiguous match.",
      "Split unrelated or very large apply_patch changes into consecutive calls.",
    ],
    parameters: ApplyPatchParameters,
    constrainedSampling: {
      type: "grammar",
      variants: { openai_lark: APPLY_PATCH_GRAMMAR },
    },
    executionMode: "sequential",
    renderCall(args, theme, context) {
      const summary = describeCall(args?.input ?? "");
      const home = os.homedir();
      const display = summary.startsWith(home)
        ? `~${summary.slice(home.length)}`
        : summary;
      const header =
        theme.fg("toolTitle", theme.bold("apply_patch ")) + theme.fg("dim", display);
      if (!context.isPartial || !args?.input) return new Text(header, 0, 0);
      const component = new Container();
      component.addChild(new Text(header, 0, 0));
      component.addChild(new Spacer(1));
      component.addChild(new Text(args.input, 0, 0));
      return component;
    },
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("apply_patch aborted");
      const operations = parseCodexPatch(params.input);
      operations.forEach(assertNoRedaction);
      const resolved = operations.map((operation) => ({
        operation,
        ...operationPaths(operation, ctx.cwd),
      }));
      const allPaths = [
        ...new Set(
          resolved.flatMap(({ source, destination }) =>
            destination ? [source, destination] : [source],
          ),
        ),
      ];
      const canonicalPaths = allPaths.map(canonicalMutationPath);
      const comparisonPaths = canonicalPaths.map(pathComparisonKey);
      assertNoPathHierarchyConflicts(comparisonPaths);
      const aliases = comparisonPaths.filter(
        (file, index) => comparisonPaths.indexOf(file) !== index,
      );
      if (aliases.length > 0) {
        throw new Error(
          `patch paths resolve to the same file: ${[...new Set(aliases)].join(", ")}`,
        );
      }

      const verdict = toolPolicy.evaluateToolPolicy(
        "apply_patch",
        { paths: canonicalPaths, sessionCwd: ctx.cwd },
        toolPolicy.loadToolPolicy(),
      );
      if (verdict.action === "reject") {
        throw new Error(verdict.message ?? "patch rejected by tool policy");
      }

      return withMutationQueues(canonicalPaths, () =>
        withFileLocks(canonicalPaths, async () => {
          const snapshots = allPaths.map(snapshot);
          const createdDirectories = missingParentDirectories(allPaths);
          const byPath = new Map(snapshots.map((item) => [item.path, item]));
          const finalContents = new Map<string, string | undefined>(
            snapshots.map((item) => [item.path, item.content]),
          );
          const finalModes = new Map<string, number | undefined>(
            snapshots.map((item) => [item.path, item.mode]),
          );

          for (const { operation, source, destination } of resolved) {
            if (signal?.aborted) throw new Error("apply_patch aborted");
            const current = finalContents.get(source);
            if (operation.type === "add") {
              finalContents.set(source, operation.content);
            } else if (operation.type === "delete") {
              if (current === undefined) throw new Error(`file not found: ${source}`);
              finalContents.set(source, undefined);
              finalModes.set(source, undefined);
            } else {
              if (current === undefined) throw new Error(`file not found: ${source}`);
              const updated = applyPatchChunks(current, operation.chunks, source);
              if (destination) {
                const sourceMode = finalModes.get(source);
                finalContents.set(source, undefined);
                finalModes.set(source, undefined);
                finalContents.set(destination, updated);
                finalModes.set(destination, sourceMode);
              } else {
                finalContents.set(source, updated);
              }
            }
          }

          const changes: PlannedChange[] = [];
          for (const before of snapshots) {
            const after = finalContents.get(before.path);
            const afterExists = after !== undefined;
            const afterMode = finalModes.get(before.path);
            if (
              before.content === after &&
              before.exists === afterExists &&
              before.mode === afterMode
            ) {
              continue;
            }
            const beforeContent = before.content ?? "";
            const afterContent = after ?? "";
            changes.push({
              path: before.path,
              kind: !before.exists
                ? "added"
                : after === undefined
                  ? "deleted"
                  : "modified",
              before: beforeContent,
              after: afterContent,
              diff: fileTracker.simpleDiff(before.path, beforeContent, afterContent),
            });
          }
          if (changes.length === 0) throw new Error("patch made no changes");
          if (signal?.aborted) throw new Error("apply_patch aborted");

          commitChanges(snapshots, finalContents, finalModes, createdDirectories);
          const sessionId = ctx.sessionManager.getSessionId();
          try {
            fileTracker.saveChanges(
              sessionId,
              toolCallId,
              changes.map((change) => ({
                uri: `file://${change.path}`,
                before: change.before,
                after: change.after,
                diff: change.diff,
                isNewFile: !byPath.get(change.path)?.exists,
                beforeExists: byPath.get(change.path)?.exists ?? false,
                afterExists: finalContents.get(change.path) !== undefined,
                beforeMode: byPath.get(change.path)?.mode,
                afterMode:
                  finalContents.get(change.path) === undefined
                    ? undefined
                    : fs.statSync(change.path).mode,
                timestamp: Date.now(),
              })),
            );
          } catch (error) {
            try {
              restoreSnapshots(snapshots, createdDirectories);
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "apply_patch tracking failed and rollback was incomplete",
              );
            }
            throw error;
          }

          const resultChanges = changes.map(
            ({ before: _before, after: _after, ...change }) => change,
          );
          return {
            content: [{ type: "text", text: formatResult(resultChanges) }],
            details: { changes: resultChanges },
          };
        }),
      );
    },
    renderResult(result, { expanded }, theme) {
      const component = new Container();
      const changes = result.details?.changes ?? [];
      if (changes.length === 0) {
        const text = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        component.addChild(new Text(text || "(no changes)", 0, 0));
        return component;
      }
      const shown = expanded ? changes : changes.slice(-1);
      component.addChild(
        new Text(
          theme.fg(
            "dim",
            `${changes.length} file${changes.length === 1 ? "" : "s"} changed`,
          ),
          0,
          0,
        ),
      );
      for (const change of shown) {
        component.addChild(new Spacer(1));
        component.addChild(new Text(renderDiff(change.diff), 0, 0));
      }
      return component;
    },
  };
}

export default function applyPatchExtension(pi: ExtensionAPI): void {
  pi.registerTool(createApplyPatchTool());
  pi.on("session_start", () => {
    const active = pi
      .getActiveTools()
      .filter((name) => name !== "edit" && name !== "write");
    pi.setActiveTools([...new Set([...active, "apply_patch"])]);
  });
}
