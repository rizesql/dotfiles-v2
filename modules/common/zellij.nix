{
  lib,
  pkgs,
  ...
}:
{
  home-manager.sharedModules = [
    {
      programs.zellij = {
        enable = true;
        package = pkgs.zellij;

        enableFishIntegration = false;
        attachExistingSession = false;
        exitShellOnExit = false;

        extraConfig = lib.configFile "zellij/config.kdl" |> lib.readFile;
        layouts = {
          default = lib.configFile "zellij/layout.kdl" |> lib.readFile;
        };
      };
    }
  ];
}
