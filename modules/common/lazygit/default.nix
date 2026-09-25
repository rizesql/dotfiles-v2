{ pkgs, inputs, ... }:
let
  lazygit = inputs.wrappers.lib.wrapPackage (
    { ... }:
    {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.lazygit;
      flags = {
        "--use-config-file" = ./config.yml;
      };
    }
  );
in
{
  environment.systemPackages = [ lazygit ];
}
