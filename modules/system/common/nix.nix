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
          auto-optimise-store = true;
          warn-dirty = false;
        };

        # channel.enable = false;
        gc = mkMerge [
          {
            automatic = true;
            options = "--delete-older-than 7d";
          }
          (optionalAttrs config.isLinux {
            dates = "weekly";
            persistent = true;
          })
          (optionalAttrs config.isDarwin {
            interval = {
              Weekday = 0;
              Hour = 3;
              Minute = 0;
            };
          })
        ];

        optimise.automatic = if config.isDarwin then false else true;
      };

      environment.systemPackages = with pkgs; [
        nixd
        nix-output-monitor
        nixfmt
      ];
    };
}
