{
  homebrew = {
    enable = true;

    taps = [ ];
    brews = [ ];
    casks = [
      "zed"
      "zen"
    ];
    onActivation = {
      cleanup = "zap";
      autoUpdate = true;
      upgrade = true;
    };
  };
}
