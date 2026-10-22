{ self, ... }: {
  flake.modules.development = {
    imports = with self.modules; [
      git
      lazygit
      television
      nvim
      ssh
      pi
      agents
    ];
  };
}
