import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TObject, type TSchema, type TUnion } from "typebox";

function closeObjectSchemas<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached) return cached as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) clone.push(closeObjectSchemas(item, seen));
    return clone as T;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<
    PropertyKey,
    unknown
  >;
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ("value" in descriptor) {
      descriptor.value = closeObjectSchemas(descriptor.value, seen);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  if (clone.type === "object") {
    if (clone.additionalProperties === undefined) {
      clone.additionalProperties = false;
    }
    const properties = clone.properties as Record<string, TSchema> | undefined;
    if (properties) {
      const originallyRequired = new Set(
        Array.isArray(clone.required) ? clone.required : [],
      );
      for (const [key, schema] of Object.entries(properties)) {
        if (!originallyRequired.has(key)) {
          properties[key] = Type.Union([schema, Type.Null()]);
        }
      }
      clone.required = Object.keys(properties);
    }
  }
  return clone as T;
}

function schemaAllowsNull(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return false;
  const value = schema as Record<string, unknown>;
  if (value.const === null) return true;
  if (Array.isArray(value.enum) && value.enum.includes(null)) return true;
  if (value.type === "null") return true;
  if (Array.isArray(value.type) && value.type.includes("null")) return true;
  return [value.anyOf, value.oneOf].some(
    (variants) =>
      Array.isArray(variants) && variants.some((item) => schemaAllowsNull(item)),
  );
}

function restoreOptionalArguments<T>(value: T, schema: unknown): T {
  if (value === null || typeof value !== "object") return value;
  const shape =
    schema !== null && typeof schema === "object"
      ? (schema as Record<string, unknown>)
      : undefined;

  if (Array.isArray(value)) {
    return value.map((item) => restoreOptionalArguments(item, shape?.items)) as T;
  }

  const properties = shape?.properties as Record<string, unknown> | undefined;
  const required = new Set(
    Array.isArray(shape?.required) ? (shape.required as string[]) : [],
  );
  const restored: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const propertySchema = properties?.[key];
    const syntheticNull =
      child === null &&
      propertySchema !== undefined &&
      !required.has(key) &&
      !schemaAllowsNull(propertySchema);
    if (!syntheticNull) {
      restored[key] = restoreOptionalArguments(child, propertySchema);
    }
  }
  return restored as T;
}

/**
 * derives promptSnippet and promptGuidelines from a tool's description
 * so tools don't need to define them manually. snippet = first paragraph,
 * guidelines = lines starting with "- ".
 */
export function withPromptPatch(tool: ToolDefinition): ToolDefinition {
  const snippet = (tool.description?.split("\n\n")[0] ?? "").trim();
  const guidelines = (tool.description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const patched: ToolDefinition = { ...tool };
  if (!patched.promptSnippet) patched.promptSnippet = snippet;
  if (!patched.promptGuidelines && guidelines.length > 0) {
    patched.promptGuidelines = guidelines;
  }
  if (patched.constrainedSampling === undefined) {
    const originalParameters = patched.parameters;
    patched.parameters = closeObjectSchemas(originalParameters);
    const execute = patched.execute.bind(patched);
    patched.execute = (toolCallId, params, signal, onUpdate, ctx) =>
      execute(
        toolCallId,
        restoreOptionalArguments(params, originalParameters),
        signal,
        onUpdate,
        ctx,
      );
    patched.constrainedSampling = {
      type: "json_schema",
      strict: "prefer",
    };
  }

  return patched;
}
