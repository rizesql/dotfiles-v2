{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.yazi = {
        enable = true;
        package = pkgs.yazi;
      };
    }
  ];
}
