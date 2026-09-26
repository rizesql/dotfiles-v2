{ lib, ... }:
{
  flake.darwinModules.primaryUser = { config, ... }: {
    system.primaryUser =
      lib.head
      <| lib.attrNames
      <| lib.filterAttrs (
        _: value: value.home != null && lib.hasPrefix "/Users" value.home
      ) config.users.users;
  };
}
