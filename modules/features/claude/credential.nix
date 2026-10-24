{
  flake.modules.claudeCredential = { lib, config, ... }: {
    options.claude.credential.required = lib.mkEnableOption "the personal Claude subscription token";

    config = lib.mkIf config.claude.credential.required {
      sops.secrets.claude_token_personal = {
        sopsFile = ./secrets.yaml;
        owner = config.user;
        mode = "0400";
      };
    };
  };
}
