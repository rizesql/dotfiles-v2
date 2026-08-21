{ config, ... }:
let
  path = "${config.home}/.dotfiles";
in
{
  home-manager.sharedModules = [
    (
      { config, ... }:
      {
        # programs.neovim = {
        #   enable = true;
        # };

        xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/nvim";
      }
    )
  ];
}
