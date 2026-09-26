{
  flake.modules.userFiles =
    { config, lib, ... }:
    let
      fileEntry = lib.types.submodule {
        options.source = lib.mkOption {
          type = lib.types.either lib.types.path lib.types.str;
          description = "File or directory linked into the user's home.";
        };
      };

      homeFiles = lib.mapAttrsToList (target: entry: {
        inherit target;
        source = toString entry.source;
      }) config.home.file;

      homeDirectories = lib.mapAttrsToList (target: entry: {
        inherit target;
        inherit (entry) mode;
      }) config.home.directory;

      xdgConfigFiles = lib.mapAttrsToList (target: entry: {
        target = ".config/${target}";
        source = toString entry.source;
      }) config.xdg.configFile;

      files = homeFiles ++ xdgConfigFiles;
      targets = map (file: file.target) (files ++ homeDirectories);

      validTarget =
        target:
        target != ""
        && !(lib.hasPrefix "/" target)
        && lib.all (part: part != "" && part != "." && part != "..") (lib.splitString "/" target);

      validSource = file: lib.hasPrefix "/" file.source;

      installDirectory =
        { target, mode }:
        let
          targetPath = "${config.homeDirectory}/${target}";
          user = lib.escapeShellArg config.user;
          targetArg = lib.escapeShellArg targetPath;
        in
        ''
          sudo -u ${user} mkdir -p ${targetArg}
          sudo -u ${user} chmod ${mode} ${targetArg}
        '';

      installFile =
        { target, source }:
        let
          targetPath = "${config.homeDirectory}/${target}";
          parentPath = dirOf targetPath;
          user = lib.escapeShellArg config.user;
          targetArg = lib.escapeShellArg targetPath;
          sourceArg = lib.escapeShellArg source;
        in
        ''
          if [ ! -e ${sourceArg} ]; then
            echo "user config source does not exist: ${sourceArg}" >&2
            exit 1
          fi
          sudo -u ${user} mkdir -p ${lib.escapeShellArg parentPath}
          if [ -L ${targetArg} ]; then
            sudo -u ${user} rm ${targetArg}
          elif [ -e ${targetArg} ]; then
            echo "user config target already exists; move it before linking: ${targetArg}" >&2
            exit 1
          fi
          sudo -u ${user} ln -s ${sourceArg} ${targetArg}
        '';

      installScript =
        lib.concatMapStringsSep "\n" installDirectory homeDirectories
        + lib.concatMapStringsSep "\n" installFile files;
    in
    {
      options = {
        home.file = lib.mkOption {
          type = lib.types.attrsOf fileEntry;
          default = { };
          description = "Files linked relative to the configured home directory.";
        };

        home.directory = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule {
              options.mode = lib.mkOption {
                type = lib.types.str;
                default = "0755";
                description = "Directory permissions applied during system activation.";
              };
            }
          );
          default = { };
          description = "Directories created relative to the configured home directory.";
        };

        xdg.configFile = lib.mkOption {
          type = lib.types.attrsOf fileEntry;
          default = { };
          description = "Files linked relative to the user's XDG config directory.";
        };
      };

      config = {
        assertions = [
          {
            assertion = lib.all validTarget targets;
            message = "home.file and xdg.configFile targets must be safe relative paths.";
          }
          {
            assertion = lib.all validSource files;
            message = "home.file and xdg.configFile sources must be absolute paths.";
          }
          {
            assertion = lib.all (
              directory: builtins.match "0[0-7][0-7][0-7]" directory.mode != null
            ) homeDirectories;
            message = "home.directory modes must be four-digit octal strings.";
          }
          {
            assertion = builtins.length targets == builtins.length (lib.unique targets);
            message = "home.file, home.directory, and xdg.configFile must not share a target.";
          }
        ];

        system.activationScripts = lib.mkMerge [
          (lib.mkIf config.isLinux {
            userFiles = {
              deps = [ "users" ];
              text = installScript;
            };
          })
          (lib.mkIf config.isDarwin {
            postActivation.text = lib.mkAfter installScript;
          })
        ];
      };
    };
}
