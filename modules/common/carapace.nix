{ pkgs, inputs, ... }:
let
  carapace = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.carapace;
      env.CARAPACE_BRIDGES = "zsh,fish,bash,inshellisense";
    }
  );
in
{
  environment.systemPackages = [ carapace ];
  programs.fish.interactiveShellInit = ''
    ${carapace}/bin/carapace _carapace | source
  '';
}

# { pkgs, ... }:
# {
#   environment.systemPackages = [ pkgs.carapace ];

#   environment.variables = {
#     CARAPACE_BRIDGES = "zsh,fish,bash,inshellisense";
#   };

#   programs.fish.interactiveShellInit = ''
#     ${pkgs.carapace}/bin/carapace _carapace | source
#   '';
# }
