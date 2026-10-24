// electron-builder's config for Vaultite Nightly (npm run release:nightly, release:linux:nightly, release:win:nightly): package.json's build
// as an app of its own (id, name, icon, data, Linux package), so it installs beside Vaultite and never shares its data.
const build = require("../package.json").build

const icon = "web/public/icon-nightly-512.png"
module.exports = {
  ...build,
  appId: "app.vaultite.nightly",
  productName: "Vaultite Nightly",
  // (Electron names the Linux window class after `name`, and the .deb is the package `name`.)
  extraMetadata: { productName: "Vaultite Nightly", name: "vaultite-nightly" },
  publish: [{ provider: "generic", url: "https://vaultite.com/updates/nightly" }],
  mac: { ...build.mac, icon: "electron/mac/icon-nightly.png", artifactName: "Vaultite-Nightly-${version}-${arch}-mac.${ext}" },
  dmg: { ...build.dmg, artifactName: "Vaultite-Nightly-${arch}.${ext}" },
  linux: {
    ...build.linux, icon, executableName: "vaultite-nightly",
    desktop: { ...build.linux.desktop, entry: { ...build.linux.desktop.entry, StartupWMClass: "vaultite-nightly" } },
  },
  appImage: { ...build.appImage, artifactName: "Vaultite-Nightly-${version}-${arch}.AppImage" },
  deb: { ...build.deb, artifactName: "vaultite-nightly_${version}_${arch}.deb" },
  // (its own ProgID for .md, so uninstalling one app never takes the other's association)
  win: { ...build.win, icon: "electron/win/icon-nightly.ico", fileAssociations: build.win.fileAssociations.map((f) => ({ ...f, name: "VaultiteNightly.Markdown" })) },
  nsis: { ...build.nsis, artifactName: "Vaultite-Nightly-Setup-${version}-${arch}.${ext}" },
}
