{
  flake.modules.nh = { config, pkgs, ... }: {
    environment.systemPackages = [ pkgs.nh ];

    environment.variables = {
      NH_FLAKE = config.dotfiles.checkout;
      NH_DARWIN_FLAKE = config.dotfiles.checkout;
    };
  };

  flake.darwinModules.nhLaunchd = { config, ... }: {
    launchd.user.envVariables = {
      NH_FLAKE = config.dotfiles.checkout;
      NH_DARWIN_FLAKE = config.dotfiles.checkout;
    };
  };
}
