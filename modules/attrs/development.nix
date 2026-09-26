{ self, ... }: {
  flake.modules.development = {
    imports = with self.modules; [
      git
      lazygit
      television
      neovim
      ssh
      pi
    ];
  };
}
