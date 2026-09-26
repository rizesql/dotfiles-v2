{
  flake.modules.pkgs =
    {
      pkgs,
      config,
      lib,
      ...
    }:
    {
      environment.systemPackages =
        with pkgs;
        [
          ripgrep
          fd
          jq
          eza
        ]
        ++ lib.optionals config.isDarwin [
          pam-reattach
        ];
    };
}
