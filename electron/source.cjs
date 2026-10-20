// electron-builder's config for Vaultite Main, the app built from source and updating itself from main (npm run
// app:build, app:install): an app of its own (id, name, data), so a release installs beside it, never over it.
const build = require("../package.json").build

module.exports = {
  ...build,
  appId: "app.vaultite.main",
  productName: "Vaultite Main",
  // (Electron names the Linux window class after `name`.)
  extraMetadata: { productName: "Vaultite Main", name: "vaultite-main" },
  linux: {
    ...build.linux, executableName: "vaultite-main",
    desktop: { ...build.linux.desktop, entry: { ...build.linux.desktop.entry, StartupWMClass: "vaultite-main" } },
  },
}
