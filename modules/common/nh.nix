{
  config,
  lib,
  pkgs,
  ...
}:
let
  flakePath = "${config.home}/.dotfiles";
in
{
  environment.systemPackages = [ pkgs.nh ];

  environment.variables = lib.mkIf config.isLinux {
    NH_FLAKE = flakePath;
  };

  launchd.user.envVariables = lib.mkIf config.isDarwin {
    NH_FLAKE = flakePath;
  };
}
