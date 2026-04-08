{ inputs, ... }:
{
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    backupFileExtension = "bak";
    extraSpecialArgs = { inherit inputs; };

    sharedModules = [
      inputs.catppuccin.homeModules.catppuccin
      { xdg.enable = true; }
    ];
  };
}
