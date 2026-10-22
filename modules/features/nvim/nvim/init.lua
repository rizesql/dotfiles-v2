-- require("debug_config")
-- require("profile_config")

local nvim_start_time = vim.uv.hrtime()

vim.loader.enable()

_G.Config = {
  nvim_start_time = nvim_start_time,

  -- treesitter
  use_treesitter_parser = true,
  use_nvim_treesitter = true,

  use_codediff = true
}

vim.env.DOTFILES = vim.env.DOTFILES or vim.fs.normalize("~/.dotfiles")

vim.g.mapleader = " "
vim.g.maplocalleader = ","

require("options")
require("keymaps")

require("vim._core.ui2").enable()
