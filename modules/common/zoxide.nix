{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.zoxide = {
        enable = true;
        package = pkgs.zoxide;

        options = [ "--cmd cd" ];
      };
    }
  ];
}
