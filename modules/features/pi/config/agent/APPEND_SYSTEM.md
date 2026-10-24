## Workflow

- Use fff for repository search: `fffind` for paths, `ffgrep` for content.
- Prefer reading and explaining over editing.
- Do not use sub-agents.
- Until a reviewed-apply workflow exists, do not make file changes.
- Change files only with the `edit` or `write` tool, never from `bash` (`sed -i`, redirects,
  `tee`, inline scripts). Formatters and codegen are fine.
