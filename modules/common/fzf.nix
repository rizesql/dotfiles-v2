{ pkgs, inputs, ... }:
let
  fzf = inputs.wrappers.lib.wrapPackage (
    { ... }: {
      inherit pkgs;
      wrapperImplementation = "binary";
      package = pkgs.fzf;
      env.FZF_DEFAULT_COMMAND = "fd --type f --hidden --follow";
    }
  );
in
{
  environment.systemPackages = [ fzf ];
  programs.fish.interactiveShellInit = ''
    ${fzf}/bin/fzf --fish | source
  '';
}

# { pkgs, ... }:
# {
#   environment.systemPackages = [ pkgs.fzf ];
#   environment.variables.FZF_DEFAULT_COMMAND = "fd --type f --hidden --follow";

#   programs.fish.interactiveShellInit = ''
#     ${pkgs.fzf}/bin/fzf --fish | source
#   '';
# }
