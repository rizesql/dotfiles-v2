{ self, inputs, ... }: {
  flake.modules.starship =
    { pkgs, ... }:
    let
      starship = self.packages.${pkgs.stdenv.hostPlatform.system}.starship;
    in
    {
      environment.systemPackages = [ starship ];
      programs.fish.interactiveShellInit = ''
        ${starship}/bin/starship init fish | source
      '';
    };

  perSystem = { pkgs, ... }: {
    packages.starship = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";

        package = pkgs.starship;
        env.STARSHIP_CONFIG = "${./config.toml}";
      }
    );
  };
}
