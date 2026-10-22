{
  flake.modules.ghostty =
    {
      pkgs,
      config,
      lib,
      ...
    }:
    {
      environment.systemPackages = lib.optionals config.isLinux [ pkgs.ghostty ];
      homebrew.casks = lib.optionals config.isDarwin [ "ghostty" ];

      xdg.configFile."ghostty/config.ghostty".source = ./config.ghostty;
    };
}
