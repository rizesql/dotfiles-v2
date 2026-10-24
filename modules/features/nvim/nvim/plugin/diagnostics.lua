-- Nvim 0.12 ships with virtual_text off. Turn it on to match Zed's inline diagnostics.
vim.diagnostic.config({
  virtual_text = { spacing = 4, source = "if_many" },
  float = { source = "if_many" },
  severity_sort = true,
})

vim.keymap.set("n", "<leader>ud", function()
  vim.diagnostic.enable(not vim.diagnostic.is_enabled())
  vim.notify("Diagnostics: " .. (vim.diagnostic.is_enabled() and "on" or "off"))
end, { desc = "Toggle diagnostics" })
