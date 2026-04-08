{ config, pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.television = {
        enable = true;
        package = pkgs.television;

        channels = {
          files = {
            metadata = {
              name = "files";
              description = "A channel to select files and directories";
              requirements = [
                "fd"
                "bat"
              ];
            };

            ui.ui_scale = 95;

            source.command = [ "fd -t f --hidden --exclude .git" ];

            preview = {
              command = "bat -n --color=always '{}'";
              env.BAT_THEME = "ansi";
            };

            keybindings = {
              shortcut = "f1";
              f12 = "actions:edit";
              ctrl-up = "actions:goto_parent_dir";
            };

            actions = {
              edit = {
                description = "Opens the selected entries with the default editor (falls back to vim)";
                command = "${config.environment.variables.EDITOR} '{}'";
                mode = "execute";
              };

              goto_parent_dir = {
                description = "Re-opens tv in the parent directory";
                command = "tv files ..";
                mode = "execute";
              };
            };
          };
        };
      };
    }
  ];
}
