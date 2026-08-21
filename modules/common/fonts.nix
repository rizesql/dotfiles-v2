{ lib, pkgs, ... }:
let
  berkeley-mono = pkgs.stdenvNoCC.mkDerivation {
    pname = "berkeley-mono";
    version = "2.0";

    src = builtins.path {
      path = ../../shared/berkeley-mono;
      name = "berkeley-mono-src";
    };

    dontUnpack = true;

    installPhase = ''
      mkdir -p "$out/share/fonts/truetype" "$out/share/fonts/opentype"
      cp -r $src/*.{ttf,otf} $out/share/fonts/truetype/
    '';

    meta = with lib; {
      description = "A typeface for professionals.";
      homepage = "https://berkeleygraphics.com/typefaces/berkeley-mono/";
      platforms = platforms.all;
    };
  };

  commit-mono-rizesql = pkgs.stdenvNoCC.mkDerivation {
    pname = "commit-mono-rizesql";
    version = "1.0";

    src = builtins.path {
      path = ../../shared/commit-mono-rizesql;
      name = "commit-mono-rizesql-src";
    };

    dontUnpack = true;

    installPhase = ''
      mkdir -p "$out/share/fonts/truetype"
      cp -r $src/*.{ttf,otf} $out/share/fonts/truetype/
    '';

    meta = with lib; {
      description = "Neutral programming typeface.";
      homepage = "https://commitmono.com";
      platforms = platforms.all;
    };
  };
in
{
  fonts.packages = [
    berkeley-mono
    commit-mono-rizesql
  ];
}
