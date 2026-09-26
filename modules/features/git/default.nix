{
  flake.modules.git = { pkgs, ... }: {
    environment.systemPackages = [
      pkgs.git
      pkgs.delta
      pkgs.gh
    ];

    xdg.configFile = {
      "git/config".source = ./git/config;
      "git/personal.gitconfig".source = ./git/personal.gitconfig;
      "git/codestory.gitconfig".source = ./git/codestory.gitconfig;
    };
  };
}
