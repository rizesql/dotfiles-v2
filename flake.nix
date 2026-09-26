{
  description = "rizesql's nix flake";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    flake-parts.url = "github:hercules-ci/flake-parts";
    import-tree.url = "github:vic/import-tree";
    wrappers.url = "github:BirdeeHub/nix-wrapper-modules";
  };

  outputs = inputs: inputs.flake-parts.lib.mkFlake { inherit inputs; } (inputs.import-tree ./modules);

  # outputs =
  #   inputs@{
  #     nixpkgs,
  #     nix-darwin,
  #     ...
  #   }:
  #   let
  #     inherit (builtins) readDir;
  #     inherit (nixpkgs.lib)
  #       attrsToList
  #       const
  #       groupBy
  #       listToAttrs
  #       mapAttrs
  #       nameValuePair
  #       ;

  #     lib' = nixpkgs.lib.extend (_: _: nix-darwin.lib);
  #     lib = lib'.extend <| import ./lib inputs;

  #     hostsByType =
  #       readDir ./hosts
  #       |> mapAttrs (name: const <| import ./hosts/${name} lib)
  #       |> attrsToList
  #       |> groupBy (
  #         { name, ... }: if name == "rizesql-m1" then "darwinConfigurations" else "nixosConfigurations"
  #       )
  #       |> mapAttrs (const listToAttrs);

  #     hostsConfigs =
  #       hostsByType.darwinConfigurations
  #       # // hostsByType.nixosConfigurations
  #       |> attrsToList
  #       |> map ({ name, value }: nameValuePair name value.config)
  #       |> listToAttrs;
  #   in
  #   hostsByType
  #   // hostsConfigs
  #   // {
  #     inherit lib;

  #     formatter = {
  #       x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt;
  #       x86_64-darwin = nixpkgs.legacyPackages.x86_64-darwin.nixfmt;
  #       aarch64-linux = nixpkgs.legacyPackages.aarch64-linux.nixfmt;
  #       aarch64-darwin = nixpkgs.legacyPackages.aarch64-darwin.nixfmt;
  #     };
  #   };
}
