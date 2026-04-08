{ config, ... }:
{
  environment.variables = {
    EDITOR = "nvim";
    XDG_DATA_HOME = "${config.home}/.local/share";
    XDG_CONFIG_HOME = "${config.home}/.config";
    XDG_STATE_HOME = "${config.home}/.local/state";
    XDG_CACHE_HOME = "${config.home}/.cache";
    NIX_REMOTE = "daemon";
  };
}
