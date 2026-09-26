{
  flake.modules.nix =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (lib) mkMerge optionalAttrs;
    in
    {
      nix = {
        settings = {
          experimental-features = [
            "flakes"
            "nix-command"
            "pipe-operators"
          ];

          use-xdg-base-directories = true;
          keep-outputs = true;
          keep-derivations = true;
          auto-optimise-store = true;
          warn-dirty = false;
        };

        # channel.enable = false;
        gc = mkMerge [
          {
            options = "--delete-older-than 3d";
          }
          (optionalAttrs config.isLinux {
            automatic = true;
            dates = "weekly";
            persistent = true;
          })
        ];

        optimise.automatic = if config.isDarwin then false else true;
      };

      environment.systemPackages = with pkgs; [
        nixd
        nix-output-monitor
        nixpkgs-fmt
        nixfmt
      ];
    };
}
