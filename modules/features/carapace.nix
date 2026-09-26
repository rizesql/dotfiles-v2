{ self, inputs, ... }: {
  flake.modules.carapace =
    { pkgs, ... }:
    let
      carapace = self.packages.${pkgs.stdenv.hostPlatform.system}.carapace;
    in
    {
      environment.systemPackages = [ carapace ];
      programs.fish.interactiveShellInit = ''
        ${carapace}/bin/carapace _carapace | source
      '';
    };

  perSystem = { pkgs, ... }: {
    packages.carapace = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.carapace;
        env.CARAPACE_BRIDGES = "zsh,fish,bash,inshellisense";
      }
    );
  };
}
