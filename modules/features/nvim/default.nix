{
  flake.modules.nvim = { pkgs, config, ... }: {
    environment.systemPackages = [
      pkgs.neovim
      pkgs.tree-sitter

      # lua
      pkgs.lua-language-server
      pkgs.stylua
    ];

    xdg.configFile."nvim".source = "${config.dotfiles.checkout}/modules/features/nvim/nvim";
  };
}
