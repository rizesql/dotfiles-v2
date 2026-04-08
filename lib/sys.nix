inputs: self: super:
let
  inherit (self)
    attrValues
    filter
    getAttrFromPath
    hasAttrByPath
    collectNix
    ;

  collectInputs =
    path: attrValues inputs |> filter (hasAttrByPath path) |> map (getAttrFromPath path);

  inputModulesDarwin = collectInputs [
    "darwinModules"
    "default"
  ];

  inputModulesNixOS = collectInputs [
    "nixosModules"
    "default"
  ];

  inputOverlays = collectInputs [
    "overlays"
    "default"
  ];
  overlayModule = {
    nixpkgs.overlays = inputOverlays;
  };

  modulesCommon = collectNix ../modules/common;
  modulesDarwin = collectNix ../modules/darwin;
  modulesNixOS = collectNix ../modules/nixos;

  specialArgs = inputs // {
    inherit inputs;
    lib = self;
  };
in
{
  darwinSystem' =
    module:
    super.darwinSystem {
      inherit specialArgs;

      modules = [
        module
        overlayModule
        { nixpkgs.config.allowUnfree = true; }
      ]
      ++ modulesCommon
      ++ modulesDarwin
      ++ inputModulesDarwin;
    };

  nixosSystem' =
    module:
    super.nixosSystem {
      inherit specialArgs;

      modules = [
        module
        overlayModule
        { nixpkgs.config.allowUnfree = true; }
      ]
      ++ modulesCommon
      ++ modulesNixOS
      ++ inputModulesNixOS;
    };
}
