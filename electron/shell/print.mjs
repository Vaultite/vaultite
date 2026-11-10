// The shell's fingerprint: a hash over what the installed app (its binary, Info.plist, signature, bootstrap) is built
// from, as inputs.json lists. Code built with the same one runs in this shell; another needs a new build of the app.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/** Every file under `p` (itself when a file), sorted, dot files left out. */
function files(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return [p]
  return fs.readdirSync(p).filter((n) => !n.startsWith(".")).sort().flatMap((n) => files(path.join(p, n)))
}

/** `root`'s shell fingerprint (64 hex), by the inputs its own electron/shell/inputs.json lists. Throws when one is missing. */
export function fingerprint(root) {
  const inputs = JSON.parse(fs.readFileSync(path.join(root, "electron", "shell", "inputs.json"), "utf8"))
  const h = crypto.createHash("sha256")
  for (const f of inputs.files.flatMap((rel) => files(path.join(root, rel)))) {
    h.update(`file\0${path.relative(root, f).split(path.sep).join("/")}\0`).update(fs.readFileSync(f)).update("\0")
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  for (const key of inputs.package) h.update(`package\0${key}\0${JSON.stringify(key.split(".").reduce((o, k) => o?.[k], pkg) ?? null)}\0`)
  const lock = JSON.parse(fs.readFileSync(path.join(root, inputs.electron), "utf8"))
  h.update(`electron\0${lock.packages?.["node_modules/electron"]?.version ?? ""}\0`)
  return h.digest("hex")
}
