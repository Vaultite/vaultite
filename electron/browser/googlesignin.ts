// Google's sign-in sees Firefox (googleagent.ts): its requests' headers here, its navigator in googlesignin-preload.cjs.
import { ipcMain } from "electron"
import { fileURLToPath } from "node:url"
import { eachSession, onRequest } from "./engine.ts"
import { asFirefox, firefoxAgent, seesFirefox, SIGN_IN } from "./googleagent.ts"

const AGENT = firefoxAgent(process.versions.chrome, process.platform)
const PRELOAD = fileURLToPath(new URL("./googlesignin-preload.cjs", import.meta.url))

onRequest("onBeforeSendHeaders", (d) => {
  if (!d.requestHeaders || !seesFirefox(d.url, d.resourceType === "mainFrame" ? d.url : d.webContents?.getURL() ?? "")) return
  return { requestHeaders: asFirefox(d.requestHeaders, AGENT) }
}, undefined, undefined, [`${SIGN_IN}*`])

eachSession((s) => { s.registerPreloadScript({ type: "frame", filePath: PRELOAD }) })

ipcMain.on("vaultite:google-agent", (e) => { const f = e.senderFrame; e.returnValue = seesFirefox(f?.url ?? "", f?.top?.url ?? "") ? AGENT : "" })
