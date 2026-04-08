{ pkgs, config, ... }:
{
  environment.systemPackages =
    with pkgs;
    [
      neovim
      vim

      fish
      atuin
      bat
      carapace
      eza
      fd
      fzf
      jq
      just
      ripgrep
      starship
      television
      yazi
      zellij
      zoxide

      age
      sops
      direnv

      git
      gh
      lazygit
      delta

      discord
      obsidian
    ]
    ++ lib.optionals config.isDarwin [
      pam-reattach
      raycast
      orbstack
    ];
}
