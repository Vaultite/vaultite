{
  description = "Vaultite: a local knowledge base over a vault of Markdown files";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs:
        let
          nodejs = pkgs.nodejs_24; # needs >= 23.6: the server runs .ts files directly
          electron = pkgs.electron_45;
          version = (lib.importJSON ./package.json).version;

          # Machine-local state (trust, caches, file history) defaults to <app>/data, which is
          # the read-only store here. Use the folder a packaged release uses instead:
          # <userData>/local, i.e. ~/.config/Vaultite/local, unless VAULTITE_LOCAL is set.
          localDir = ''export VAULTITE_LOCAL="''${VAULTITE_LOCAL:-''${VAULTITE_USER_DATA:-''${XDG_CONFIG_HOME:-$HOME/.config}/Vaultite}/local}"'';

          meta = {
            description = "Local knowledge base you and your AI write together, in plain Markdown files";
            homepage = "https://vaultite.com";
            license = lib.licenses.asl20;
            platforms = lib.platforms.linux;
          };
        in
        rec {
          default = vaultite;

          # The server and vau, without Electron.
          server = pkgs.buildNpmPackage {
            pname = "vaultite-server";
            inherit version nodejs;
            src = lib.cleanSource ./.;

            # Bump after package-lock.json changes: `nix build .#server` fails saying the new one ("got:").
            npmDepsHash = "sha256-tcqzjIw4DucRbliLOycyKNt026AmG2JO1wLffbWTqRQ=";
            npmDepsFetcherVersion = 2;

            # Nothing here runs Electron: the desktop app uses nixpkgs' (below).
            env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            # The repo's .npmrc already disables install scripts; keep it explicit.
            npmFlags = [ "--ignore-scripts" ];
            makeCacheWritable = true;

            # .npmrc's min-release-age makes npm fetch registry metadata to check publish dates,
            # which the sandbox can't; the lockfile already pins every version.
            postPatch = ''
              sed -i '/^min-release-age/d;/^allow-git/d' .npmrc
            '';

            nativeBuildInputs = [ pkgs.makeWrapper ];

            # `npm run build`: tsc -b and the Vite build of the web app.
            npmBuildScript = "build";

            installPhase = ''
              runHook preInstall

              npm prune --omit=dev --ignore-scripts --no-audit --no-fund
              # The Claude Code the agent SDK bundles (300 MB, no release ships it): chats run the user's own.
              rm -rf node_modules/@anthropic-ai/claude-agent-sdk-*

              mkdir -p $out/share/vaultite
              cp -r . $out/share/vaultite
              rm -rf $out/share/vaultite/{.git,ios,android,screenshots}

              makeWrapper ${nodejs}/bin/node $out/bin/vau \
                --run ${lib.escapeShellArg localDir} \
                --add-flags $out/share/vaultite/bin/vau
              makeWrapper ${nodejs}/bin/node $out/bin/vaultite-server \
                --run ${lib.escapeShellArg localDir} \
                --add-flags $out/share/vaultite/server.ts

              runHook postInstall
            '';

            meta = meta // { mainProgram = "vaultite-server"; };
          };

          # The desktop app (Electron main: electron/shell/boot.mjs) over that server, with vau.
          vaultite = pkgs.stdenvNoCC.mkDerivation {
            pname = "vaultite";
            inherit version;
            dontUnpack = true;
            nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];

            installPhase = ''
              runHook preInstall

              makeWrapper ${electron}/bin/electron $out/bin/vaultite \
                --run ${lib.escapeShellArg localDir} \
                --add-flags ${server}/share/vaultite \
                --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}" \
                --set ELECTRON_IS_DEV 0 \
                --inherit-argv0
              ln -s ${server}/bin/vau ${server}/bin/vaultite-server $out/bin/

              install -Dm644 ${./web/public/icon-512.png} $out/share/icons/hicolor/512x512/apps/vaultite.png

              runHook postInstall
            '';

            desktopItems = [
              (pkgs.makeDesktopItem {
                name = "vaultite";
                desktopName = "Vaultite";
                exec = "vaultite %U";
                icon = "vaultite";
                categories = [ "Office" ];
                mimeTypes = [ "text/markdown" "x-scheme-handler/vaultite" ];
                startupWMClass = "vaultite";
              })
            ];

            meta = meta // { mainProgram = "vaultite"; };
          };
        });

      apps = lib.mapAttrs
        (_: packages: lib.genAttrs [ "default" "server" ] (name: {
          type = "app";
          program = lib.getExe packages.${name};
          inherit (packages.${name}) meta;
        }))
        self.packages;

      devShells = forAllSystems (pkgs:
        let
          electron = pkgs.electron_45;
          # `npm run app` flips a fuse in Electron's binary in place, which can't touch the
          # read-only store copy: run the checkout with nixpkgs' Electron directly instead.
          vaultite-dev = pkgs.writeShellScriptBin "vaultite-dev" ''
            root=$(git rev-parse --show-toplevel)
            if [ ! -d "$root/web/dist" ]; then (cd "$root" && npm run build) || exit; fi
            exec ${electron}/bin/electron "$root" "$@"
          '';
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              electron
              vaultite-dev
              pkgs.python3 # node-gyp, if node-pty ever needs a rebuild
              pkgs.git
            ];
            # `npm ci` won't download Electron; anything asking the electron package for its
            # binary gets nixpkgs' one.
            ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            ELECTRON_OVERRIDE_DIST_PATH = "${electron}/libexec/electron";
            shellHook = ''
              echo "vaultite dev shell: node $(node --version), electron ${electron.version}"
              echo "  npm ci && npm run build          install and build"
              echo "  vaultite-dev [--vault <path>]    the desktop app from this checkout"
              echo "  npm start / npm test / npm run check / npm run smoke"
            '';
          };
        });
    };
}
