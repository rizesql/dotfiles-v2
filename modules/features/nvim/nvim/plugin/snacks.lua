-- Snacks.setup() only takes effect once, so every snacks module this config uses is
-- configured here. Not lazyloaded: the dashboard decides whether to open at UIEnter.
vim.pack.add({
  { src = "https://github.com/folke/snacks.nvim", version = vim.version.range("*") },
})

-- Laid out after Zed's welcome page: logo beside a two-line title, then labelled sections.
local width = 60

-- My logo in the style of fredrik's Neovim one: denser characters for deeper blue, and a
-- seam of commas along the diagonal edge that makes the R.
local logo = vim.split(
  [[
    ':;cc;;:,'
  ,llllcccc;;;:'
 ;ollllcccc;;;;;,
',,ollllccccc;;;;.
,d,,,lllllcccccc;'
,dddo,,,llllcccc;.
,doollc,,,,llllc.
,oollcc;::,,,c,
,ollc;;::,,'''..
'lcc;;:,,''''''''.
]],
  "\n",
  { trimempty = true }
)

local function header()
  local ms = (vim.uv.hrtime() - Config.nvim_start_time) / 1e6
  local plugins = #vim.fn.glob(vim.fn.stdpath("data") .. "/site/pack/*/*/*", false, true)
  local v = vim.version()
  -- Title text sits on the middle two of the logo's ten lines.
  local title = {
    [5] = { "Welcome back, " .. (vim.env.USER or "you"), "DashboardTitle" },
    [6] = {
      ("Neovim %d.%d.%d · %d plugins · %.0f ms"):format(
        v.major,
        v.minor,
        v.patch,
        plugins,
        ms
      ),
      "DashboardSubtitle",
    },
  }
  local title_width = 0
  for _, t in pairs(title) do
    title_width = math.max(title_width, vim.fn.strdisplaywidth(t[1]))
  end

  local logo_width = 0
  for _, l in ipairs(logo) do
    logo_width = math.max(logo_width, vim.fn.strdisplaywidth(l))
  end

  -- Pad every line to the same width so centring keeps the logo's columns aligned.
  local lines = {}
  for i, l in ipairs(logo) do
    local t = title[i] or { "" }
    table.insert(lines, {
      align = "center",
      text = {
        { l .. (" "):rep(logo_width - vim.fn.strdisplaywidth(l)), hl = "DashboardLogo" },
        { "   " .. t[1], hl = t[2] },
        { (" "):rep(title_width - vim.fn.strdisplaywidth(t[1])) },
      },
    })
  end
  lines[#lines].padding = 2
  return lines
end

---@param label string
local function section_title(label)
  return function()
    return {
      text = {
        { label, hl = "DashboardSection" },
        { " " .. ("─"):rep(width - #label - 1), hl = "NonText" },
      },
      padding = 1,
    }
  end
end

Snacks.setup({
  dashboard = {
    enabled = true,
    width = width,
    formats = {
      -- Name first, folder after it, like Zed's recent projects.
      file = function(item)
        local dir = vim.fn.fnamemodify(item.file, ":.:h")
        return {
          { vim.fn.fnamemodify(item.file, ":t"), hl = "file" },
          dir ~= "." and { "  " .. dir, hl = "dir" } or nil,
        }
      end,
    },
    preset = {
      keys = {
        {
          icon = "\u{f002} ",
          key = "f",
          desc = "Find File",
          action = function()
            require("fff").find_files()
          end,
        },
        {
          icon = "\u{f022} ",
          key = "g",
          desc = "Grep",
          action = function()
            require("fff").live_grep()
          end,
        },
        { icon = "\u{f07c} ", key = "e", desc = "Explore", action = ":Oil" },
        {
          icon = "\u{f15b} ",
          key = "n",
          desc = "New File",
          action = ":ene | startinsert",
        },
        {
          icon = "\u{f423} ",
          key = "c",
          desc = "Config",
          action = function()
            require("fff").find_files_in_dir(vim.uv.fs_realpath(vim.fn.stdpath("config")))
          end,
        },
        {
          icon = "\u{f06b0} ",
          key = "u",
          desc = "Update Plugins",
          action = function()
            vim.pack.update()
          end,
        },
        { icon = "\u{f426} ", key = "q", desc = "Quit", action = ":qa" },
      },
    },
    sections = {
      header,
      section_title("GET STARTED"),
      { section = "keys", gap = 1, padding = 2 },
      section_title("RECENT FILES"),
      { section = "recent_files", cwd = true, limit = 5, gap = 1 },
    },
  },

  -- vim.ui.select (code actions, M6's session list) goes through the picker too.
  picker = { enabled = true },
  -- Your lazygit is wrapped with its own config file, and the theme snacks would generate
  -- needs hex colours this colorscheme doesn't have.
  lazygit = { enabled = true, configure = false },
  gitbrowse = { enabled = true },
  -- Highlight other references to the word under the cursor; ]] / [[ jump between them.
  words = { enabled = true },
  -- Skip treesitter and LSP on huge files; draw `nvim file` before plugins finish loading.
  bigfile = { enabled = true },
  quickfile = { enabled = true },
})

-- Git
-- lazygit's nvim-remote preset (modules/features/lazygit/config.yml) opens files with
-- --remote-tab. While lazygit runs, fold such a tab back into the window it was opened from.
local lazygit ---@type { term: snacks.win, origin: integer }?
vim.keymap.set("n", "<leader>gg", function()
  lazygit = { origin = vim.api.nvim_get_current_win(), term = Snacks.lazygit() }
end, { desc = "Lazygit" })
vim.api.nvim_create_autocmd("TabNewEntered", {
  group = vim.api.nvim_create_augroup("lazygit-edit", { clear = true }),
  callback = function()
    local lg = lazygit
    if not (lg and lg.term:buf_valid() and vim.api.nvim_win_is_valid(lg.origin)) then
      return
    end
    -- The file isn't in the new tab yet; --remote-tab edits it after this event.
    vim.schedule(function()
      local buf = vim.api.nvim_get_current_buf()
      vim.cmd.tabclose()
      vim.api.nvim_win_set_buf(lg.origin, buf)
      vim.api.nvim_set_current_win(lg.origin)
    end)
  end,
})
vim.keymap.set({ "n", "x" }, "<leader>gB", function()
  Snacks.gitbrowse()
end, { desc = "Open on GitHub" })
vim.keymap.set("n", "<leader>gs", function()
  Snacks.picker.git_status()
end, { desc = "Status" })
vim.keymap.set("n", "<leader>gd", function()
  Snacks.picker.git_diff()
end, { desc = "Hunks" })
vim.keymap.set("n", "<leader>gl", function()
  Snacks.picker.git_log()
end, { desc = "Log" })
vim.keymap.set("n", "<leader>gL", function()
  Snacks.picker.git_log_file()
end, { desc = "Log (file)" })
vim.keymap.set("n", "<leader>gb", function()
  Snacks.picker.git_branches()
end, { desc = "Branches" })

-- References
vim.keymap.set("n", "]]", function()
  Snacks.words.jump(1)
end, { desc = "Next reference" })
vim.keymap.set("n", "[[", function()
  Snacks.words.jump(-1)
end, { desc = "Prev reference" })

-- Rename the file and let the language server update imports
vim.keymap.set("n", "<leader>cR", function()
  Snacks.rename.rename_file()
end, { desc = "Rename file" })
