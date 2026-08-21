{ ... }:
{
  home-manager.sharedModules = [
    {
      catppuccin = {
        enable = true;
        autoEnable = true;
        flavor = "mocha";
        accent = "blue";
      };
    }
  ];
}
