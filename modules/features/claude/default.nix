{ self, ... }: {
  flake.modules.claude =
    { pkgs, config, ... }:
    let
      claude-token = pkgs.writeShellApplication {
        name = "claude-token";
        text = ''
          case "$(pwd -P)/" in
            ${config.homeDirectory}/work/*)
              exec /usr/bin/security find-generic-password -s claude-token-work -w ;;
            *)
              exec cat ${config.sops.secrets.claude_token_personal.path} ;;
          esac
        '';
      };
      claude = pkgs.writeShellApplication {
        name = "claude";
        text = ''
          CLAUDE_CODE_OAUTH_TOKEN="$(${claude-token}/bin/claude-token)"
          export CLAUDE_CODE_OAUTH_TOKEN
          exec ${pkgs.claude-code}/bin/claude "$@"
        '';
      };
    in
    {
      imports = [ self.modules.claudeCredential ];
      claude.credential.required = true;
      environment.systemPackages = [
        claude-token
        claude
      ];
      # A path, not a secret, so a global variable is fine. Zed picks it up through shell_hook.
      environment.variables.CLAUDE_CODE_EXECUTABLE = "${claude}/bin/claude";
    };
}
