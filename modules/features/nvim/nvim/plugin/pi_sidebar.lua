-- pi on the right (lua/pi_sidebar.lua). <C-]> works from inside the terminal too, so it
-- shadows jump-to-tag; gd covers that. Inside the terminal, space is typed into pi, so the
-- <leader>p keys only work from other windows; <M-s> and <M-n> work from both.
require("lazyload").on_vim_enter(function()
  local sidebar = require("pi_sidebar")
  local function new()
    sidebar.start()
  end
  vim.keymap.set({ "n", "t" }, "<C-]>", sidebar.toggle, { desc = "Toggle pi" })
  vim.keymap.set("n", "<leader>pp", sidebar.toggle, { desc = "Toggle pi" })
  vim.keymap.set("n", "<leader>pn", new, { desc = "New pi session" })
  vim.keymap.set({ "n", "t" }, "<M-n>", new, { desc = "New pi session" })
  vim.keymap.set("n", "<leader>ps", sidebar.select, { desc = "pi sessions" })
  vim.keymap.set({ "n", "t" }, "<M-s>", sidebar.select, { desc = "pi sessions" })
end)
