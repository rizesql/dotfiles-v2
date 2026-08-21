{
  homebrew = {
    enable = true;

    taps = [ ];
    brews = [ ];
    casks = [
      "zed"
      "zen"
      "visual-studio-code"
      "orbstack"
      "obsidian"
    ];
    onActivation = {
      cleanup = "zap";
      extraFlags = [ "--force" ];
    };
  };
}
