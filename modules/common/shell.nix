{ pkgs, ... }:
{
  environment.shells = with pkgs; [
    fish
    bashInteractive
    zsh
  ];

  environment.shellAliases = {
    cl = "clear";
    mk = "mkdir";
    lg = "lazygit";
    cat = "bat";
    grep = "rg";
    find = "fd";
    vim = "nvim";
    v = "nvim";
    z = "zed";
    cwd = "pwd";

    l = "eza -l --icons --git -a";
    ls = "eza --icons --group-directories-first --color=always";
    ll = "eza --icons --group-directories-first -l";
    lt = "eza --tree --level=2 --icons --git";

    ".." = "cd ..";
    "..." = "cd ../..";
    "...." = "cd ../../..";
    "....." = "cd ../../../..";
    # "~" = "cd ~";
  };
}
