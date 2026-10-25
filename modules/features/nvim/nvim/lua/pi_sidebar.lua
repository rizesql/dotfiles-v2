-- pi in a terminal split on the right. Every session is its own terminal buffer and keeps
-- running while hidden; the sidebar window shows one of them at a time.

local M = {}

M.cmd = { "pi" }

---@class PiSession
---@field buf integer
---@field label string
---@field id? string pi session id, when resumed from the list

---@type PiSession[]
local sessions = {}
---@type integer?
local win
---@type integer?
local current

local function win_valid()
  return win ~= nil and vim.api.nvim_win_is_valid(win)
end

local function width()
  return math.max(80, math.floor(vim.o.columns * 0.4))
end

---@param buf integer
local function show(buf)
  if win_valid() then
    vim.api.nvim_win_set_buf(win, buf)
    vim.api.nvim_set_current_win(win)
  else
    win = vim.api.nvim_open_win(buf, true, { split = "right", win = -1, width = width() })
  end
  local wo = vim.wo[win]
  wo.number, wo.relativenumber, wo.cursorline = false, false, false
  wo.signcolumn, wo.foldcolumn, wo.statuscolumn = "no", "0", ""
  wo.winfixwidth = true
  current = buf
  vim.cmd.startinsert()
end

---@param buf integer
local function on_exit(buf)
  sessions = vim.tbl_filter(function(s)
    return s.buf ~= buf
  end, sessions)
  if current == buf then
    current = sessions[#sessions] and sessions[#sessions].buf or nil
    if win_valid() then
      if current then
        vim.api.nvim_win_set_buf(win, current)
      elseif #vim.api.nvim_list_wins() > 1 then
        vim.api.nvim_win_close(win, true)
      end
    end
  end
  if vim.api.nvim_buf_is_valid(buf) then
    vim.api.nvim_buf_delete(buf, { force = true })
  end
end

--- Start pi in a new terminal buffer and show it.
---@param args? string[] extra pi arguments
---@param label? string
---@param id? string
function M.start(args, label, id)
  local buf = vim.api.nvim_create_buf(false, true)
  show(buf)
  -- Runs in the current buffer, which show() just made `buf`. Nvim sets $NVIM for pi.
  vim.fn.jobstart(vim.list_extend(vim.deepcopy(M.cmd), args or {}), {
    term = true,
    cwd = vim.fn.getcwd(),
    on_exit = function()
      vim.schedule(function()
        on_exit(buf)
      end)
    end,
  })
  vim.bo[buf].bufhidden = "hide"
  vim.bo[buf].buflisted = false
  label = label or ("new · " .. os.date("%H:%M"))
  vim.b[buf].pi_session = label
  table.insert(sessions, { buf = buf, label = label, id = id })
  vim.cmd.startinsert()
end

--- Hide the sidebar when it's focused, focus it when it's open, open it otherwise.
function M.toggle()
  if win_valid() then
    if vim.api.nvim_get_current_win() ~= win then
      vim.api.nvim_set_current_win(win)
      vim.cmd.startinsert()
    elseif #vim.api.nvim_list_wins() > 1 then
      vim.api.nvim_win_close(win, false)
      win = nil
    end
  elseif current and vim.api.nvim_buf_is_valid(current) then
    show(current)
  else
    M.start()
  end
end

local function sessions_dir()
  return (vim.env.PI_CODING_AGENT_DIR or vim.fn.expand("~/.pi/agent")) .. "/sessions"
end

--- Past pi sessions started in the current directory, newest first.
---@param limit integer
---@return { id: string, label: string }[]
function M.past(limit)
  local cwd = vim.uv.fs_realpath(vim.fn.getcwd()) or vim.fn.getcwd()
  local files = vim.fn.glob(sessions_dir() .. "/*/*.jsonl", false, true)
  -- File names start with an ISO timestamp, so sorting by name sorts by start time.
  table.sort(files, function(a, b)
    return vim.fs.basename(a) > vim.fs.basename(b)
  end)

  local res = {}
  for _, file in ipairs(files) do
    local f = io.open(file, "r")
    if f then
      local ok, head = pcall(vim.json.decode, f:read("l") or "")
      if ok and type(head) == "table" and head.type == "session" and head.cwd == cwd then
        -- Label with the first thing I asked; it's within the first few entries.
        local first = "(no messages)"
        for _ = 1, 40 do
          local line = f:read("l")
          if not line then
            break
          end
          if line:find('"role":"user"', 1, true) then
            local okm, entry = pcall(vim.json.decode, line)
            local text = okm and vim.tbl_get(entry, "message", "content", 1, "text")
            if type(text) == "string" then
              first = text:gsub("%s+", " ")
            end
            break
          end
        end
        local when = (head.timestamp or ""):gsub("T", " "):sub(1, 16)
        table.insert(res, { id = head.id, label = when .. "  " .. first })
      end
      f:close()
      if #res >= limit then
        break
      end
    end
  end
  return res
end

--- Pick a running session, resume a past one, or start a new one.
function M.select()
  local items = {}
  for _, s in ipairs(sessions) do
    table.insert(items, { kind = "running", session = s, label = "● " .. s.label })
  end
  table.insert(items, { kind = "new", label = "+ new session" })
  local running = {}
  for _, s in ipairs(sessions) do
    if s.id then
      running[s.id] = true
    end
  end
  for _, p in ipairs(M.past(30)) do
    if not running[p.id] then
      table.insert(items, { kind = "past", past = p, label = "  " .. p.label })
    end
  end

  vim.ui.select(items, {
    prompt = "pi sessions",
    format_item = function(item)
      return item.label
    end,
  }, function(item)
    if not item then
      return
    elseif item.kind == "running" then
      show(item.session.buf)
    elseif item.kind == "new" then
      M.start()
    else
      M.start({ "--session", item.past.id }, item.past.label:sub(1, 40), item.past.id)
    end
  end)
end

return M
