{
  flake.modules.neovim = { config, pkgs, ... }: {
    environment.systemPackages = [ pkgs.neovim ];

    xdg.configFile."nvim".source = "${config.dotfiles.checkout}/.config/nvim";
  };
}
