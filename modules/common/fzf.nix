{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.fzf = {
        enable = true;
        package = pkgs.fzf;

        defaultCommand = "fd --type f --hidden --follow";
        historyWidget.command = "";
      };
    }
  ];
}
