{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.carapace = {
        enable = true;
        package = pkgs.carapace;
      };
    }
  ];
}
