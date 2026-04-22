{ lib, pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      xdg.configFile = {
        "git/personal.gitconfig".source = lib.configFile "git/personal.gitconfig";
        "git/codestory.gitconfig".source = lib.configFile "git/codestory.gitconfig";
      };

      programs.git = {
        enable = true;
        package = pkgs.git;

        settings = {
          alias = {
            main-branch = "!git symbolic-ref refs/remotes/origin/HEAD | cut -d '/' -f4";
            fomo = "!git fetch origin $(git main-branch) && git rebase origin/$(git main-branch) --autostash";
            save = "!git commit -am \"commit\"";
          };

          push.autoSetupRemote = true;
          core.editor = "code --wait";
          core.excludesfile = "~/.gitignore";
          merge.conflictstyle = "zdiff3";
        };

        includes = [
          { path = "~/.config/git/personal.gitconfig"; }
          {
            condition = "gitdir:~/work/codestory/**";
            path = "~/.config/git/codestory.gitconfig";
          }
        ];
      };

      programs.delta = {
        enable = true;
        package = pkgs.delta;
        enableGitIntegration = true;

        options = {
          navigate = true;
          side-by-side = true;
          line-numbers = true;
        };
      };
    }
  ];
}
