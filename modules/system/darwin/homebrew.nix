{
  flake.darwinModules.homebrew = {
    homebrew = {
      enable = true;
      enableFishIntegration = true;
      taps = [ ];
      brews = [ ];
      casks = [
        # "zed"
        # "zen"
        # "visual-studio-code"
        # "orbstack"
        # "obsidian"
      ];
    };
  };
}
