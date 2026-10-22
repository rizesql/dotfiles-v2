{
  flake.modules.agents = { config, ... }: {
    home.file = {
      ".agents".source = "${config.dotfiles.checkout}/modules/features/agents/agents";
    };
  };
}
