// Cloudflare's human check (Turnstile, its "Just a moment..." page) fails a plain Chrome's user agent (web.ts) in Electron,
// which it finds out, whatever the user clicks: its own requests say Electron, and it passes.
import { onRequest } from "./engine.ts"

const ELECTRON = ` Electron/${process.versions.electron}`
/** Where Cloudflare's check runs: its frame and what that loads. */
const CHECKS = ["https://challenges.cloudflare.com/*"]

onRequest("onBeforeSendHeaders", (d) => {
  if (!d.url.startsWith("https://challenges.cloudflare.com/") || !d.requestHeaders) return
  const key = Object.keys(d.requestHeaders).find((k) => k.toLowerCase() === "user-agent")
  const ua = key && d.requestHeaders[key]
  if (!ua || ua.includes(" Electron/")) return
  return { requestHeaders: { ...d.requestHeaders, [key]: ua.includes(" Safari/") ? ua.replace(" Safari/", `${ELECTRON} Safari/`) : ua + ELECTRON } }
}, undefined, undefined, CHECKS)
