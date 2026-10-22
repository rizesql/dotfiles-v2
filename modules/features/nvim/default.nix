{
  flake.modules.nvim = { pkgs, config, ... }: {
    environment.systemPackages = [ pkgs.neovim ];

    xdg.configFile."nvim".source = "${config.dotfiles.checkout}/modules/features/nvim/nvim";
  };
}
