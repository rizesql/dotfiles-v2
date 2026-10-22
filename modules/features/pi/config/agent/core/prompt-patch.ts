import type { TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * derives promptSnippet and promptGuidelines from a tool's description
 * so tools don't need to define them manually. snippet = first paragraph,
 * guidelines = lines starting with "- ".
 */
export function withPromptPatch<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
  TState = any,
>(tool: ToolDefinition<TParams, TDetails, TState>) {
  const snippet = (tool.description?.split("\n\n")[0] ?? "").trim();
  const guidelines = (tool.description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const patched = { ...tool };
  if (!patched.promptSnippet) patched.promptSnippet = snippet;
  if (!patched.promptGuidelines && guidelines.length > 0) {
    patched.promptGuidelines = guidelines;
  }
  if (patched.constrainedSampling === undefined) {
    // pi-ai owns strict wire-schema conversion and optional-null normalization.
    // rewriting parameters here makes optional fields required before execute.
    patched.constrainedSampling = {
      type: "json_schema",
      strict: "prefer",
    };
  }

  return patched;
}
