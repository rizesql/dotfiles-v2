{ pkgs, inputs, ... }:
let
  atuin = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.atuin;
      env.ATUIN_CONFIG_DIR = "${./atuin}";
    }
  );
in
{
  environment.systemPackages = [ atuin ];
  programs.fish.interactiveShellInit = ''
    ${atuin}/bin/atuin init fish | source
  '';
}
