// electron-builder's config for Vaultite Dev, the shell that runs a worktree's code (electron/dev.ts: npm run app:dev):
// an app of its own (id, name, data), so it runs beside Vaultite Main and never shares its data.
const build = require("../package.json").build

module.exports = {
  ...build,
  appId: "app.vaultite.dev",
  productName: "Vaultite Dev",
  extraMetadata: { productName: "Vaultite Dev" },
}
