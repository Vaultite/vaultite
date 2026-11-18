import "../core/winspawn.ts"
import "./dockenv.ts"
import { app } from "electron"
import fs from "node:fs"
import { vaultArg } from "./argv.ts"
import { attachable } from "./host.ts"
import { CODE } from "./identity.ts"
import { mainLog, openMainLog } from "./mainlog.ts"
import { ROOT } from "./mainbase.ts"
import { refreshSandbox, sandboxPath } from "./sandbox.ts"
import { serverFor } from "./servers.ts"
import { find, known } from "./vaultlist.ts"
import { logger } from "../core/log.ts"

openMainLog(app.getPath("logs"))
mainLog(`started: ${CODE?.commit.slice(0, 7) ?? "no build stamp"} from ${ROOT}`)

export const asked = () => vaultArg(process.argv)
export const reopening = () => { const a = asked(); return a ? [a] : known.filter((v) => v.open).map((v) => v.path) }

export let refreshed: Promise<unknown> = Promise.resolve()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const start = (p: string) => {
    const v = find(p)
    if (v && !attachable(p) && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) serverFor(v).catch(() => {})
  }
  for (const p of reopening()) {
    if (p !== sandboxPath()) { start(p); continue }
    refreshed = refreshSandbox(p).then((made) => { const v = find(p); if (made && v) delete v.port }, (e) => logger("desktop").error("the sandbox wasn't refreshed", e)).then(() => start(p))
  }
}
