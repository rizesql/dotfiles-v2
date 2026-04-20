{ config, pkgs, ... }:
{
  home-manager.sharedModules = [
    {
      programs.ghostty = {
        enable = true;
        package = if config.isDarwin then pkgs.ghostty-bin else pkgs.ghostty;

        settings = {
          theme = "catppuccin-mocha";
          font-family = "CommitMono-rizesql";
          # font-family = "Berkeley Mono";
          font-thicken = true;
          cursor-style = "block";
          window-theme = "ghostty";
          window-colorspace = "display-p3";
          macos-icon = "custom-style";
          macos-icon-ghost-color = "#b4befe";
          macos-icon-screen-color = "#89b4fa";

          window-save-state = "always";

          mouse-hide-while-typing = true;
          window-decoration = true;
          window-padding-balance = true;

          macos-option-as-alt = true;
          macos-non-native-fullscreen = true;

          quick-terminal-screen = "mouse";
          quick-terminal-position = "center";
          quick-terminal-size = "1512px,952px";
          # quick-terminal-size = "3024px,1904px";
          quick-terminal-autohide = true;
          quick-terminal-animation-duration = 0.12;

          keybind = [
            "cmd+t=unbind"
            "cmd+n=unbind"
            "cmd+c=unbind"
            "cmd+w=unbind"
            "cmd+opt+left=unbind"
            "cmd+opt+right=unbind"
            "global:ctrl+backquote=toggle_quick_terminal"
          ];

          auto-update-channel = "tip";
        };
      };
    }
  ];
}
