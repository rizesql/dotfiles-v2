-- nvim-treesitter (main) only installs parsers and queries. Nvim itself highlights,
-- folds (lua/options.lua) and injects. Parsers compile on first use with the tree-sitter
-- CLI from modules/features/nvim/default.nix.
if not Config.use_nvim_treesitter then
  return
end

require("lazyload").on_vim_enter(function()
  vim.api.nvim_create_autocmd("PackChanged", {
    callback = function(ev)
      if ev.data.spec.name == "nvim-treesitter" and ev.data.kind == "update" then
        if not ev.data.active then
          vim.cmd.packadd("nvim-treesitter")
        end
        vim.cmd("TSUpdate")
      end
    end,
  })

  vim.pack.add({
    { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "main" },
  })

  --- Ad-hoc sign a freshly compiled parser so macOS doesn't kill nvim when it loads it.
  ---@param lang string
  local function sign_parser_macos(lang)
    if vim.fn.has("mac") ~= 1 then
      return
    end
    local path = vim.fn.stdpath("data") .. "/site/parser/" .. lang .. ".so"
    if vim.fn.filereadable(path) == 1 then
      vim.fn.system({ "codesign", "--force", "--sign", "-", path })
    end
  end

  local installing = {} ---@type table<string, true>

  --- Start highlighting in `buf`, installing the parser in the background if missing.
  ---@param buf integer
  local function start(buf)
    local ft = vim.bo[buf].filetype
    local lang = ft ~= "" and vim.treesitter.language.get_lang(ft)
    if not lang or pcall(vim.treesitter.start, buf, lang) then
      return
    end
    if installing[lang] or not require("nvim-treesitter.parsers")[lang] then
      return
    end

    installing[lang] = true
    require("nvim-treesitter").install({ lang }):await(function(err)
      installing[lang] = nil
      if err then
        return
      end
      vim.schedule(function()
        sign_parser_macos(lang)
        for _, b in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_loaded(b) and vim.bo[b].filetype == ft then
            pcall(vim.treesitter.start, b, lang)
          end
        end
      end)
    end)
  end

  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("treesitter-start", { clear = true }),
    callback = function(ev)
      start(ev.buf)
    end,
  })

  -- Buffers opened from the command line had their FileType before VimEnter.
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      start(buf)
    end
  end
end)
