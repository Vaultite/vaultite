import { app, utilityProcess } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { KdbxClient, type Child } from "./kdbxclient.ts"

let client: KdbxClient | undefined, crashed: () => void = () => {}
export const onCrash = (fn: () => void) => { crashed = fn }
export const kdbx = () => client ??= new KdbxClient(start, () => crashed())
function start(): Child {
  const backups = path.join(app.getPath("userData"), "passwords-backups")
  const p = utilityProcess.fork(fileURLToPath(new URL("./kdbxproc.ts", import.meta.url)), [backups], { serviceName: "Vaultite passwords", stdio: "ignore" })
  return { postMessage: (m) => p.postMessage(m), onMessage: (fn) => { p.on("message", fn) }, onExit: (fn) => { p.once("exit", fn) }, kill: () => p.kill() }
}
