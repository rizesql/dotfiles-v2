{
  flake.modules.fish = { pkgs, config, ... }: {
    programs.fish = {
      enable = true;
      package = pkgs.fish;

      interactiveShellInit = ''
        if [ "$TERM" = "xterm-ghostty" ]
            eval (zellij setup --generate-auto-start fish | string collect)
        end
      '';
    };

    users.users.${config.user}.shell = pkgs.fish;
  };
}
