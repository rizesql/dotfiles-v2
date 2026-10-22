/**
 * read tool — replaces pi's built-in with enhanced file reading.
 *
 * differences from pi's built-in:
 * - line-numbered output (`1: content`)
 * - directory listing integrated (no separate ls tool needed)
 * - secret file blocking (.env etc.)
 * - `~` expansion and `@` prefix stripping
 * - image support via base64
 *
 * uses `path` + optional `read_range` [start, end] interface.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import * as toolPolicy from "#core/tool-policy.ts";
import { getEnabledExtensionConfig, type ExtensionConfigSchema } from "#core/config.ts";
import { withPromptPatch } from "#core/prompt-patch.ts";
import { formatHeadTail } from "#core/output-buffer.ts";
import { osc8Link, renderLifecycleCall } from "#core/box-format.ts";
import {
  isSecretFile,
  listDirectory,
  resolveToAbsolute,
  resolveWithVariants,
} from "#core/fs.ts";

// --- limits ---

export interface ReadLimits {
  maxLines: number;
  maxFileBytes: number;
  maxLineBytes: number;
  maxDirEntries: number;
}

export const NORMAL_LIMITS: ReadLimits = {
  maxLines: 500,
  maxFileBytes: 64 * 1024,
  maxLineBytes: 4096,
  maxDirEntries: 1000,
};

type ReadExtConfig = {
  maxLines: number;
  maxFileBytes: number;
  maxLineBytes: number;
  maxDirEntries: number;
};

const CONFIG_DEFAULTS: ReadExtConfig = {
  maxLines: 500,
  maxFileBytes: 65536,
  maxLineBytes: 4096,
  maxDirEntries: 1000,
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isReadConfig(value: Record<string, unknown>): value is ReadExtConfig {
  return (
    isPositiveInteger(value.maxLines) &&
    isPositiveInteger(value.maxFileBytes) &&
    isPositiveInteger(value.maxLineBytes) &&
    isPositiveInteger(value.maxDirEntries)
  );
}

const READ_CONFIG_SCHEMA: ExtensionConfigSchema<ReadExtConfig> = {
  validate: isReadConfig,
};

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function getImageMime(filePath: string) {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()];
}

// --- file reading ---

export function readFileContent(
  filePath: string,
  limits: ReadLimits,
  readRange?: [number, number],
) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  // determine the range to show
  const start = Math.max(1, readRange?.[0] ?? 1);
  const end = Math.min(totalLines, readRange?.[1] ?? start + limits.maxLines - 1);

  // number lines and truncate long lines
  const numbered: string[] = [];
  for (let i = start - 1; i < end; i++) {
    let line = allLines[i];
    if (line === undefined) {
      continue;
    }

    const lineBytes = Buffer.byteLength(line, "utf-8");

    if (lineBytes > limits.maxLineBytes) {
      while (Buffer.byteLength(line, "utf-8") > limits.maxLineBytes) {
        line = line.slice(0, Math.max(1, line.length - 100));
      }
      line += "... (line truncated)";
    }

    numbered.push(`${i + 1}: ${line}`);
  }

  // if numbered output fits in byte limit, return as-is
  const totalBytes = numbered.reduce(
    (sum, l) => sum + Buffer.byteLength(l, "utf-8") + 1,
    0,
  );
  if (totalBytes <= limits.maxFileBytes) {
    return {
      text: numbered.join("\n"),
      totalLines,
      shownStart: start,
      shownEnd: end,
    };
  }

  // otherwise apply head+tail truncation on the numbered lines
  const formatted = formatHeadTail(
    numbered,
    limits.maxLines,
    (n) =>
      `... [${n} lines truncated, ${limits.maxFileBytes / 1024}KB limit reached] ...`,
  );

  return {
    text: formatted,
    totalLines,
    shownStart: start,
    shownEnd: end,
  };
}

/**
 * read is hotter than the other shadow tools because sibling extensions import
 * its exported limits/types at module load time. config gating therefore needs
 * to stay at startup registration only: skip the custom read wrapper when
 * disabled, but keep this module's exports stable so imports like `@bds_pi/read`
 * in `ls` still evaluate normally.
 */
export default function readExtension(pi: ExtensionAPI) {
  const { enabled, config: cfg } = getEnabledExtensionConfig(
    "@bds_pi/read",
    CONFIG_DEFAULTS,
    { schema: READ_CONFIG_SCHEMA },
  );
  if (!enabled) {
    return;
  }

  pi.registerTool(
    withPromptPatch({
      name: "read",
      label: "Read",
      description:
        "Read a file or list a directory from the file system. If the path is a directory, it returns a list of entries. If the file or directory doesn't exist, an error is returned.\n\n" +
        `- The path parameter MUST be an absolute path.\n` +
        `- By default, this tool returns the first ${cfg.maxLines} lines. To read more, call it multiple times with different read_ranges.\n` +
        "- Use the Grep tool to find specific content in large files or files with long lines.\n" +
        "- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n" +
        '- The contents are returned with each line prefixed by its line number. For example, if a file has contents "abc\\n", you will receive "1: abc\\n". For directories, entries are returned one per line (without line numbers) with a trailing "/" for subdirectories.\n' +
        "- This tool can read images (such as PNG, JPEG, and GIF files) and present them to the model visually.\n" +
        "- When possible, call this tool in parallel for all files you will want to read.\n" +
        "      - Avoid tiny repeated slices (e.g., 50‑line chunks). If you need more context from the same file, read a larger range or the full default window instead.",

      parameters: Type.Object({
        path: Type.String({
          description:
            "The absolute path to the file or directory (MUST be absolute, not relative).",
        }),
        read_range: Type.Optional(
          Type.Array(Type.Number(), {
            minItems: 2,
            maxItems: 2,
            description: `An array of two integers specifying the start and end line numbers to view. Line numbers are 1-indexed. If not provided, defaults to [1, ${cfg.maxLines}]. Examples: [500, 700], [700, 1400]`,
          }),
        ),
      }),

      renderCall: (args, theme, context) => {
        const filePath = args.path || "...";
        const home = os.homedir();
        const shortened = filePath.startsWith(home)
          ? `~${filePath.slice(home.length)}`
          : filePath;
        const readRange = args.read_range;

        let displayContext = shortened;
        if (Array.isArray(readRange) && readRange.length === 2) {
          displayContext += `:${readRange[0]}-${readRange[1]}`;
        }

        const linked = filePath.startsWith("/")
          ? osc8Link(`file://${filePath}`, displayContext)
          : displayContext;

        return renderLifecycleCall(
          new Text(
            theme.fg("toolTitle", theme.bold("Read ")) + theme.fg("dim", linked),
            0,
            0,
          ),
          theme,
          context,
        );
      },

      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const requestedPath = resolveToAbsolute(params.path, ctx.cwd);
        const verdict = toolPolicy.evaluateToolPolicy(
          "read",
          { path: requestedPath, sessionCwd: ctx.cwd },
          toolPolicy.loadToolPolicy(),
        );

        if (verdict.action === "reject") {
          return {
            content: [
              {
                type: "text" as const,
                text: verdict.message
                  ? `path rejected: ${verdict.message}`
                  : "path rejected by tool policy.",
              },
            ],
            isError: true,
            details: {},
          };
        }

        const resolved = resolveWithVariants(params.path, ctx.cwd);

        if (isSecretFile(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `refused to read ${path.basename(resolved)}: file may contain secrets. ask the user to share relevant values.`,
              },
            ],
            isError: true,
            details: {},
          };
        }

        if (!fs.existsSync(resolved)) {
          return {
            content: [{ type: "text" as const, text: `file not found: ${resolved}` }],
            isError: true,
            details: {},
          };
        }

        const stat = fs.statSync(resolved);

        // --- directory ---
        if (stat.isDirectory()) {
          try {
            let text = listDirectory(resolved, cfg.maxDirEntries);
            return {
              content: [{ type: "text" as const, text }],
              details: { filePath: resolved, isDirectory: true },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: err.message }],
              isError: true,
              details: {},
            };
          }
        }

        // --- image ---
        const mime = getImageMime(resolved);
        if (mime) {
          try {
            const base64 = fs.readFileSync(resolved).toString("base64");
            return {
              content: [{ type: "image" as const, data: base64, mimeType: mime }],
              details: {},
            };
          } catch (err: any) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `failed to read image: ${err.message}`,
                },
              ],
              isError: true,
              details: {},
            };
          }
        }

        // --- text file ---
        try {
          const { text, totalLines, shownStart, shownEnd } = readFileContent(
            resolved,
            cfg,
            params.read_range as [number, number] | undefined,
          );

          let output = text;
          let notice: string | undefined;

          if (shownEnd < totalLines) {
            notice = `showing lines ${shownStart}-${shownEnd} of ${totalLines}`;
            output += `\n\n(${notice}. use read_range to see more.)`;
          }

          return {
            content: [{ type: "text" as const, text: output }],
            details: { filePath: resolved, notice },
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `failed to read file: ${err.message}`,
              },
            ],
            details: {},
            isError: true,
          };
        }
      },
    }),
  );
}
