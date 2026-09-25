{
  config,
  lib,
  ...
}:
{
  system.activationScripts.postActivation.text = lib.mkIf config.isDarwin ''
    sudo -u ${config.user} mkdir -p "${config.home}/.ssh"
    sudo -u ${config.user} chmod 700 "${config.home}/.ssh"
    sudo -u ${config.user} ln -sfn "${./config}" "${config.home}/.ssh/config"
  '';
}

# { ... }:
# {
#   home-manager.sharedModules = [
#     {
#       programs.ssh = {
#         enable = true;
#         enableDefaultConfig = false;
#         extraOptionOverrides = {
#           IgnoreUnknown = "AddKeysToAgent,UseKeychain";
#         };

#         settings = {
#           "github.com-rizesql" = {
#             Hostname = "github.com";
#             User = "git";
#             IdentitiesOnly = true;
#             IdentityFile = "~/.ssh/git_rizesql";
#             # ExtraOptions = {
#             AddKeysToAgent = "yes";
#             UseKeychain = "yes";
#             # };
#           };

#           "github.com-codestory" = {
#             Hostname = "github.com";
#             User = "git";
#             IdentitiesOnly = true;
#             IdentityFile = "~/.ssh/git_codestory";
#             # ExtraOptions = {
#             AddKeysToAgent = "yes";
#             UseKeychain = "yes";
#             # };
#           };
#         };
#       };
#     }
#   ];
# }
