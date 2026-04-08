{ config, lib, ... }:
{
  options = {
    os = lib.mkConst <| lib.last <| lib.splitString "-" config.nixpkgs.hostPlatform.system;
    isDarwin = lib.mkConst <| config.os == "darwin";
    isLinux = lib.mkConst <| config.os == "linux";

    user = lib.mkOption {
      type = lib.types.str;
      default = "rizesql";
      description = "Primary user of the system";
    };

    home = lib.mkOption {
      type = lib.types.str;
      default = if config.isDarwin then "/Users/${config.user}" else "/home/${config.user}";
      description = "Home directory of the primary user";
    };
  };

  config = {
    #   security.sudo = {
    #     enable = true;
    #     wheelNeedsPassword = false;
    #   };
  };
}
