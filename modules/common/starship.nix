{ lib, pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      # xdg.configFile = {
      #   "starship.toml".source = lib.configFile "starship/config.toml";
      # };

      programs.starship = {
        enable = true;
        package = pkgs.starship;
        settings = lib.configFile "starship/config.toml" |> lib.readFile |> lib.fromTOML;
      };
    }
  ];
}
