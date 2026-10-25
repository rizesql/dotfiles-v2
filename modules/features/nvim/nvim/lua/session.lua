-- One mini.sessions session per working directory: written on exit (plugin/mini.lua),
-- restored on demand from the dashboard or <leader>qs.

local M = {}

--- Session name for the current working directory, e.g. `%Users%me%project`.
function M.name()
  return (vim.fn.getcwd():gsub("/", "%%"))
end

-- MiniSessions.read() wipes every buffer with `%bwipeout!`, which kills running pi
-- sessions (lua/pi_sidebar.lua) along with their terminals.
local function pi_running()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.b[buf].pi_session then
      return true
    end
  end
  return false
end

---@param name string
local function read(name)
  if pi_running() then
    vim.notify(
      "Close pi sessions first: restoring a session wipes every buffer",
      vim.log.levels.WARN
    )
    return
  end
  MiniSessions.read(name)
end

function M.restore()
  local name = M.name()
  if not MiniSessions.detected[name] then
    vim.notify("No session for " .. vim.fn.getcwd(), vim.log.levels.WARN)
    return
  end
  read(name)
end

function M.select()
  local names = vim.tbl_keys(MiniSessions.detected)
  table.sort(names)
  vim.ui.select(names, {
    prompt = "Sessions",
    format_item = function(name)
      return (name:gsub("%%", "/"))
    end,
  }, function(name)
    if name then
      read(name)
    end
  end)
end

function M.write_on_exit()
  -- Only the dashboard, oil or scratch buffers are open: nothing worth restoring, and
  -- writing would replace the last real session for this directory.
  local files = vim.tbl_filter(function(info)
    return info.name ~= "" and vim.bo[info.bufnr].buftype == ""
  end, vim.fn.getbufinfo({ buflisted = 1 }))
  if #files == 0 then
    return
  end

  -- Terminals stay out of the session (sessionoptions), so the pi sidebar would come back
  -- as an empty split.
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    local buf = vim.api.nvim_win_get_buf(win)
    local tab = vim.api.nvim_win_get_tabpage(win)
    if vim.bo[buf].buftype == "terminal" and #vim.api.nvim_tabpage_list_wins(tab) > 1 then
      vim.api.nvim_win_close(win, true)
    end
  end

  MiniSessions.write(M.name(), { verbose = false })
end

return M
