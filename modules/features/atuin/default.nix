{ self, inputs, ... }: {
  flake.modules.atuin =
    { pkgs, ... }:
    let
      atuin = self.packages.${pkgs.stdenv.hostPlatform.system}.atuin;
    in
    {
      environment.systemPackages = [ atuin ];

      programs.fish.interactiveShellInit = ''
        ${atuin}/bin/atuin init fish | source
      '';
    };

  perSystem = { pkgs, ... }: {
    packages.atuin = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.atuin;
        env.ATUIN_CONFIG_DIR = "${./atuin}";
      }
    );
  };
}
