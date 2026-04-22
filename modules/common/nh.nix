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

  environment.variables = {
    NH_FLAKE = flakePath;
    NH_DARWIN_FLAKE = flakePath;
  };

  launchd.user.envVariables = lib.mkIf config.isDarwin {
    NH_FLAKE = flakePath;
    NH_DARWIN_FLAKE = flakePath;
  };
}
