{ self, inputs, ... }:
{
  flake.modules.zellij =
    { pkgs, ... }:
    let
      zellij = self.packages.${pkgs.stdenv.hostPlatform.system}.zellij;
    in
    {
      environment.systemPackages = [ zellij ];
    };

  perSystem = { pkgs, ... }: {
    packages.zellij = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.zellij;
        env.ZELLIJ_CONFIG_DIR = "${./zellij}";
      }
    );
  };
}
