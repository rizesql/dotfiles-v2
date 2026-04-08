{ config, ... }:
{
  sops = {
    age.keyFile = "${config.home}/.config/sops/age/keys.txt";
    defaultSopsFile = ../../secrets/secrets.yaml;

    secrets = {
      "git_rizesql" = {
        owner = config.user;
        path = "${config.home}/.ssh/git_rizesql";
        mode = "0400";
      };
      "git_codestory" = {
        owner = config.user;
        path = "${config.home}/.ssh/git_codestory";
        mode = "0400";
      };
    };
  };
}
