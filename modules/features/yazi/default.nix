{ self, inputs, ... }: {
  flake.modules.yazi =
    { pkgs, ... }:
    let
      yazi = self.packages.${pkgs.stdenv.hostPlatform.system}.yazi;
    in
    {
      environment.systemPackages = [ yazi ];
    };

  perSystem = { pkgs, ... }: {
    packages.yazi = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";

        package = pkgs.yazi;
        env.YAZI_CONFIG_HOME = "${./yazi}";
      }
    );
  };
}
