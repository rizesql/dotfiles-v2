{ self, ... }:
{
  flake.modules.system = {
    imports = with self.modules; [
      sys
      nix
      fonts
      pkgs
      userFiles
      shellAliases
      env
      sops
      nh
    ];
  };
}
