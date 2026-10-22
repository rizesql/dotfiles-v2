{ self, ... }: {
  flake.modules.shell = {
    imports = with self.modules; [
      fish
      starship
      zellij
      atuin
      zoxide
      carapace
      direnv
      bat
      yazi
      ghostty
    ];
  };
}
