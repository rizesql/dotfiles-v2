{
  flake.modules.kitty =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    {
      environment.systemPackages = [
        (if config.isDarwin then pkgs.kitty-bin else pkgs.kitty)
      ];

      environment.variables.KITTY_CONFIG_DIRECTORY = "${./kitty}";

      launchd.user.envVariables = lib.mkIf config.isDarwin {
        KITTY_CONFIG_DIRECTORY = "${./kitty}";
      };
    };
}
