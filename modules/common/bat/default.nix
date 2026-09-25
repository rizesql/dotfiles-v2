{ pkgs, inputs, ... }:
let
  bat = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.bat;
      flags = {
        "--config-file" = ./bat/config;
      };
    }
  );
in
{
  environment.systemPackages = [ bat ];
}
