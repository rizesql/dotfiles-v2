{ pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.lazygit = {
        enable = true;
        package = pkgs.lazygit;
        settings = {
          promptToReturnFromSubprocess = false;
          notARepository = "quit";

          git = {
            parseEmoji = true;
            pagers = [
              {
                colorArg = "always";
                pager = "delta --paging=never";
              }
            ];
          };

          gui = {
            commitHashLength = 0;
            skipRewordInEditorWarning = true;
            nerdFontsVersion = "3";
            scrollHeight = 10;
            mainPanelSplitMode = "vertical";
            showDivergenceFromBaseBranch = "arrowAndNumber";
          };

          os = {
            edit = "nvim -- {{filename}}";
            editAtLine = "nvim +{{line}} -- {{filename}}";
            editAtLineAndWait = "nvim +{{line}} -- {{filename}}";
            openDirInEditor = "nvim -- {{dir}}";
            editInTerminal = true;
            openLink = "open -n \"$(echo {{link}} | sed 's/%3E/>/g' | sed 's/%2F/\//g' | sed s/%27/\'/g )\"";
          };
        };
      };
    }
  ];
}
