{
  flake.modules.ssh = {
    home.directory.".ssh".mode = "0700";
    home.file.".ssh/config".source = ./config;
  };
}
