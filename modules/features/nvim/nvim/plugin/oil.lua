-- `nvim <dir>` opens the dashboard (plugin/snacks.lua) inside <dir>, not oil. oil.setup()
-- takes over a directory buffer on the spot, so drop the argument first. The dashboard
-- only draws into buffer 1 when it has no name; nvim hasn't loaded it yet, so it's empty.
if vim.fn.argc() == 1 and vim.fn.isdirectory(vim.fn.argv(0)) == 1 then
  vim.cmd.cd(vim.fn.fnameescape(vim.fn.argv(0)))
  vim.cmd.argdelete("*")
  vim.cmd("silent 0file")
  -- :0file keeps the old name in a new alternate buffer; drop it.
  vim.api.nvim_buf_delete(vim.fn.bufnr("#"), { force = true })
end

-- Not lazyloaded, so `:e <dir>` and `-` work from the first buffer.
vim.pack.add({
  { src = "https://github.com/stevearc/oil.nvim" },
})

require("oil").setup({
  keymaps = {
    -- Free <C-h>/<C-l> for window navigation and <C-s> for save, which applies oil edits.
    ["<C-h>"] = false,
    ["<C-l>"] = false,
    ["<C-s>"] = false,
    ["<C-v>"] = { "actions.select", opts = { vertical = true } },
    ["<C-x>"] = { "actions.select", opts = { horizontal = true } },
    ["q"] = { "actions.close", mode = "n" },
  },
  view_options = { show_hidden = true },
})

vim.keymap.set("n", "-", "<cmd>Oil<cr>", { desc = "Open parent directory" })
