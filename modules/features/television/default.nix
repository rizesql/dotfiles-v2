{ self, inputs, ... }:
{
  flake.modules.television =
    { pkgs, ... }:
    let
      television = self.packages.${pkgs.stdenv.hostPlatform.system}.television;
    in
    {
      environment.systemPackages = [ television ];

      programs.fish.interactiveShellInit = ''
        ${television}/bin/tv init fish | source
      '';
    };

  perSystem = { pkgs, ... }: {
    packages.television = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.television;
        flags = {
          "--config-file" = ./television/config.toml;
          "--cable-dir" = ./television/cable;
        };
      }
    );
  };
}
