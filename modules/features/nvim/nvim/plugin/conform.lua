require("lazyload").on_vim_enter(function()
  vim.g.auto_format = true

  vim.pack.add({
    { src = "https://github.com/stevearc/conform.nvim" },
  })

  require("conform").setup({
    -- Filetypes without a formatter here fall back to their language server.
    format_on_save = function()
      if not vim.g.auto_format then
        return
      end
      return { timeout_ms = 5000, lsp_format = "fallback" }
    end,
    formatters_by_ft = {
      lua = { "stylua" },
    },
  })

  vim.keymap.set({ "n", "x" }, "<leader>cf", function()
    require("conform").format({ lsp_format = "fallback" })
  end, { desc = "Format" })

  vim.keymap.set("n", "<leader>uf", function()
    vim.g.auto_format = not vim.g.auto_format
    vim.notify("Auto-format: " .. (vim.g.auto_format and "on" or "off"))
  end, { desc = "Toggle auto-format" })
end)
