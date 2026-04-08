{
  config,
  lib,
  pkgs,
  ...
}:
let
  envInit =
    config.environment.variables
    |> lib.mapAttrsToList (k: v: "set -gx ${k} \"${toString v}\"")
    |> lib.concatStringsSep "\n";
in
{
  programs.fish.enable = true;

  environment.variables = {
    STARSHIP_LOG = "error";
    fish_greeting = "";
  };

  home-manager.sharedModules = [
    {
      programs.fish = {
        enable = true;
        package = pkgs.fish;
        shellAliases = config.environment.shellAliases;

        shellInit = ''
          ${envInit}
        '';

        interactiveShellInit = ''
          if type -q ZELLIJ
              function _zellij_update_tabname --on-variable PWD
                  zellij action rename-tab (basename $PWD) 2>/dev/null
              end
          end
        '';
      };
    }
  ];
}
