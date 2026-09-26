{
  flake.modules.ghostty = { pkgs, config, ... }: {
    environment.systemPackages = [
      (if config.isDarwin then pkgs.ghostty-bin else pkgs.ghostty)
    ];

    xdg.configFile."ghostty/config.ghostty".source = ./config.ghostty;
  };
}
