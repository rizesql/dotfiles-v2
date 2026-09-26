{ self, inputs, ... }:
let
  user = "rizesql";
  home = "/Users/${user}";
in
{
  flake.darwinConfigurations.rizesql-m1 = inputs.nix-darwin.lib.darwinSystem {
    modules = [
      inputs.sops-nix.darwinModules.default
    ]
    ++ (with (self.modules // self.darwinModules); [
      system
      primaryUser
      homebrew
      preferences
      input
      development
      shell
      nhLaunchd
    ])
    ++ [
      {
        dotfiles.checkout = "/Users/rizesql/.dotfiles";
        networking.hostName = "rizesql-m1";
        users.users.${user} = {
          name = user;
          home = home;
          uid = 501;
        };
        users.knownUsers = [ user ];
        nix.settings.trusted-users = [ user ];
        system.stateVersion = 5;
        nixpkgs.hostPlatform = "aarch64-darwin";
      }
    ];
  };
}
