{ pkgs, ... }:
{
  programs.fish = {
    enable = true;
    package = pkgs.fish;

    interactiveShellInit = ''
      if [ "$TERM" = "xterm-ghostty" ]
          eval (zellij setup --generate-auto-start fish | string collect)
      end
    '';
  };
}

# {
#   config,
#   lib,
#   pkgs,
#   ...
# }:
# let
#   envInit =
#     config.environment.variables
#     |> lib.mapAttrsToList (k: v: "set -gx ${k} \"${toString v}\"")
#     |> lib.concatStringsSep "\n";
# in
# {
#   programs.fish.enable = true;

#   environment.variables = {
#     STARSHIP_LOG = "error";
#     fish_greeting = "";
#   };

#   home-manager.sharedModules = [
#     {
#       programs.fish = {
#         enable = true;
#         package = pkgs.fish;
#         shellAliases = config.environment.shellAliases;
#         generateCompletions = false;

#         shellInit = ''
#           ${envInit}
#         '';

#         interactiveShellInit = ''
#           if [ "$TERM" = "xterm-ghostty" ]
#               eval (zellij setup --generate-auto-start fish | string collect)
#           end
#         '';
#       };
#     }
#   ];
# }
