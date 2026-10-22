/**
 * shared config reader for pi extensions.
 *
 * reads per-extension configuration from pi's settings.json files,
 * keyed by extension namespace (e.g. `"@bds_pi/librarian"`).
 *
 * merge order: defaults → global (setGlobalSettingsPath() |
 * PI_BDS_CONFIG_PATH | ~/.pi/agent/bds-pi.json) → mutable global overrides
 * (~/.pi/agent/bds-pi.local.json) → project-local (.pi/settings.json).
 * project-local is opt-in via `allowProjectConfig` to prevent malicious repo
 * overrides.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

let _globalSettingsPath: string | null = null;

export function setGlobalSettingsPath(p: string) {
  _globalSettingsPath = p;
}

const _cache = new Map<string, unknown>();

export function clearConfigCache() {
  _cache.clear();
}

export function resolveGlobalSettingsPath() {
  return (
    _globalSettingsPath ??
    process.env.PI_BDS_CONFIG_PATH ??
    path.join(os.homedir(), ".pi", "agent", "bds-pi.json")
  );
}

export function resolveGlobalOverridesPath() {
  if (process.env.PI_BDS_CONFIG_OVERRIDES_PATH) {
    return process.env.PI_BDS_CONFIG_OVERRIDES_PATH;
  }

  const globalPath = resolveGlobalSettingsPath();
  const extension = path.extname(globalPath);

  return extension
    ? `${globalPath.slice(0, -extension.length)}.local${extension}`
    : `${globalPath}.local`;
}

function readJsonFile(filePath: string) {
  if (_cache.has(filePath)) {
    return _cache.get(filePath) as Record<string, unknown> | null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    _cache.set(filePath, parsed);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[@bds_pi/config] failed to read ${filePath}:`, err);
    }

    _cache.set(filePath, null);
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Record<string, unknown>) {
  const result = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const baseVal = result[key];
    const overVal = override[key];

    if (isPlainObject(baseVal) && isPlainObject(overVal)) {
      result[key] = deepMerge(baseVal, overVal);
    } else {
      result[key] = overVal;
    }
  }

  return result as T;
}

export interface GetExtensionConfigOpts {
  cwd?: string;
  allowProjectConfig?: boolean;
}

export interface ExtensionConfigSchema<T extends Record<string, unknown>> {
  /**
   * validates merged config before it is returned.
   * `getEnabledExtensionConfig()` strips the reserved `enabled` flag first.
   * return false to fall back to defaults.
   */
  validate?: (value: Record<string, unknown>) => value is T;
  /** normalize a validated config before it is returned. */
  normalize?: (value: T) => T;
}

export interface GetExtensionConfigWithSchemaOpts<
  T extends Record<string, unknown>,
> extends GetExtensionConfigOpts {
  schema?: ExtensionConfigSchema<T>;
}

export interface EnabledExtensionConfig<T extends Record<string, unknown>> {
  enabled: boolean;
  config: T;
}

type RawExtensionConfig = Record<string, unknown> & {
  enabled?: unknown;
};

function stripEnabledFlag(value: Record<string, unknown>) {
  const { enabled: _enabled, ...rest } = value as RawExtensionConfig;
  return rest;
}

function applyExtensionSchema<T extends Record<string, unknown>>(
  namespace: string,
  candidate: Record<string, unknown>,
  defaults: T,
  schema?: ExtensionConfigSchema<T>,
) {
  if (schema?.validate && !schema.validate(candidate)) {
    console.error(
      `[@bds_pi/config] invalid config for ${namespace}; falling back to defaults.`,
    );

    return schema.normalize ? schema.normalize(defaults) : defaults;
  }

  const config = candidate as T;
  return schema?.normalize ? schema.normalize(config) : config;
}

export function getExtensionConfig<T extends Record<string, unknown>>(
  namespace: string,
  defaults: T,
  opts?: GetExtensionConfigOpts,
) {
  let merged = { ...defaults };

  const globalPath = resolveGlobalSettingsPath();
  const globalSettings = readJsonFile(globalPath);
  if (globalSettings && isPlainObject(globalSettings[namespace])) {
    merged = deepMerge(merged, globalSettings[namespace]);
  }

  const globalOverrides = readJsonFile(resolveGlobalOverridesPath());
  if (globalOverrides && isPlainObject(globalOverrides[namespace])) {
    merged = deepMerge(merged, globalOverrides[namespace]);
  }

  if (opts?.allowProjectConfig && opts.cwd) {
    const projectPath = path.join(opts.cwd, ".pi", "settings.json");
    const projectSettings = readJsonFile(projectPath);
    if (projectSettings && isPlainObject(projectSettings[namespace])) {
      merged = deepMerge(merged, projectSettings[namespace]);
    }
  }

  return merged;
}

export function getExtensionConfigWithSchema<T extends Record<string, unknown>>(
  namespace: string,
  defaults: T,
  opts?: GetExtensionConfigWithSchemaOpts<T>,
) {
  const merged = getExtensionConfig(namespace, defaults, opts);
  return applyExtensionSchema(namespace, merged, defaults, opts?.schema);
}

export function getEnabledExtensionConfig<T extends Record<string, unknown>>(
  namespace: string,
  defaults: T,
  opts?: GetExtensionConfigWithSchemaOpts<T>,
) {
  const merged = getExtensionConfig(namespace, defaults, opts) as RawExtensionConfig;
  const enabled = typeof merged.enabled === "boolean" ? merged.enabled : true;
  const config = applyExtensionSchema(
    namespace,
    stripEnabledFlag(merged),
    defaults,
    opts?.schema,
  );

  return { enabled, config } satisfies EnabledExtensionConfig<T>;
}

/**
 * persist a namespaced mutable override without replacing sibling config.
 *
 * the base config may be declarative or symlinked into the nix store. commands
 * therefore write a sibling local override instead of replacing that source.
 */
export function updateGlobalExtensionConfig(
  namespace: string,
  patch: Record<string, unknown>,
) {
  const filePath = resolveGlobalOverridesPath();
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isPlainObject(parsed))
      throw new Error(`global extension config must be a json object: ${filePath}`);
    settings = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const current = isPlainObject(settings[namespace])
    ? (settings[namespace] as Record<string, unknown>)
    : {};
  const next = {
    ...settings,
    [namespace]: deepMerge(current, patch),
  };

  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    const directoryDescriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch {}
    throw error;
  }

  _cache.set(filePath, next);
}

/** read a top-level (non-namespaced) key from the global settings file. */
export function getGlobalConfig<T>(key: string) {
  const globalPath = resolveGlobalSettingsPath();
  const settings = readJsonFile(globalPath);
  if (!settings || !(key in settings)) {
    return undefined;
  }

  return settings[key] as T;
}

/** directory containing the global settings file (e.g. ~/.pi/agent/). */
export function resolveConfigDir() {
  return path.dirname(resolveGlobalSettingsPath());
}
