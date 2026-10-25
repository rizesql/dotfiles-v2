-- Nvim 0.12 ships with virtual_text off. Turn it on to match Zed's inline diagnostics.
vim.diagnostic.config({
  virtual_text = { spacing = 4, source = "if_many" },
  float = { source = "if_many" },
  severity_sort = true,
})

-- Deferred: this file sources before plugin/snacks.lua defines Snacks.
require("lazyload").on_vim_enter(function()
  Snacks.toggle.diagnostics():map("<leader>ud")
end)
