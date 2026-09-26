{ self, ... }: {
  flake.modules.shell = {
    imports = with self.modules; [
      fish
      starship
      zellij
      atuin
      zoxide
      carapace
      fzf
      direnv
      bat
      yazi
      ghostty
      kitty
    ];
  };
}
