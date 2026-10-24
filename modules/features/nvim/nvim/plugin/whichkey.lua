require("lazyload").on_vim_enter(function()
  vim.pack.add({
    { src = "https://github.com/folke/which-key.nvim", version = vim.version.range("*") },
  })

  require("which-key").setup({
    preset = "helix",
  })

  require("which-key").add({
    { "<leader><tab>", group = "tabs" },
    { "<leader>c", group = "code" },
    { "<leader>g", group = "git" },
    { "<leader>u", group = "ui" },
    { "<leader>x", group = "diagnostics/quickfix" },
    { "<leader>w", group = "windows", proxy = "<C-w>" },
    {
      "<leader>b",
      group = "buffers",
      expand = function()
        return require("which-key.extras").expand.buf()
      end,
    },
  })
end)
