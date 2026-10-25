## Workflow

- Use fff for repository search: `fffind` for paths, `ffgrep` for content.
- Prefer reading and explaining over editing.
- Do not use sub-agents.
- Your edits are reviewed hunk by hunk in nvim, which only sees changes made with `edit`
  or `write`. Change files only with those tools, never from `bash` (`sed -i`, redirects,
  `tee`, inline scripts). Formatters and codegen are fine.

## Writing

Applies to replies, comments, docs and commit messages. For a full editing pass over
prose, load the unslop skill.

- Name the mechanism or the number, not the feeling. Cut a sentence that could appear
  unchanged in another project's docs.
- Plain words: "use" not "leverage"/"utilize", "is"/"has" not "serves as"/"boasts". No
  delve, crucial, pivotal, robust, seamless, landscape, testament, underscore.
- No em dashes. Use a period or a comma.
- Active voice: name who does it. Cut adverbs that prop up a weak verb.
- One idea per sentence. Split anything the reader has to parse twice.
- No "not just X, but Y", no forced groups of three, no filler ("in order to", "it is
  important to note").
- No openers or closers: no "Great question", "I hope this helps", "Let me know if".
- Hedge once, where the uncertainty is. Don't stack "could potentially".
- Bold only what the reader must not miss. No bold-label-colon lists that restate the
  line. Sentence-case headings, no emoji.
