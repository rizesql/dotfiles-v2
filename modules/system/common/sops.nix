{
  flake.modules.sops = { pkgs, config, ... }: {
    environment.systemPackages = [
      pkgs.age
      pkgs.sops
    ];

    sops.age.keyFile = "${config.homeDirectory}/.config/sops/age/keys.txt";
  };
}
