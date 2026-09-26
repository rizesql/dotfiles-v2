{ self, inputs, ... }: {
  flake.modules.bat =
    { pkgs, ... }:
    let
      bat = self.packages.${pkgs.stdenv.hostPlatform.system}.bat;
    in
    {
      environment.systemPackages = [ bat ];
    };

  perSystem = { pkgs, ... }: {
    packages.bat = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.bat;
        flags = {
          "--theme" = "Catppuccin Mocha";
        };
      }
    );
  };
}
