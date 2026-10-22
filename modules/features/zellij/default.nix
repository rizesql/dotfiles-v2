{
  flake.modules.zellij =
    { config, pkgs, ... }:
    let
      zellijConfig = pkgs.writeText "zellij-config.kdl" ''
        ${builtins.readFile ./zellij/config.kdl}
        layout_dir "${config.homeDirectory}/.config/zellij/layouts"
      '';
    in
    {
      environment.systemPackages = [ pkgs.zellij ];
      xdg.configFile = {
        "zellij/config.kdl".source = zellijConfig;
        "zellij/layouts".source = ./zellij/layouts;
      };
    };
}
