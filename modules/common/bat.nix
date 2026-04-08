{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.bat = {
        enable = true;
        package = pkgs.bat;
      };
    }
  ];
}
