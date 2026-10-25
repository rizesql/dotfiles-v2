-- Review pi's edits as mini.diff hunks.
--
-- The pi extension (modules/features/pi/config/agent/extensions/pi-review.ts) stores what
-- each file looked like before pi's first edit in a private git index,
-- `<git dir>/pi-review/index`. A file with an entry there is pending review: its buffer
-- diffs against that baseline instead of the git index. `gh` / `<leader>a` accept hunks by
-- writing them into the baseline, `gH` / `<leader>r` reject them by resetting the buffer
-- and saving it. Once a buffer matches its baseline and is saved, the entry goes away and
-- git takes over again.

local M = {}

---@class PiReviewRepo
---@field toplevel string
---@field dir string `<git dir>/pi-review`

---@type table<string, PiReviewRepo|false>
local repo_cache = {}

---@param cwd string
---@param args string[]
---@param opts? { repo?: PiReviewRepo, stdin?: string }
---@return string? stdout nil when git fails
local function git(cwd, args, opts)
  opts = opts or {}
  local env = opts.repo and { GIT_INDEX_FILE = opts.repo.dir .. "/index" } or nil
  local res = vim
    .system({ "git", unpack(args) }, { cwd = cwd, env = env, stdin = opts.stdin, text = true })
    :wait()
  if res.code ~= 0 then
    return nil
  end
  return res.stdout
end

---@param dir string
---@return PiReviewRepo?
local function repo_for_dir(dir)
  if repo_cache[dir] == nil then
    local out = git(dir, { "rev-parse", "--show-toplevel", "--absolute-git-dir" })
    local lines = out and vim.split(vim.trim(out), "\n") or {}
    repo_cache[dir] = #lines == 2
        and { toplevel = lines[1], dir = lines[2] .. "/pi-review" }
      or false
  end
  return repo_cache[dir] or nil
end

--- The file's repo and its path inside it, matching how the extension resolves it.
---@param file string absolute path
---@return PiReviewRepo?, string?
local function locate(file)
  local dir = vim.fs.dirname(file)
  local real_dir = vim.uv.fs_realpath(dir)
  if not real_dir then
    return nil
  end
  local repo = repo_for_dir(real_dir)
  if not repo then
    return nil
  end
  local rel = vim.fs.relpath(repo.toplevel, real_dir .. "/" .. vim.fs.basename(file))
  return repo, rel
end

---@param repo PiReviewRepo
---@return table<string, true>
local function created(repo)
  local set = {}
  for _, line in
    ipairs(
      vim.fn.filereadable(repo.dir .. "/created") == 1
          and vim.fn.readfile(repo.dir .. "/created")
        or {}
    )
  do
    set[line] = true
  end
  return set
end

---@param repo PiReviewRepo
---@return table<string, string> rel -> blob sha of the baseline
local function entries(repo)
  local out = git(repo.toplevel, { "ls-files", "-s" }, { repo = repo }) or ""
  local res = {}
  for mode_sha, rel in out:gmatch("(%S+ %S+) %S+\t([^\n]+)") do
    res[rel] = vim.split(mode_sha, " ")[2]
  end
  return res
end

--- Stop reviewing a file: its next diff is against git again.
---@param repo PiReviewRepo
---@param rel string
local function forget(repo, rel)
  git(repo.toplevel, { "update-index", "--force-remove", "--", rel }, { repo = repo })
  local set = created(repo)
  if set[rel] then
    set[rel] = nil
    vim.fn.writefile(vim.tbl_keys(set), repo.dir .. "/created")
  end
end

---@param buf integer
local function reattach(buf)
  MiniDiff.disable(buf)
  MiniDiff.enable(buf)
end

---@param ref string[]
---@param hunks table[] MiniDiff-hunk-specification
---@param buf_lines string[]
---@return string[] ref with the hunks' buffer lines applied
local function apply(ref, hunks, buf_lines)
  local sorted = vim.deepcopy(hunks)
  table.sort(sorted, function(a, b)
    return a.ref_start > b.ref_start
  end)
  local res = vim.deepcopy(ref)
  for _, h in ipairs(sorted) do
    local new = vim.list_slice(buf_lines, h.buf_start, h.buf_start + h.buf_count - 1)
    -- An "add" hunk has no reference lines and goes after ref_start.
    local at = h.ref_count == 0 and h.ref_start + 1 or h.ref_start
    for _ = 1, h.ref_count do
      table.remove(res, at)
    end
    for i, line in ipairs(new) do
      table.insert(res, at + i - 1, line)
    end
  end
  return res
end

--- Where a hunk is drawn. A deletion has no lines of its own: it sits above the line
--- after it, or below the last line.
---@param h table MiniDiff-hunk-specification
---@param n_lines integer
---@return integer row 0-based
---@return boolean above
local function anchor(h, n_lines)
  if h.buf_count > 0 then
    return h.buf_start - 1, true
  elseif h.buf_start < n_lines then
    return h.buf_start, true
  end
  return n_lines - 1, false
end

---@class PiReviewGroup
---@field line integer first buffer line, where the header is drawn
---@field last integer
---@field above boolean
---@field hunks table[]

--- Hunks drawn on the same line, which share a header and are accepted or rejected
--- together. A deletion sits on the line after it, and the next hunk can start there:
--- linematch turns `b, c` -> `B` into "delete b" plus "change c". Handled one at a
--- time, accepting the first leaves the other looking like nothing happened.
---@param n_lines integer
---@param hunks table[] in buffer order
---@return PiReviewGroup[] sorted by line
local function groups(n_lines, hunks)
  local res, by_line = {}, {}
  for _, h in ipairs(hunks) do
    local row, above = anchor(h, n_lines)
    local line = row + 1
    local last = h.buf_count > 0 and h.buf_start + h.buf_count - 1 or line
    local g = by_line[line]
    if not g then
      g = { line = line, last = last, above = true, hunks = {} }
      by_line[line] = g
      table.insert(res, g)
    end
    g.last = math.max(g.last, last)
    g.above = g.above and above
    table.insert(g.hunks, h)
  end
  table.sort(res, function(a, b)
    return a.line < b.line
  end)
  return res
end

--- mini.diff source. Attaches only to files with a pi baseline; otherwise returns false
--- so the next source (git) takes the buffer.
M.source = {
  name = "pi",

  attach = function(buf)
    local ok, attached = pcall(function()
      local file = vim.api.nvim_buf_get_name(buf)
      if file == "" or vim.bo[buf].buftype ~= "" then
        return false
      end
      local repo, rel = locate(file)
      local sha = repo and rel and entries(repo)[rel]
      if not sha then
        return false
      end
      M.watch(repo)
      local text = git(repo.toplevel, { "cat-file", "blob", sha }) or ""
      vim.b[buf].pi_review = { toplevel = repo.toplevel, dir = repo.dir, rel = rel }
      -- Not from inside attach: set_ref_text enables the buffer itself.
      vim.schedule(function()
        if vim.b[buf].pi_review then
          MiniDiff.set_ref_text(buf, text)
        end
      end)
      return true
    end)
    return ok and attached or false
  end,

  -- Clear the decorations here: when git takes over a file it doesn't track, mini.diff
  -- sets no reference text and never fires MiniDiffUpdated, so decorate wouldn't run.
  detach = function(buf)
    if vim.api.nvim_buf_is_valid(buf) then
      vim.b[buf].pi_review = nil
      M.decorate(buf)
    end
  end,

  -- Accept: the hunks become part of the baseline.
  apply_hunks = function(buf, hunks)
    local state = vim.b[buf].pi_review
    local data = MiniDiff.get_buf_data(buf)
    if not (state and data and data.ref_text) then
      return
    end
    local repo = { toplevel = state.toplevel, dir = state.dir }
    local ref = vim.split(data.ref_text, "\n")
    if ref[#ref] == "" then
      table.remove(ref)
    end
    local buf_lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local new_ref = apply(ref, hunks, buf_lines)

    local sha = vim.trim(
      git(
        repo.toplevel,
        { "hash-object", "-w", "--stdin" },
        { stdin = table.concat(new_ref, "\n") .. "\n" }
      ) or ""
    )
    if sha == "" then
      vim.notify("pi review: could not store accepted hunks", vim.log.levels.ERROR)
      return
    end
    git(
      repo.toplevel,
      { "update-index", "--add", "--cacheinfo", "100644," .. sha .. "," .. state.rel },
      { repo = repo }
    )
    -- Everything accepted and already on disk: the review of this file is done.
    if not vim.bo[buf].modified and vim.deep_equal(new_ref, buf_lines) then
      forget(repo, state.rel)
      vim.schedule(function()
        reattach(buf)
      end)
      return
    end
    MiniDiff.set_ref_text(buf, new_ref)
  end,
}

--- Files pending review in a repo, dropping entries whose file matches its baseline.
---@param repo PiReviewRepo
---@return { file: string, rel: string, sha: string, created: boolean }[]
function M.pending(repo)
  local res = {}
  local new = created(repo)
  for rel, sha in pairs(entries(repo)) do
    local file = repo.toplevel .. "/" .. rel
    local exists = vim.uv.fs_stat(file) ~= nil
    local current = exists
      and vim.trim(git(repo.toplevel, { "hash-object", "--no-filters", "--", rel }) or "")
    if not exists or current == sha then
      forget(repo, rel)
    else
      table.insert(res, { file = file, rel = rel, sha = sha, created = new[rel] == true })
    end
  end
  table.sort(res, function(a, b)
    return a.rel < b.rel
  end)
  return res
end

---@return PiReviewRepo?
local function cwd_repo()
  return repo_for_dir(vim.uv.fs_realpath(vim.fn.getcwd()) or vim.fn.getcwd())
end

local QF_TITLE = "pi review"

--- A pending file's hunks, diffed and grouped the way its buffer shows them, so the list
--- and the picker count and place hunks like the in-buffer headers do.
---@param repo PiReviewRepo
---@param p { file: string, sha: string }
---@return PiReviewGroup[], string[] ref, string[] now
local function file_groups(repo, p)
  local base = git(repo.toplevel, { "cat-file", "blob", p.sha }) or ""
  local now = vim.fn.readfile(p.file)
  local opts = MiniDiff.config.options
  local diff = vim.text.diff(base, table.concat(now, "\n") .. "\n", {
    result_type = "indices",
    ctxlen = 0,
    interhunkctxlen = 0,
    algorithm = opts.algorithm,
    indent_heuristic = opts.indent_heuristic,
    linematch = opts.linematch,
  }) --[[@as integer[][] ]]
  local hunks = vim.tbl_map(function(d)
    return { ref_start = d[1], ref_count = d[2], buf_start = d[3], buf_count = d[4] }
  end, diff)
  return groups(#now, hunks), vim.split(base, "\n"), now
end

--- A group as diff lines with a little context, in the order the buffer shows them.
---@param g PiReviewGroup
---@param ref string[]
---@param now string[]
local function group_diff(g, ref, now)
  local out = {}
  local function context(from, to)
    for l = math.max(from, 1), math.min(to, #now) do
      table.insert(out, " " .. now[l])
    end
  end
  -- A trailing deletion is drawn below the last line, so that line is context above it.
  if g.above then
    context(g.line - 3, g.line - 1)
  else
    context(g.line - 2, g.line)
  end
  local changed_last = g.line - 1
  for _, h in ipairs(g.hunks) do
    for l = h.ref_start, h.ref_start + h.ref_count - 1 do
      table.insert(out, "-" .. (ref[l] or ""))
    end
    for l = h.buf_start, h.buf_start + h.buf_count - 1 do
      table.insert(out, "+" .. now[l])
    end
    if h.buf_count > 0 then
      changed_last = math.max(changed_last, h.buf_start + h.buf_count - 1)
    end
  end
  if g.above then
    context(changed_last + 1, changed_last + 3)
  end
  return table.concat(out, "\n")
end

--- Pending files as quickfix items, each pointing at its first change.
---@param repo PiReviewRepo
local function qf_items(repo)
  local items = {}
  for _, p in ipairs(M.pending(repo)) do
    local all = file_groups(repo, p)
    local first = all[1] and math.max(all[1].line, 1) or 1
    local text = ("%d hunk%s"):format(#all, #all == 1 and "" or "s")
      .. (p.created and ", new file" or "")
    table.insert(items, { filename = p.file, lnum = first, text = text })
  end
  return items
end

--- Open the files pending review in the quickfix list.
function M.list()
  local repo = cwd_repo()
  if not repo then
    vim.notify("pi review: not in a git repo", vim.log.levels.WARN)
    return
  end
  local items = qf_items(repo)
  vim.fn.setqflist({}, " ", { title = QF_TITLE, items = items })
  if #items == 0 then
    vim.notify("pi review: nothing pending")
    return
  end
  vim.cmd.copen()
end

--- Pending hunks across the repo in a picker, each previewed as a diff against its baseline.
function M.pick()
  local repo = cwd_repo()
  if not repo then
    vim.notify("pi review: not in a git repo", vim.log.levels.WARN)
    return
  end
  local items = {}
  for _, p in ipairs(M.pending(repo)) do
    local all, ref, now = file_groups(repo, p)
    for i, g in ipairs(all) do
      table.insert(items, {
        file = p.file,
        text = ("%s %d/%d%s"):format(p.rel, i, #all, p.created and " new" or ""),
        pos = { math.max(g.line, 1), 0 },
        preview = { text = group_diff(g, ref, now), ft = "diff", loc = false },
      })
    end
  end
  if #items == 0 then
    vim.notify("pi review: nothing pending")
    return
  end
  Snacks.picker({
    source = "pi_review",
    title = "pi review",
    items = items,
    format = "file",
    preview = "preview",
  })
end

--- Reload files pi changed, switch buffers between the pi and git sources as their
--- baselines come and go, and refresh the quickfix list if it shows pending files.
---@param opts? { notify?: boolean }
function M.refresh(opts)
  local repo = cwd_repo()
  if not repo then
    return
  end
  vim.cmd("silent! checktime")

  local pending = {}
  for _, p in ipairs(M.pending(repo)) do
    pending[p.file] = true
  end
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    local file = vim.api.nvim_buf_get_name(buf)
    if
      vim.api.nvim_buf_is_loaded(buf)
      and vim.startswith(file, repo.toplevel .. "/")
      and MiniDiff.get_buf_data(buf)
    then
      local reviewing = vim.b[buf].pi_review ~= nil
      if reviewing ~= (pending[file] == true) then
        reattach(buf)
      end
    end
  end

  if vim.fn.getqflist({ title = 0 }).title == QF_TITLE then
    vim.fn.setqflist({}, "r", { title = QF_TITLE, items = qf_items(repo) })
  end
  local count = vim.tbl_count(pending)
  if opts and opts.notify and count > 0 then
    vim.notify(("pi: %d file%s to review"):format(count, count == 1 and "" or "s"))
  end
end

---@type table<string, uv.uv_fs_event_t>
local watchers = {}

--- Refresh when the extension records a baseline or finishes a run.
---@param repo PiReviewRepo
function M.watch(repo)
  if watchers[repo.dir] then
    return
  end
  vim.fn.mkdir(repo.dir, "p")
  local timer = assert(vim.uv.new_timer())
  local notify = false
  local handle = assert(vim.uv.new_fs_event())
  handle:start(repo.dir, {}, function(_, filename)
    notify = notify or filename == "last-run"
    timer:stop()
    timer:start(200, 0, function()
      local n = notify
      notify = false
      vim.schedule(function()
        M.refresh({ notify = n })
      end)
    end)
  end)
  watchers[repo.dir] = handle
end

--- After saving a reviewed buffer: once it matches its baseline, stop reviewing it.
--- A file pi created and you rejected entirely gets deleted.
---@param buf integer
function M.on_write(buf)
  local state = vim.b[buf].pi_review
  local data = MiniDiff.get_buf_data(buf)
  if not (state and data and data.hunks) then
    return
  end
  local repo = { toplevel = state.toplevel, dir = state.dir }
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  if created(repo)[state.rel] and #lines == 1 and lines[1] == "" then
    forget(repo, state.rel)
    vim.fs.rm(vim.api.nvim_buf_get_name(buf))
    vim.api.nvim_buf_delete(buf, { force = true })
    vim.notify("pi review: removed " .. state.rel)
    return
  end
  if #data.hunks == 0 then
    forget(repo, state.rel)
    reattach(buf)
  end
end

-- Decorations: pi's hunks get a background, the lines they replaced show above them, and
-- each hunk has a header naming its keys. Colours are PiReview* in plugin/colorscheme.lua.
local ns = vim.api.nvim_create_namespace("pi-review")

--- The group drawn on or right above `line`.
---@param buf integer
---@param hunks table[]
---@param line integer
---@return PiReviewGroup?
local function group_at(buf, hunks, line)
  for _, g in ipairs(groups(vim.api.nvim_buf_line_count(buf), hunks)) do
    if line >= g.line and line <= g.last then
      return g
    end
  end
end

--- Put the hunks' reference lines back in the buffer. Bottom-up, so the positions of
--- the ones above stay valid.
---@param buf integer
---@param hunks table[]
---@param ref string[]
local function reset_hunks(buf, hunks, ref)
  local sorted = vim.deepcopy(hunks)
  table.sort(sorted, function(a, b)
    if a.buf_start ~= b.buf_start then
      return a.buf_start > b.buf_start
    end
    -- A deletion inserts after buf_start; do it before a change that rewrites that line.
    return a.buf_count == 0 and b.buf_count > 0
  end)
  for _, h in ipairs(sorted) do
    local old = vim.list_slice(ref, h.ref_start, h.ref_start + h.ref_count - 1)
    local from = h.buf_count == 0 and h.buf_start or h.buf_start - 1
    vim.api.nvim_buf_set_lines(buf, from, from + h.buf_count, false, old)
  end
end

--- Virtual line padded to the window width so its background spans the whole line.
---@param chunks [string, string][]
local function full_width(chunks)
  local used = 0
  for _, c in ipairs(chunks) do
    used = used + vim.fn.strdisplaywidth(c[1])
  end
  table.insert(
    chunks,
    { (" "):rep(math.max(vim.o.columns - used, 0)), chunks[#chunks][2] }
  )
  return chunks
end

---@param buf integer
local function is_reviewed(buf)
  local data = MiniDiff.get_buf_data(buf)
  return vim.b[buf].pi_review ~= nil
    and data
    and data.summary
    and data.summary.source_name == "pi",
    data
end

---@param action "apply"|"reset"
---@param scope "hunk"|"file"
local function act(action, scope)
  return function()
    local buf = vim.api.nvim_get_current_buf()
    local reviewed, data = is_reviewed(buf)
    if not reviewed then
      return
    end
    local was_modified = vim.bo[buf].modified
    if scope == "file" or vim.fn.mode():match("^[vV\22]") then
      local first, last = 1, vim.api.nvim_buf_line_count(buf)
      if scope ~= "file" then
        first, last = vim.fn.line("v"), vim.fn.line(".")
        first, last = math.min(first, last), math.max(first, last)
        vim.cmd("normal! \27")
      end
      MiniDiff.do_hunks(buf, action, { line_start = first, line_end = last })
    else
      -- The exact group under the header: mini.diff's line ranges can't tell a deletion
      -- from the change next to it.
      local g = group_at(buf, data.hunks or {}, vim.fn.line("."))
      if not g then
        vim.notify("pi review: no hunk under the cursor")
        return
      elseif action == "apply" then
        M.source.apply_hunks(buf, g.hunks)
      else
        reset_hunks(buf, g.hunks, vim.split(data.ref_text, "\n"))
      end
    end
    -- Rejecting edits the buffer; keep the file in step unless it already had unsaved edits.
    if action == "reset" and not was_modified and vim.api.nvim_buf_is_valid(buf) then
      vim.api.nvim_buf_call(buf, function()
        vim.cmd("silent write")
      end)
    end
  end
end

--- Move to a group's header line, so accept and reject always find the hunks a jump
--- landed on. mini.diff's ]h stops once per run of adjacent hunks and puts a deletion
--- on the line above it.
---@param direction "first"|"prev"|"next"|"last"
local function goto_hunk(direction)
  return function()
    local buf = vim.api.nvim_get_current_buf()
    local reviewed, data = is_reviewed(buf)
    if not (reviewed and data.hunks and #data.hunks > 0) then
      return
    end
    local lines = vim.tbl_map(function(g)
      return g.line
    end, groups(vim.api.nvim_buf_line_count(buf), data.hunks))

    local target = vim.fn.line(".")
    if direction == "first" then
      target = lines[1]
    elseif direction == "last" then
      target = lines[#lines]
    else
      local wrap = MiniDiff.config.options.wrap_goto
      for _ = 1, vim.v.count1 do
        local found
        if direction == "next" then
          for _, l in ipairs(lines) do
            if l > target then
              found = l
              break
            end
          end
          found = found or (wrap and lines[1] or nil)
        else
          for i = #lines, 1, -1 do
            if lines[i] < target then
              found = lines[i]
              break
            end
          end
          found = found or (wrap and lines[#lines] or nil)
        end
        if not found then
          break
        end
        target = found
      end
    end

    vim.cmd("normal! m'")
    vim.api.nvim_win_set_cursor(0, { target, 0 })
    vim.cmd("normal! ^zv")
  end
end

-- gh / gH replace mini.diff's operators here, which work on line ranges and can't tell a
-- deletion from the change next to it. Visual gh / gH still take a range: vipgh.
local keys = {
  { { "n", "x" }, "gh", act("apply", "hunk"), "Accept pi hunk" },
  { { "n", "x" }, "gH", act("reset", "hunk"), "Reject pi hunk" },
  { { "n", "x" }, "]h", goto_hunk("next"), "Next pi hunk" },
  { { "n", "x" }, "[h", goto_hunk("prev"), "Prev pi hunk" },
  { { "n", "x" }, "]H", goto_hunk("last"), "Last pi hunk" },
  { { "n", "x" }, "[H", goto_hunk("first"), "First pi hunk" },
  { { "n", "x" }, "<leader>a", act("apply", "hunk"), "Accept pi hunk" },
  { { "n", "x" }, "<leader>r", act("reset", "hunk"), "Reject pi hunk" },
  { "n", "<leader>A", act("apply", "file"), "Accept pi file" },
  { "n", "<leader>R", act("reset", "file"), "Reject pi file" },
}

---@param buf integer
---@param on boolean
local function set_keys(buf, on)
  if (vim.b[buf].pi_review_keys == true) == on then
    return
  end
  vim.b[buf].pi_review_keys = on
  for _, k in ipairs(keys) do
    if on then
      vim.keymap.set(k[1], k[2], k[3], { buffer = buf, desc = k[4] })
    else
      pcall(vim.keymap.del, k[1], k[2], { buffer = buf })
    end
  end
end

---@param buf integer
function M.decorate(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  local reviewed, data = is_reviewed(buf)
  set_keys(buf, reviewed and true or false)
  if not (reviewed and data.hunks and data.ref_text) then
    return
  end

  -- Saved and nothing left to review: hand the buffer back to git.
  if #data.hunks == 0 and not vim.bo[buf].modified then
    local state = vim.b[buf].pi_review
    vim.schedule(function()
      forget({ toplevel = state.toplevel, dir = state.dir }, state.rel)
      reattach(buf)
    end)
    return
  end

  local ref = vim.split(data.ref_text, "\n")
  local tab = (" "):rep(vim.bo[buf].tabstop)
  local all = groups(vim.api.nvim_buf_line_count(buf), data.hunks)
  for i, g in ipairs(all) do
    local virt = {
      full_width({
        { " ▍ pi ", "PiReviewHeader" },
        { ("hunk %d/%d"):format(i, #all), "PiReviewHeader" },
        { "    ␣a accept   ␣r reject   ␣A / ␣R whole file", "PiReviewHint" },
      }),
    }
    for _, h in ipairs(g.hunks) do
      for l = h.ref_start, h.ref_start + h.ref_count - 1 do
        local text = (ref[l] or ""):gsub("\t", tab)
        table.insert(virt, full_width({ { text, "PiReviewDelete" } }))
      end
      for l = h.buf_start, h.buf_start + h.buf_count - 1 do
        vim.api.nvim_buf_set_extmark(
          buf,
          ns,
          l - 1,
          0,
          { line_hl_group = "PiReviewAdd", priority = 200 }
        )
      end
    end

    vim.api.nvim_buf_set_extmark(buf, ns, math.max(g.line - 1, 0), 0, {
      virt_lines = virt,
      virt_lines_above = g.above,
      priority = 200,
    })
  end
end

function M.setup()
  vim.api.nvim_create_user_command(
    "PiReview",
    M.list,
    { desc = "Files pending pi review" }
  )
  vim.keymap.set("n", "<leader>gp", M.pick, { desc = "Pending pi hunks" })

  local group = vim.api.nvim_create_augroup("pi-review", { clear = true })
  vim.api.nvim_create_autocmd("User", {
    group = group,
    pattern = "MiniDiffUpdated",
    callback = function(ev)
      M.decorate(ev.buf)
    end,
  })
  vim.api.nvim_create_autocmd("VimResized", {
    group = group,
    callback = function()
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.b[buf].pi_review then
          M.decorate(buf)
        end
      end
    end,
  })
  vim.api.nvim_create_autocmd("BufWritePost", {
    group = group,
    callback = function(ev)
      if vim.b[ev.buf].pi_review then
        M.on_write(ev.buf)
      end
    end,
  })
  vim.api.nvim_create_autocmd("DirChanged", {
    group = group,
    callback = function()
      local repo = cwd_repo()
      if repo then
        M.watch(repo)
      end
    end,
  })
  local repo = cwd_repo()
  if repo then
    M.watch(repo)
  end
end

return M
