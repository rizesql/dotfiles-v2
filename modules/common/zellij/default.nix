{ pkgs, inputs, ... }:
let
  zellij = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.zellij;
      env.ZELLIJ_CONFIG_DIR = "${./zellij}";
    }
  );
in
{
  environment.systemPackages = [ zellij ];
}
# { pkgs, ... }:
# let
#   configDir = pkgs.runCommand "zellij-config" { } ''
#     mkdir -p $out/layouts
#     cp ${./config.kdl} $out/config.kdl
#     cp ${./layout.kdl} $out/layouts/default.kdl
#   '';
# in
# {
#   environment.systemPackages = [ pkgs.zellij ];
#   environment.variables.ZELLIJ_CONFIG_DIR = "${configDir}";
# }
