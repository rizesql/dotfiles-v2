{ pkgs, inputs, ... }:
let
  yazi = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";

      package = pkgs.yazi;
      env.YAZI_CONFIG_HOME = "${./yazi}";
    }
  );
in
{
  environment.systemPackages = [ yazi ];
}
