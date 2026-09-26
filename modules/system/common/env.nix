{
  flake.modules.env = { config, ... }: {
    environment.variables = {
      EDITOR = "nvim";
      XDG_DATA_HOME = "${config.homeDirectory}/.local/share";
      XDG_CONFIG_HOME = "${config.homeDirectory}/.config";
      XDG_STATE_HOME = "${config.homeDirectory}/.local/state";
      XDG_CACHE_HOME = "${config.homeDirectory}/.cache";
      NIX_REMOTE = "daemon";
    };
  };
}
