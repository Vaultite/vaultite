// electron-builder's artifactBuildCompleted (package.json "build"): a release's dmg is signed, notarized and stapled
// like its app, so it opens with no warning even offline. Updates are the zip: the dmg isn't in latest-mac.yml.
const { execFileSync } = require("node:child_process")
const { identity, notarize } = require("./sign.cjs")

exports.default = async function dmg(context) {
  if (!process.env.VAULTITE_RELEASE || !context.file.endsWith(".dmg")) return
  execFileSync("codesign", ["--force", "--timestamp", "--sign", identity(), context.file], { stdio: "inherit" })
  notarize(context.file)
}
