{
  pkgs,
  config,
  lib,
  ...
}:
let
  kitty = if config.isDarwin then pkgs.kitty-bin else pkgs.kitty;
  configDir = "${./kitty}";
in
{
  environment.systemPackages = [ kitty ];
  environment.variables.KITTY_CONFIG_DIRECTORY = configDir;
  launchd.user.envVariables = lib.mkIf config.isDarwin {
    KITTY_CONFIG_DIRECTORY = configDir;
  };
}
