// Google's sign-in sees Firefox (googleagent.ts): its requests' headers here, its pages' navigator in
// googlesignin-preload.cjs, which asks the user agent once per frame on accounts.google.com.
import { ipcMain } from "electron"
import { fileURLToPath } from "node:url"
import { eachSession, onRequest } from "./engine.ts"
import { asFirefox, firefoxAgent, isSignIn, SIGN_IN } from "./googleagent.ts"

const AGENT = firefoxAgent(process.versions.chrome, process.platform)
const PRELOAD = fileURLToPath(new URL("./googlesignin-preload.cjs", import.meta.url))

onRequest("onBeforeSendHeaders", (d) => {
  if (!isSignIn(d.url) || !d.requestHeaders) return
  return { requestHeaders: asFirefox(d.requestHeaders, AGENT) }
}, undefined, undefined, [`${SIGN_IN}*`])

eachSession((s) => { s.registerPreloadScript({ type: "frame", filePath: PRELOAD }) })

ipcMain.on("vaultite:google-agent", (e) => { e.returnValue = isSignIn(e.senderFrame?.url ?? "") ? AGENT : "" })
