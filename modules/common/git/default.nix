{
  config,
  pkgs,
  lib,
  ...
}:
{
  environment.systemPackages = [
    pkgs.git
    pkgs.delta
  ];

  system.activationScripts.postActivation.text = lib.mkIf config.isDarwin ''
    sudo -u ${config.user} mkdir -p "${config.home}/.config/git"
    sudo -u ${config.user} ln -sfn "${./git/config}" "${config.home}/.config/git/config"
    sudo -u ${config.user} ln -sfn "${./git/personal.gitconfig}" "${config.home}/.config/git/personal.gitconfig"
    sudo -u ${config.user} ln -sfn "${./git/codestory.gitconfig}" "${config.home}/.config/git/codestory.gitconfig"
  '';

  environment.etc."xdg/git/config" = lib.mkIf (!config.isDarwin) {
    source = ./git/config;
  };
}
