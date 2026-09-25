{
  config,
  pkgs,
  lib,
  ...
}:
let
  ghostty = if config.isDarwin then pkgs.ghostty-bin else pkgs.ghostty;
in
{
  environment.systemPackages = [ ghostty ];

  system.activationScripts.postActivation.text = lib.mkIf config.isDarwin ''
    sudo -u ${config.user} mkdir -p "${config.home}/.config/ghostty"
    sudo -u ${config.user} ln -sfn "${./config.ghostty}" "${config.home}/.config/ghostty/config"
  '';

  environment.etc."xdg/ghostty/config" = lib.mkIf (!config.isDarwin) {
    source = ./config.ghostty;
  };
}
