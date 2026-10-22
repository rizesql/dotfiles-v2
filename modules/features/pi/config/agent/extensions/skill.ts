/**
 * skill tool — load a skill by name, returning its content for
 * injection into the conversation context.
 *
 * uses pi's native skill discovery (loadSkills) + frontmatter parsing
 * instead of custom implementations.
 *
 * the model calls `skill(name: "git")` instead of reading SKILL.md
 * paths manually. files in the skill directory are listed in
 * <skill_files> for the model to read if needed.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  parseFrontmatter,
  loadSkills,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

import type { Excerpt } from "#core/show.ts";
import {
  boxRendererWindowed,
  framedTextRenderer,
  renderLifecycleCall,
  textSection,
} from "#core/box-format.ts";
import { withPromptPatch } from "#core/prompt-patch.ts";

const COLLAPSED_EXCERPTS: Excerpt[] = [
  { focus: "head" as const, context: 3 },
  { focus: "tail" as const, context: 5 },
];

// --- skill discovery via pi ---

/**
 * get custom skill paths from settings.json and standard agent locations.
 */
function getSkillPaths(cwd?: string): string[] {
  const dirs: string[] = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(getAgentDir(), "skills"),
  ];

  if (cwd) {
    let dir = path.resolve(cwd);
    while (true) {
      dirs.push(path.join(dir, ".agents", "skills"));
      if (fs.existsSync(path.join(dir, ".git"))) {
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  const settingsPath = path.join(getAgentDir(), "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (Array.isArray(settings.skills)) {
        for (const p of settings.skills) {
          if (p === "~") {
            dirs.push(os.homedir());
          } else if (typeof p === "string" && p.startsWith("~/")) {
            dirs.push(path.join(os.homedir(), p.slice(2)));
          } else if (typeof p === "string") {
            dirs.push(p);
          }
        }
      }
    } catch {
      /* unreadable */
    }
  }

  return dirs.filter((d) => fs.existsSync(d));
}

/**
 * find a skill by name using pi's native skill discovery.
 * returns the pi Skill object with name, filePath, baseDir, etc.
 */
function findSkill(name: string, cwd: string) {
  const { skills } = loadSkills({
    cwd,
    agentDir: getAgentDir(),
    skillPaths: getSkillPaths(cwd),
    includeDefaults: true,
  });

  return skills.find((s) => s.name === name) ?? null;
}

/**
 * list all known skill names for error messages.
 */
function listAvailableSkills(cwd: string) {
  const { skills } = loadSkills({
    cwd,
    agentDir: getAgentDir(),
    skillPaths: getSkillPaths(cwd),
    includeDefaults: true,
  });

  return skills.map((s) => s.name).sort();
}

/**
 * collect file paths in the skill directory (excluding SKILL.md),
 * walking subdirectories. used for the <skill_files> block so the
 * model knows what reference files are available.
 */
function collectSkillFiles(baseDir: string) {
  const files: string[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.name === "node_modules") {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name !== "SKILL.md") {
        files.push(full);
      }
    }
  }

  walk(baseDir);
  return files;
}

export { getSkillPaths, findSkill, listAvailableSkills, collectSkillFiles };

export default function skillExtension(pi: ExtensionAPI) {
  pi.registerTool(
    withPromptPatch({
      name: "skill",
      label: "Load Skill",
      description:
        "Load a specialized skill that provides domain-specific instructions and workflows.\n\n" +
        "When you recognize that a task matches one of the available skills, use this tool " +
        "to load the full skill instructions.\n\n" +
        "The skill will inject detailed instructions, workflows, and access to bundled " +
        "resources (scripts, references, templates) into the conversation context.",

      parameters: Type.Object({
        name: Type.String({
          description:
            "The name of the skill to load (must match one of the available skills).",
        }),
        arguments: Type.Optional(
          Type.String({
            description: "Optional arguments to pass to the skill.",
          }),
        ),
      }),

      renderCall: (args, theme, context) => {
        const name = args.name || "...";
        return renderLifecycleCall(
          new Text(
            theme.fg("dim", "using ") +
              theme.fg("toolTitle", theme.bold(name)) +
              theme.fg("dim", " skill"),
            0,
            0,
          ),
          theme,
          context,
        );
      },

      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const skill = findSkill(params.name, ctx.cwd);
        if (!skill) {
          const available = listAvailableSkills(ctx.cwd);
          const list =
            available.length > 0 ? `\n\navailable skills: ${available.join(", ")}` : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `skill "${params.name}" not found.${list}`,
              },
            ],
            isError: true,
            details: { header: "skill not found" },
          };
        }

        let rawContent: string;
        try {
          rawContent = fs.readFileSync(skill.filePath, "utf-8");
        } catch (err: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `failed to read skill file: ${err.message}`,
              },
            ],
            isError: true,
            details: { header: "failed to read skill file" },
          };
        }

        const { body } = parseFrontmatter(rawContent);

        // build output in <loaded_skill> format
        const parts = [
          `<loaded_skill name="${skill.name}">`,
          body,
          "",
          `Base directory for this skill: file://${skill.baseDir}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
        ];

        if (params.arguments) {
          parts.push("", `User request with this skill: ${params.arguments}`);
        }

        const skillFiles = collectSkillFiles(skill.baseDir);
        if (skillFiles.length > 0) {
          parts.push("");
          parts.push("<skill_files>");
          for (const f of skillFiles) {
            parts.push(`<file>${f}</file>`);
          }
          parts.push("</skill_files>");
        }

        parts.push("</loaded_skill>");

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
          details: { header: skill.name },
        };
      },

      renderResult: (result, { expanded }, _theme) => {
        const content = result.content?.[0];
        if (!content || content.type !== "text") {
          return framedTextRenderer("(no output)", expanded);
        }

        if (content.text.startsWith("<loaded_skill")) {
          return boxRendererWindowed(
            () => [textSection(undefined, "skill loaded", true)],
            { collapsed: {}, expanded: {} },
            undefined,
            expanded,
          );
        }

        return boxRendererWindowed(
          () => [textSection(undefined, content.text)],
          {
            collapsed: { excerpts: COLLAPSED_EXCERPTS },
            expanded: {},
          },
          undefined,
          expanded,
        );
      },
    }),
  );
}
