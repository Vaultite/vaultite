// The app's side of Errors in every window's background: the core's kept errors go to the server as they happen (and
// on load, for one that stopped the app). A report that fails is dropped.
import { useEffect } from "react"
import { appDevice as DEVICE, onAppError, takeAppErrors } from "@vaultite"

function send() {
  const errors = takeAppErrors()
  if (!errors.length) return
  const body = JSON.stringify({ device: DEVICE, errors })
  // (keepalive, to get out as the page goes, takes 64 KB at most: a bigger report is a plain request)
  void fetch("api/errors", {
    method: "POST", keepalive: body.length < 60_000,
    headers: { "Content-Type": "application/json", "X-Vaultite-Client": `app/${DEVICE}` },
    body,
  }).catch(() => { /* the server's down: they're lost, like the page */ })
}

export function Report() {
  useEffect(() => {
    let timer = 0
    const soon = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; try { send() } catch { /* never into the app */ } }, 1000) }
    soon()
    const stop = onAppError(soon)
    return () => { stop(); clearTimeout(timer) }
  }, [])
  return null
}
