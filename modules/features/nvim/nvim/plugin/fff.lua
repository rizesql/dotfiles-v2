require("lazyload").on_vim_enter(function()
  -- An update needs the prebuilt Rust matcher for the new commit.
  vim.api.nvim_create_autocmd("PackChanged", {
    callback = function(ev)
      if ev.data.spec.name == "fff" and ev.data.kind == "update" then
        if not ev.data.active then
          vim.cmd.packadd("fff")
        end
        require("fff.download").download_or_build_binary()
      end
    end,
  })

  -- Index on first picker open instead of at load, so nothing loads the matcher before
  -- the download below has finished.
  vim.g.fff = { lazy_sync = true }

  vim.pack.add({
    { src = "https://github.com/dmtrKovalenko/fff" },
  })

  -- Installs from the lockfile happen in the first vim.pack.add of any plugin file,
  -- before the hook above exists, so check for the matcher on every start. A no-op once
  -- it's there.
  require("fff.download").ensure_downloaded({}, function(ok, err)
    if not ok then
      vim.schedule(function()
        vim.notify(
          "fff: matcher download failed: " .. tostring(err),
          vim.log.levels.ERROR
        )
      end)
    end
  end)

  vim.keymap.set("n", "<C-p>", function()
    require("fff").find_files()
  end, { desc = "Find files" })
  vim.keymap.set("n", "<leader><space>", function()
    require("fff").find_files()
  end, { desc = "Find files" })
  vim.keymap.set("n", "<leader>/", function()
    require("fff").live_grep()
  end, { desc = "Grep" })
end)
