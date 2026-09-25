{
  config,
  pkgs,
  lib,
  ...
}:
let
  path = "${config.home}/.dotfiles";
in
{
  environment.systemPackages = [ pkgs.neovim ];

  system.activationScripts.postActivation.text = lib.mkIf config.isDarwin ''
    sudo -u ${config.user} mkdir -p "${config.home}/.config"
    sudo -u ${config.user} ln -sfn "${path}/.config/nvim" "${config.home}/.config/nvim"
  '';
}

# { config, ... }:
# let
#   path = "${config.home}/.dotfiles";
# in
# {
#   home-manager.sharedModules = [
#     (
#       { config, ... }:
#       {
#         # programs.neovim = {
#         #   enable = true;
#         # };

#         xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/nvim";
#       }
#     )
#   ];
# }
