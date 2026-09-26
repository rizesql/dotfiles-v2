{
  flake.modules.sys = { config, lib, ... }: {
    options = {
      os = lib.mkOption {
        type = lib.types.str;
        default = lib.last (lib.splitString "-" config.nixpkgs.hostPlatform.system);
        description = "Target operating system";
      };

      isDarwin = lib.mkOption {
        type = lib.types.bool;
        default = config.os == "darwin";
        description = "Whether the system is Darwin";
      };

      isLinux = lib.mkOption {
        type = lib.types.bool;
        default = config.os == "linux";
        description = "Whether the system is Linux";
      };

      user = lib.mkOption {
        type = lib.types.str;
        default = "rizesql";
        description = "Primary user of the system";
      };

      homeDirectory = lib.mkOption {
        type = lib.types.str;
        default = if config.isDarwin then "/Users/${config.user}" else "/home/${config.user}";
        description = "Home directory of the primary user";
      };

      dotfiles.checkout = lib.mkOption {
        type = lib.types.str;
        description = "Mutable dotfiles checkout used by config links and nh.";
      };
    };
  };
}
