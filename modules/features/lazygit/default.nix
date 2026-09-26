{ self, inputs, ... }:
{
  flake.modules.lazygit =
    { pkgs, ... }:
    let
      lazygit = self.packages.${pkgs.stdenv.hostPlatform.system}.lazygit;
    in
    {
      environment.systemPackages = [ lazygit ];
    };

  perSystem = { pkgs, ... }: {
    packages.lazygit = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.lazygit;
        flags = {
          "--use-config-file" = ./config.yml;
        };
      }
    );
  };
}
