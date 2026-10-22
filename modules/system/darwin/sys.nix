{ lib, ... }:
{
  flake.darwinModules.primaryUser = { config, ... }: {
    documentation.info.enable = false;

    system.primaryUser =
      lib.head
      <| lib.attrNames
      <| lib.filterAttrs (
        _: value: value.home != null && lib.hasPrefix "/Users" value.home
      ) config.users.users;

    system.tools.darwin-uninstaller.enable = false;
  };
}
