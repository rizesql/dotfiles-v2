{ ... }:
{
  home-manager.sharedModules = [
    {
      programs.ssh = {
        enable = true;
        enableDefaultConfig = false;
        extraOptionOverrides = {
          IgnoreUnknown = "AddKeysToAgent,UseKeychain";
        };

        matchBlocks = {
          "github.com-rizesql" = {
            hostname = "github.com";
            user = "git";
            identitiesOnly = true;
            identityFile = "~/.ssh/git_rizesql";
            extraOptions = {
              AddKeysToAgent = "yes";
              UseKeychain = "yes";
            };
          };

          "github.com-codestory" = {
            hostname = "github.com";
            user = "git";
            identitiesOnly = true;
            identityFile = "~/.ssh/git_codestory";
            extraOptions = {
              AddKeysToAgent = "yes";
              UseKeychain = "yes";
            };
          };
        };
      };
    }
  ];
}
