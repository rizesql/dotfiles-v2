{
  flake.modules.sops = { pkgs, config, ... }: {
    environment.systemPackages = [
      pkgs.age
      pkgs.sops
    ];
    sops = {
      age.keyFile = "${config.homeDirectory}/.config/sops/age/keys.txt";
      defaultSopsFile = ../../../secrets/secrets.yaml;

      secrets = {
        "git_rizesql" = {
          owner = config.user;
          path = "${config.homeDirectory}/.ssh/git_rizesql";
          mode = "0400";
        };
        "git_codestory" = {
          owner = config.user;
          path = "${config.homeDirectory}/.ssh/git_codestory";
          mode = "0400";
        };
      };
    };
  };
}
