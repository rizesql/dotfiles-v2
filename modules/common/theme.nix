{ ... }:
{
  home-manager.sharedModules = [
    {
      catppuccin = {
        enable = true;
        flavor = "mocha";
        accent = "blue";
      };
    }
  ];
}
