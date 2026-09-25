{ pkgs, inputs, ... }:
let
  television = inputs.wrappers.lib.wrapPackage (
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
in
{
  environment.systemPackages = [ television ];

  programs.fish.interactiveShellInit = ''
    ${television}/bin/tv init fish | source
  '';
}
