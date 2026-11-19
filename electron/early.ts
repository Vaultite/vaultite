import "../core/winspawn.ts"
import "./dockenv.ts"
import { app } from "electron"
import fs from "node:fs"
import { vaultArg } from "./argv.ts"
import { attachable } from "./host.ts"
import { CODE } from "./identity.ts"
import { ROOT } from "./mainbase.ts"
import { mainLog, openMainLog } from "./mainlog.ts"
import { refreshSandbox, sandboxPath } from "./sandbox.ts"
import { serverFor } from "./servers.ts"
import { find, known, remember } from "./vaultlist.ts"
import { refuseOwnVault } from "../core/testrun.ts"
import { logger } from "../core/log.ts"

openMainLog(app.getPath("logs"))
mainLog(`started: ${CODE?.commit.slice(0, 7) ?? "no build stamp"} from ${ROOT}`)

export const asked = () => vaultArg(process.argv)
export const reopening = () => { const a = asked(); return a ? [a] : known.filter((v) => v.open).map((v) => v.path) }

function start(p: string) {
  if (attachable(p) || !fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() || refuseOwnVault(p, "the desktop app")) return
  serverFor(find(p) ?? remember(p)).catch(() => {})
}

export let refreshed: Promise<unknown> = Promise.resolve()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  for (const p of reopening()) {
    if (p !== sandboxPath()) { start(p); continue }
    refreshed = refreshSandbox(p).then((made) => { const v = find(p); if (made && v) delete v.port }, (e) => logger("desktop").error("the sandbox wasn't refreshed", e)).then(() => start(p))
  }
}
