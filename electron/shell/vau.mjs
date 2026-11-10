// vau, the CLI, as every shim and agent config runs it: the one path that stays put. It runs the CLI of the code the app
// runs (roots.mjs picks it as boot.mjs does), with the program running this as Node (the app's executable, or node).
import path from "node:path"
import { pathToFileURL } from "node:url"
import * as roots from "./roots.mjs"

const bundle = path.resolve(import.meta.dirname, "..", "..")
const shell = roots.readShell(bundle)
// (packaged: stamped by its packager, sign.cjs; a checkout's own stamp has no appId)
const userData = roots.userDataOf(shell.productName ?? "Vaultite")
const { root } = roots.pick({ bundle, packaged: !!shell.appId, platform: process.platform, shell, env: process.env,
  uid: process.getuid?.(), store: path.join(userData, "code.noindex"), bad: roots.badRoots(roots.stateDir(userData)) })
await import(pathToFileURL(path.join(root, "bin", "vau")).href)
