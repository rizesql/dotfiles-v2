{
  flake.modules.pi =
    { pkgs, config, ... }:
    let
      repoAgent = "${config.dotfiles.checkout}/modules/features/pi/config/agent";
    in
    {
      environment.systemPackages = [
        pkgs.pi-coding-agent
        (pkgs.writeShellApplication {
          name = "pi-acp";
          runtimeInputs = [ pkgs.nodejs ];
          text = ''
            export PI_ACP_PI_COMMAND="pi"
            export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
            exec npx -y pi-acp@latest "$@"
          '';
        })
      ];

      home.file = {
        ".pi/agent/package.json".source = "${repoAgent}/package.json";
        ".pi/agent/settings.json".source = "${repoAgent}/settings.json";
        ".pi/agent/APPEND_SYSTEM.md".source = "${repoAgent}/APPEND_SYSTEM.md";
        ".pi/agent/tool-policy.json".source = "${repoAgent}/tool-policy.json";
        ".pi/agent/themes".source = "${repoAgent}/themes";
        ".pi/agent/core".source = "${repoAgent}/core";
        ".pi/agent/extensions".source = "${repoAgent}/extensions";
      };
    };
}
