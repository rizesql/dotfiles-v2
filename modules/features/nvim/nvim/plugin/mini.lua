-- Top level so mini is on the rtp before plugin/lsp.lua (sorted first) reads
-- mini.completion's LSP capabilities.
vim.pack.add({
  { src = "https://github.com/nvim-mini/mini.nvim" },
})

-- Top level too: plugin/oil.lua loads at startup and picks its icon provider once.
require("mini.icons").setup()

require("lazyload").on_vim_enter(function()
  MiniIcons.tweak_lsp_kind()

  require("mini.statusline").setup()

  require("mini.completion").setup({
    mappings = {
      force_twostep = "<M-Space>",
      force_fallback = "",
      scroll_down = "<C-d>",
      scroll_up = "<C-u>",
    },
  })

  for from, to in pairs({ an = "<M-o>", ["in"] = "<M-i>" }) do
    local builtin = vim.fn.maparg(from, "x", false, true)
    if next(builtin) then
      vim.keymap.set("x", to, builtin.callback or builtin.rhs, { desc = builtin.desc })
    end
  end
  require("mini.ai").setup()

  require("mini.surround").setup({
    mappings = {
      add = "ys",
      delete = "ds",
      replace = "cs",
      find = "",
      find_left = "",
      highlight = "",
      suffix_last = "",
      suffix_next = "",
    },
    search_method = "cover_or_next",
  })
  vim.keymap.del("x", "ys")
  vim.keymap.set(
    "x",
    "S",
    [[:<C-u>lua MiniSurround.add('visual')<CR>]],
    { silent = true, desc = "Surround selection" }
  )
  vim.keymap.set("n", "yss", "ys_", { remap = true, desc = "Surround line" })

  require("mini.pairs").setup()

  -- Hunks against the git index: gh stages, gH resets, ]h/[h move, gh is also a textobject.
  -- Reviewing pi's edits will reuse the same keys with a different reference text.
  require("mini.diff").setup({
    view = {
      style = "sign",
      signs = { add = "▎", change = "▎", delete = "▁" },
    },
  })
  vim.keymap.set("n", "<leader>go", function()
    MiniDiff.toggle_overlay(0)
  end, { desc = "Toggle diff overlay" })

  -- Branch for the statusline, and :Git for one-off commands.
  require("mini.git").setup()
end)
