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
  environment.systemPackages = with pkgs; [
    pi-coding-agent
    nodejs
  ];

  system.activationScripts.postActivation.text = lib.mkIf config.isDarwin ''
    sudo -u ${config.user} mkdir -p "${config.home}/.pi/agent"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/settings.json" "${config.home}/.pi/agent/settings.json"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/themes" "${config.home}/.pi/agent/themes"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/extensions" "${config.home}/.pi/agent/extensions"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/tool-policy.json" "${config.home}/.pi/agent/tool-policy.json"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/core" "${config.home}/.pi/agent/core"
    sudo -u ${config.user} ln -sfn "${path}/.config/pi/agent/package.json" "${config.home}/.pi/agent/package.json"
    sudo -u ${config.user} ln -sfn "${path}/.config/agents" "${config.home}/.agents"
  '';
}

# { config, ... }:
# let
#   path = "${config.home}/.dotfiles";
# in
# {
#   home-manager.sharedModules = [
#     (
#       { config, pkgs, ... }:
#       {
#         home.packages = with pkgs; [
#           nodejs
#         ];

#         home.file = {
#           ".pi/agent/settings.json".source =
#             config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/settings.json";
#           ".pi/agent/themes".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/themes";
#           ".pi/agent/extensions".source =
#             config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/extensions";
#           ".pi/agent/tool-policy.json".source =
#             config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/tool-policy.json";

#           ".agents".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/agents";
#           ".pi/agent/core".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/core";
#           ".pi/agent/package.json".source =
#             config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/package.json";

#         };

#         programs.pi-coding-agent = {
#           enable = true;
#           package = pkgs.pi-coding-agent;
#         };
#       }
#     )
#   ];
# }
