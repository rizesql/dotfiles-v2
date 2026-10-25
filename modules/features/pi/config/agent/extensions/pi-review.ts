/**
 * records what each file looked like before pi first touched it, so nvim can show
 * pi's edits as reviewable hunks.
 *
 * before every `edit` / `write`, the file's current content goes into a private git
 * index at `<git dir>/pi-review/index`, unless it already has a baseline there. the
 * real staging area is never touched. files pi creates get an empty baseline and are
 * listed in `<git dir>/pi-review/created`, so rejecting all of one deletes it.
 * `<git dir>/pi-review/last-run` is rewritten at `agent_end`; nvim watches the
 * directory and refreshes (modules/features/nvim/nvim/lua/pi_review.lua).
 *
 * fails open: if anything here throws, the edit still runs, just without a baseline.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveToAbsolute } from "#core/fs.ts";

interface Repo {
  toplevel: string;
  reviewDir: string;
}

function git(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return execFileSync("git", args, {
    cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

/** the file's repo and its path inside it, or undefined outside a git repo. */
function locate(file: string): { repo: Repo; rel: string } | undefined {
  // `write` can create directories, so start from the closest one that exists.
  let dir = path.dirname(file);
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }

  let toplevel: string;
  let gitDir: string;
  try {
    toplevel = git(dir, ["rev-parse", "--show-toplevel"]);
    gitDir = git(dir, ["rev-parse", "--absolute-git-dir"]);
  } catch {
    return undefined;
  }

  // git reports resolved paths; resolve ours too so symlinked checkouts line up.
  const real = path.join(fs.realpathSync(dir), path.relative(dir, file));
  const rel = path.relative(toplevel, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return { repo: { toplevel, reviewDir: path.join(gitDir, "pi-review") }, rel };
}

/** store the file's current content as its baseline, unless it already has one. */
function recordBaseline(file: string) {
  const found = locate(file);
  if (!found) return undefined;
  const { repo, rel } = found;

  fs.mkdirSync(repo.reviewDir, { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: path.join(repo.reviewDir, "index") };
  if (git(repo.toplevel, ["ls-files", "--", rel], { env }) !== "") return repo;

  let sha: string;
  if (fs.existsSync(file)) {
    sha = git(repo.toplevel, ["hash-object", "-w", "--no-filters", "--", file]);
  } else {
    sha = git(repo.toplevel, ["hash-object", "-w", "--stdin"], { input: "" });
    fs.appendFileSync(path.join(repo.reviewDir, "created"), rel + "\n");
  }
  git(repo.toplevel, ["update-index", "--add", "--cacheinfo", `100644,${sha},${rel}`], { env });
  return repo;
}

export default function piReview(pi: ExtensionAPI) {
  // review dirs touched since the last agent_end
  const touched = new Set<string>();

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    try {
      const target = (event.input as { path?: unknown }).path;
      if (typeof target !== "string") return;
      const repo = recordBaseline(resolveToAbsolute(target, ctx.cwd));
      if (repo) touched.add(repo.reviewDir);
    } catch (err) {
      ctx.ui.notify(`pi-review: no baseline recorded: ${String(err)}`, "warning");
    }
  });

  pi.on("agent_end", (_event, ctx) => {
    for (const dir of touched) {
      // the repo can be gone by now, e.g. a scratch repo deleted later in the same run
      if (!fs.existsSync(dir)) continue;
      try {
        fs.writeFileSync(path.join(dir, "last-run"), `${Date.now()}\n`);
      } catch (err) {
        ctx.ui.notify(`pi-review: ${String(err)}`, "warning");
      }
    }
    touched.clear();
  });
}

