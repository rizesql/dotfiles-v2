-- vim.lsp.enable() only registers servers. Nvim starts one when a buffer of a matching
-- filetype opens and the server's binary is on PATH, so listing a server costs nothing
-- until then. Binaries come from modules/features/nvim/default.nix or the project's
-- devShell; per-server settings live in after/lsp/<server>.lua.
require("lazyload").on_vim_enter(function()
  vim.pack.add({
    {
      src = "https://github.com/neovim/nvim-lspconfig",
      version = vim.version.range("*"),
    },
  })

  vim.lsp.config(
    "*",
    { capabilities = require("mini.completion").get_lsp_capabilities() }
  )

  -- Only list a server whose lspconfig `cmd` is a function (cssls, eslint, html, jsonls,
  -- tailwindcss, yamlls) once nix installs its binary: nvim's executable check only
  -- covers table cmds, so a missing one errors on every buffer of that filetype.
  vim.lsp.enable({
    "bashls",
    "gopls",
    "lua_ls",
    "marksman",
    "nixd",
    "rust_analyzer",
    "taplo",
    "texlab",
    "vtsls",
  })

  vim.api.nvim_create_autocmd("LspAttach", {
    group = vim.api.nvim_create_augroup("lsp-attach", { clear = true }),
    callback = function(args)
      local buf = args.buf
      local client = vim.lsp.get_client_by_id(args.data.client_id)
      if not client then
        return
      end

      -- Server folds know about regions treesitter can't see (e.g. #region).
      if client:supports_method("textDocument/foldingRange", buf) then
        for _, win in ipairs(vim.fn.win_findbuf(buf)) do
          require("fold").lsp_foldexpr(win)
        end
      end

      -- Edit one HTML/JSX tag and its pair follows.
      if client:supports_method("textDocument/linkedEditingRange", buf) then
        vim.lsp.linked_editing_range.enable(true, { bufnr = buf })
      end

      -- Nvim 0.12 already maps K, grn, gra, grr, gri, grt, grx, gO and [d/]d.
      vim.keymap.set(
        "n",
        "gd",
        vim.lsp.buf.definition,
        { buffer = buf, desc = "Go to definition" }
      )
      vim.keymap.set(
        "n",
        "gD",
        vim.lsp.buf.declaration,
        { buffer = buf, desc = "Go to declaration" }
      )
    end,
  })

  -- Reset diagnostics on detach so :lsp restart/:lsp stop don't leave stale state.
  vim.api.nvim_create_autocmd("LspDetach", {
    group = vim.api.nvim_create_augroup("lsp-detach-cleanup", { clear = true }),
    callback = function(args)
      local client = vim.lsp.get_client_by_id(args.data.client_id)
      if not client then
        return
      end

      local prefix = ("nvim.lsp.%s.%d"):format(client.name, client.id)
      for namespace, metadata in pairs(vim.diagnostic.get_namespaces()) do
        local name = metadata.name or ""
        if name == prefix or vim.startswith(name, prefix .. ".") then
          vim.diagnostic.reset(namespace)
        end
      end
    end,
  })

  -- Nvim records LSP progress but doesn't show it. Forward it as progress messages,
  -- which ui2 renders; one message per server task, updated in place.
  local progress_ids = {} ---@type table<string, integer>
  vim.api.nvim_create_autocmd("LspProgress", {
    group = vim.api.nvim_create_augroup("lsp-progress", { clear = true }),
    callback = function(ev)
      local value = ev.data.params.value
      if type(value) ~= "table" then
        return
      end
      local client = vim.lsp.get_client_by_id(ev.data.client_id)
      local key = ev.data.client_id .. ":" .. tostring(ev.data.params.token)
      local done = value.kind == "end"
      progress_ids[key] = vim.api.nvim_echo(
        { { value.message or value.title or "" } },
        done,
        {
          kind = "progress",
          id = progress_ids[key],
          source = "vim.lsp",
          title = client and client.name or "lsp",
          status = done and "success" or "running",
          percent = value.percentage,
        }
      )
      if done then
        progress_ids[key] = nil
      end
    end,
  })

  -- Global, unlike Snacks.toggle.inlay_hints(), which only toggles the current buffer.
  Snacks.toggle
    .new({
      name = "Inlay Hints",
      get = function()
        return vim.lsp.inlay_hint.is_enabled()
      end,
      set = function(state)
        vim.lsp.inlay_hint.enable(state)
      end,
    })
    :map("<leader>uh")

  Snacks.toggle
    .new({
      name = "Codelens",
      get = function()
        return vim.lsp.codelens.is_enabled()
      end,
      set = function(state)
        vim.lsp.codelens.enable(state)
      end,
    })
    :map("<leader>ul")
end)
