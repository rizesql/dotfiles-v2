{
  flake.modules.direnv = { pkgs, ... }: {
    environment.systemPackages = [ pkgs.direnv ];

    xdg.configFile."direnv/direnvrc".source = "${pkgs.nix-direnv}/share/nix-direnv/direnvrc";

    programs.fish.interactiveShellInit = ''
      if not functions -q __direnv_export_eval
        ${pkgs.direnv}/bin/direnv hook fish | source
      end
    '';
  };
}
