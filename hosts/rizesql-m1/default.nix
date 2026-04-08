lib:
lib.darwinSystem' (
  { lib, pkgs, ... }:
  let
    user = "rizesql";
    home = "/Users/${user}";
  in
  {
    imports = lib.collectNix ./. |> lib.remove ./default.nix;

    networking.hostName = "rizesql-m1";

    users.users.${user} = {
      name = user;
      home = home;
      shell = pkgs.fish;
      uid = 501;
    };

    users.knownUsers = [ user ];

    home-manager.users.${user}.home = {
      stateVersion = "25.11";
      homeDirectory = home;
    };

    environment.etc.nix-darwin.source = "${home}/.config/nix";
    nix.settings.trusted-users = [ user ];

    system.stateVersion = 5;
    nixpkgs.hostPlatform = "aarch64-darwin";
  }
)
