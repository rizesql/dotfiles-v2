{ ... }:
{
  home-manager.sharedModules = [
    {
      programs.atuin = {
        enable = true;
        settings = {
          enter_accept = true;
          style = "auto";
          sync_frequency = "1h";
          search_mode = "fuzzy";
          history_filter = [
            "^cl"
            "^cd"
            "^ls"
            "^lt"
          ];
        };
      };
    }
  ];
}
