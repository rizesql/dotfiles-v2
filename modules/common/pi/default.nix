{ config, ... }:
let
  path = "${config.home}/.dotfiles";
in
{
  home-manager.sharedModules = [
    (
      { config, pkgs, ... }:
      {
        home.packages = with pkgs; [
          nodejs
        ];

        home.file = {
          ".pi/agent/settings.json".source =
            config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/settings.json";
          ".pi/agent/themes".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/themes";
          ".pi/agent/extensions".source =
            config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/extensions";
          ".pi/agent/tool-policy.json".source =
            config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/tool-policy.json";

          ".agents".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/agents";
          ".pi/agent/core".source = config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/core";
          ".pi/agent/package.json".source =
            config.lib.file.mkOutOfStoreSymlink "${path}/.config/pi/agent/package.json";

        };

        programs.pi-coding-agent = {
          enable = true;
          package = pkgs.pi-coding-agent;
        };
      }
    )
  ];
}
