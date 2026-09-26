{
  flake.modules.pi = { config, pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      pi-coding-agent
      nodejs
    ];

    home.file = {
      ".pi/agent/settings.json".source = "${config.dotfiles.checkout}/.config/pi/agent/settings.json";
      ".pi/agent/themes".source = "${config.dotfiles.checkout}/.config/pi/agent/themes";
      ".pi/agent/extensions".source = "${config.dotfiles.checkout}/.config/pi/agent/extensions";
      ".pi/agent/tool-policy.json".source =
        "${config.dotfiles.checkout}/.config/pi/agent/tool-policy.json";
      ".pi/agent/core".source = "${config.dotfiles.checkout}/.config/pi/agent/core";
      ".pi/agent/package.json".source = "${config.dotfiles.checkout}/.config/pi/agent/package.json";
      ".agents".source = "${config.dotfiles.checkout}/.config/agents";
    };
  };
}
