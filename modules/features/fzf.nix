{ self, inputs, ... }: {
  flake.modules.fzf =
    { pkgs, ... }:
    let
      fzf = self.packages.${pkgs.stdenv.hostPlatform.system}.fzf;
    in
    {
      environment.systemPackages = [ fzf ];
      programs.fish.interactiveShellInit = ''
        ${fzf}/bin/fzf --fish | source
      '';
    };

  perSystem = { pkgs, ... }: {
    packages.fzf = inputs.wrappers.lib.wrapPackage (
      { ... }: {
        inherit pkgs;
        wrapperImplementation = "binary";
        package = pkgs.fzf;
        env.FZF_DEFAULT_COMMAND = "fd --type f --hidden --follow";
      }
    );
  };
}
