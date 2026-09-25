{ pkgs, inputs, ... }:
let
  starship = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";

      package = pkgs.starship;
      env.STARSHIP_CONFIG = "${./config.toml}";
    }
  );
in
{
  environment.systemPackages = [ starship ];
  programs.fish.interactiveShellInit = ''
    ${starship}/bin/starship init fish | source
  '';
}
