/**
 * Applies tool-policy.json to pi's built-in edit and write tools.
 *
 * bash.ts and read.ts replace pi's built-ins and check the policy themselves. edit and
 * write stay built-in, so without this hook a `path` rule (e.g. the secrets rule) never
 * sees them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveToAbsolute } from "#core/fs.ts";
import * as toolPolicy from "#core/tool-policy.ts";

export default function editPolicy(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const target = (event.input as { path?: unknown }).path;
    if (typeof target !== "string") return;

    const verdict = toolPolicy.evaluateToolPolicy(
      event.toolName,
      { path: resolveToAbsolute(target, ctx.cwd), sessionCwd: ctx.cwd },
      toolPolicy.loadToolPolicy(),
    );
    if (verdict.action === "reject") {
      return {
        block: true,
        reason: verdict.message
          ? `path rejected: ${verdict.message}`
          : "path rejected by tool policy.",
      };
    }
  });
}
