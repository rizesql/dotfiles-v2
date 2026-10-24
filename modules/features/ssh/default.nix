{
  flake.modules.ssh = { config, ... }: {
    home.directory.".ssh".mode = "0700";
    home.file.".ssh/config".source = ./config;

    sops.secrets = {
      "git_rizesql" = {
        sopsFile = ./secrets.yaml;
        owner = config.user;
        path = "${config.homeDirectory}/.ssh/git_rizesql";
        mode = "0400";
      };
      "git_codestory" = {
        sopsFile = ./secrets.yaml;
        owner = config.user;
        path = "${config.homeDirectory}/.ssh/git_codestory";
        mode = "0400";
      };
    };
  };
}
