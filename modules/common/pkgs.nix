{ pkgs, config, ... }:
{
  environment.systemPackages =
    with pkgs;
    [
      ripgrep
      fd
      jq
      just
      gh
      eza

      age
      sops

      # fish
      # atuin
      # bat
      # carapace
      # eza
      # fd
      # fzf
      # jq
      # just
      # ripgrep
      # starship
      # television
      # yazi
      # zellij
      # zoxide

      # pi-coding-agent

      # age
      # sops
      # direnv

      # git
      # gh
      # # lazygit
      # delta
    ]
    ++ lib.optionals config.isDarwin [
      pam-reattach
    ];
}
