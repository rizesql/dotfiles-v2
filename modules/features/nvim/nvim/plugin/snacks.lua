-- Snacks.setup() only takes effect once, so every snacks module this config uses is
-- configured here. Not lazyloaded: the dashboard decides whether to open at UIEnter.
vim.pack.add({
  { src = "https://github.com/folke/snacks.nvim", version = vim.version.range("*") },
})

Snacks.setup({
  dashboard = {
    enabled = true,
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
      header = [[
 .          .
 ';;,.        ::'
 ,:::;,,        :ccc,
,::c::,,,,.     :cccc,
,cccc:;;;;;.    cllll,
,cccc;.;;;;;,   cllll;
:cccc; .;;;;;;. coooo;
;llll;   ,:::::'loooo;
;llll:    ':::::loooo:
:oooo:     .::::llodd:
.;ooo:       ;cclooo:.
.;oc        'coo;.
 .'         .,.]],
    },
    sections = {
      { section = "header" },
      { section = "keys", gap = 1, padding = 1 },
      {
        section = "recent_files",
        title = "Recent Files",
        cwd = true,
        limit = 5,
        padding = 1,
      },
      function()
        local ms = string.format("%.2f", (vim.uv.hrtime() - Config.nvim_start_time) / 1e6)
        local plugins =
          #vim.fn.glob(vim.fn.stdpath("data") .. "/site/pack/*/*/*", false, true)
        return {
          align = "center",
          text = {
            { "⚡ Neovim started with ", hl = "footer" },
            { tostring(plugins), hl = "special" },
            { " plugins in ", hl = "footer" },
            { ms .. "ms", hl = "special" },
          },
        }
      end,
    },
  },
})
