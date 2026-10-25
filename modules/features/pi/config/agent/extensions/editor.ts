// oxlint-disable no-control-regex
/**
 * editor extension — composable custom editor with box-drawing borders and label slots.
 *
 * replaces pi's default editor with ╭╮╰╯ borders. other extensions can inject
 * labels into the top/bottom border lines via the shared EventBus:
 *
 *   pi.events.emit("editor:set-label", { key: "status", text: "↳ ready", position: "top", align: "left" })
 *   pi.events.emit("editor:remove-label", { key: "status" })
 *
 * multiple labels on the same border are separated by " · ". left labels fill
 * from the left edge, right labels from the right edge.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor, Theme, estimateTokens } from "@earendil-works/pi-coding-agent";
import type { TUI, EditorTheme, TuiMouseEvent } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";

import { boxBorderLR, boxRow } from "#core/box-chrome.ts";

interface Label {
  key: string;
  text: string;
  position: "top" | "bottom";
  align: "left" | "right";
}

interface SetLabelPayload {
  key: string;
  text: string;
  position?: "top" | "bottom";
  align?: "left" | "right";
}

interface RemoveLabelPayload {
  key: string;
}

const SEPARATOR = " · ";
const HORIZONTAL = "─";

export function translateFramedEditorMouseEvent(event: TuiMouseEvent) {
  const innerWidth = event.width - 2;
  if (innerWidth < 4) {
    return event;
  }

  const x = event.x - 1;
  if (x < 0 || x >= innerWidth) {
    return undefined;
  }

  return { ...event, x, width: innerWidth };
}

export class LabeledEditor extends CustomEditor {
  private labels: Map<string, Label> = new Map();
  private appTheme: Theme;
  private borderCache: Record<"top" | "bottom", { key: string; line: string } | null> = {
    top: null,
    bottom: null,
  };

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    appTheme: Theme,
  ) {
    super(tui, editorTheme, keybindings);
    this.appTheme = appTheme;
  }

  /** always-dim color for box chrome (corners, lines, rails) */
  private dim(str: string) {
    return this.appTheme.fg("dim", str);
  }

  setLabel(
    key: string,
    text: string,
    position: "top" | "bottom" = "top",
    align: "left" | "right" = "left",
  ) {
    const current = this.labels.get(key);
    if (
      current?.text === text &&
      current.position === position &&
      current.align === align
    ) {
      return;
    }

    this.labels.set(key, { key, text, position, align });
    this.invalidate();
    this.tui.requestRender();
  }

  removeLabel(key: string) {
    if (!this.labels.delete(key)) {
      return;
    }

    this.invalidate();
    this.tui.requestRender();
  }

  override invalidate() {
    this.borderCache.top = null;
    this.borderCache.bottom = null;
    super.invalidate();
  }

  private getLabelsFor(position: "top" | "bottom", align: "left" | "right") {
    const matching = [...this.labels.values()].filter(
      (l) => l.position === position && l.align === align,
    );
    if (matching.length === 0) {
      return "";
    }

    return matching.map((l) => l.text).join(SEPARATOR);
  }

  private extractScrollIndicator(originalLine: string) {
    if (!originalLine.includes("↑") && !originalLine.includes("↓")) {
      return "";
    }

    const match = originalLine.match(/[↑↓]\s+\d+\s+more/);
    return match ? match[0] : "";
  }

  /**
   * build a border line like: ╭─ left label ─────── right label ─╮
   *
   * inherits scroll indicator text from the original border line if present.
   * delegates chrome layout to boxBorderLR; caching stays here.
   */
  private buildBorderLine(
    outerWidth: number,
    corner: { left: string; right: string },
    position: "top" | "bottom",
    originalLine: string,
  ) {
    const leftText = this.getLabelsFor(position, "left");
    const rightText = this.getLabelsFor(position, "right");
    const scrollIndicator = this.extractScrollIndicator(originalLine);

    const rightParts = [rightText, scrollIndicator].filter(Boolean);
    const rightCombined = rightParts.join(SEPARATOR);

    const cacheKey = `${outerWidth}|${position}|${leftText}|${rightCombined}`;
    const cached = this.borderCache[position];

    if (cached?.key === cacheKey) {
      return cached.line;
    }

    const chrome = { dim: (s: string) => this.dim(s) };
    const innerWidth = outerWidth - 2; // strip corner characters

    const line = boxBorderLR({
      corner,
      style: chrome,
      innerWidth,
      left: leftText ? { text: leftText, width: visibleWidth(leftText) } : undefined,
      right: rightCombined
        ? { text: rightCombined, width: visibleWidth(rightCombined) }
        : undefined,
    });

    this.borderCache[position] = { key: cacheKey, line };
    return line;
  }

  /**
   * find the bottom border index in the lines array from super.render().
   * the bottom border is a full-width line of ─ characters (possibly with a scroll indicator).
   * autocomplete lines appear after it and contain mixed content (not all ─).
   *
   * strategy: walk backward from the end, looking for a line whose stripped content
   * is predominantly ─ characters. the first such line (from the end) is the bottom border.
   */
  private findBottomBorderIndex(lines: string[]) {
    for (let i = lines.length - 1; i >= 1; i--) {
      const line = lines[i];
      if (!line) {
        continue;
      }

      const stripped = line
        .replace(/\x1b\[[0-9;]*[mGKHJ]/g, "")
        .replace(/\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\]8;;[^\x07]*\x07/g, "");

      if (stripped.length > 0 && stripped[0] === HORIZONTAL) {
        return i;
      }
    }

    return lines.length - 1;
  }

  override render(width: number) {
    // render the base editor at (width - 2) to leave room for │ side rails
    const innerWidth = width - 2;
    if (innerWidth < 4) {
      return super.render(width); // too narrow, bail
    }

    const lines = super.render(innerWidth);
    if (lines.length < 2) {
      return lines;
    }

    const bottomIdx = this.findBottomBorderIndex(lines);
    const result: string[] = [];

    const chrome = { dim: (s: string) => this.dim(s) };

    // top border — replace line 0
    result.push(this.buildBorderLine(width, { left: "╭", right: "╮" }, "top", lines[0]!));

    // content lines — wrap with dim │ side rails
    for (let i = 1; i < bottomIdx; i++) {
      result.push(boxRow({ variant: "closed", style: chrome, inner: lines[i]! }));
    }

    // bottom border
    result.push(
      this.buildBorderLine(width, { left: "╰", right: "╯" }, "bottom", lines[bottomIdx]!),
    );

    // autocomplete lines (if any) — pass through, offset to align with inner content
    for (let i = bottomIdx + 1; i < lines.length; i++) {
      result.push(" " + lines[i] + " ");
    }

    return result;
  }

  override handleMouse(event: TuiMouseEvent) {
    const translated = translateFramedEditorMouseEvent(event);
    return translated ? super.handleMouse(translated) : undefined;
  }
}

export function formatTokens(n: number) {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }

  return String(n);
}

/**
 * estimate context tokens from session entries using chars/4 heuristic.
 * fallback when provider hasn't reported usage yet (e.g., after compaction).
 */
export function estimateContextFromEntries(entries: SessionEntry[]) {
  let total = 0;

  for (const entry of entries) {
    switch (entry.type) {
      case "message":
        total += estimateTokens(entry.message as any);
        break;

      case "custom_message": {
        const content = entry.content;
        const text =
          typeof content === "string"
            ? content
            : content
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.text)
                .join("");
        total += Math.ceil(text.length / 4);
        break;
      }

      case "branch_summary":
        // branch summaries have a `summary` field
        if (entry.summary) {
          total += Math.ceil(entry.summary.length / 4);
        }
        break;

      case "compaction":
        // compaction entries also have a `summary` field
        if (entry.summary) {
          total += Math.ceil(entry.summary.length / 4);
        }
        break;
    }
  }

  return total;
}

export function updateStatsLabels(
  editor: LabeledEditor | null,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
) {
  if (!editor) {
    return;
  }

  const branch = ctx.sessionManager.getBranch();

  // top-left: context usage
  const usage = ctx.getContextUsage();
  const model = ctx.model;

  // use provider-reported usage if available and meaningful, otherwise estimate from entries
  if (usage?.percent != null && usage.tokens != null && usage.tokens > 0) {
    editor.setLabel(
      "stats",
      `${Math.round(usage.percent)}% of ${formatTokens(usage.contextWindow)}`,
      "top",
      "left",
    );
  } else if (model?.contextWindow) {
    // fallback: estimate tokens from session entries
    const estimatedTokens = estimateContextFromEntries(branch);
    const percent = (estimatedTokens / model.contextWindow) * 100;
    editor.setLabel(
      "stats",
      `~${Math.round(percent)}% of ${formatTokens(model.contextWindow)}`,
      "top",
      "left",
    );
  }

  // top-right: model and effort, the settings that can change during a session
  const thinkingLevel = pi.getThinkingLevel();
  const parts = [model?.id, thinkingLevel !== "off" ? thinkingLevel : undefined].filter(Boolean);
  if (parts.length > 0) {
    editor.setLabel("model", parts.join(SEPARATOR), "top", "right");
  } else {
    editor.removeLabel("model");
  }
}

export default function editorExtension(pi: ExtensionAPI) {
  let editor: LabeledEditor | null = null;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    // The border carries the durable state; transient activity adds noise and
    // reserves a row even when there is nothing useful to show.
    ctx.ui.setWorkingVisible(false);

    // replace editor with labeled box-drawing version
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      editor = new LabeledEditor(tui, editorTheme, keybindings, ctx.ui.theme);
      return editor;
    });

    // replace footer with empty component — the borders carry what's worth showing
    ctx.ui.setFooter(() => ({
      dispose: () => {},
      invalidate: () => {},
      render: () => [],
    }));

    updateStatsLabels(editor!, pi, ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });

  // Provider usage becomes authoritative at message_end. Refresh there rather
  // than waiting for the whole tool/assistant loop to settle at agent_end.
  pi.on("message_end", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });

  pi.events.on("editor:set-label", (data) => {
    const payload = data as SetLabelPayload;
    if (!payload.key || !payload.text) {
      return;
    }

    editor?.setLabel(
      payload.key,
      payload.text,
      payload.position ?? "top",
      payload.align ?? "left",
    );
  });

  pi.events.on("editor:remove-label", (data) => {
    const payload = data as RemoveLabelPayload;
    if (!payload.key) {
      return;
    }

    editor?.removeLabel(payload.key);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    updateStatsLabels(editor, pi, ctx);
  });
}
