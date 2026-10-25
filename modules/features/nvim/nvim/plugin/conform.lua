require("lazyload").on_vim_enter(function()
  vim.g.auto_format = true

  vim.pack.add({
    { src = "https://github.com/stevearc/conform.nvim" },
  })

  require("conform").setup({
    -- Filetypes without a formatter here fall back to their language server.
    -- Not while a file is under pi review (lua/pi_review.lua): formatting would fold
    -- unrelated changes into pi's hunks. <leader>cf still formats on demand.
    format_on_save = function(buf)
      if not vim.g.auto_format or vim.b[buf].pi_review then
        return
      end
      return { timeout_ms = 5000, lsp_format = "fallback" }
    end,
    formatters_by_ft = {
      lua = { "stylua" },
      -- nixd doesn't format without a configured formatter; nixfmt is the flake's own
      -- `nix fmt` (modules/tools.nix).
      nix = { "nixfmt" },
    },
  })

  vim.keymap.set({ "n", "x" }, "<leader>cf", function()
    require("conform").format({ lsp_format = "fallback" })
  end, { desc = "Format" })

  Snacks.toggle
    .new({
      name = "Auto-format",
      get = function()
        return vim.g.auto_format == true
      end,
      set = function(state)
        vim.g.auto_format = state
      end,
    })
    :map("<leader>uf")
end)
