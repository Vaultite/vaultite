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
  }).catch(() => {})
}

export function Report() {
  useEffect(() => {
    let timer = 0
    const soon = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; try { send() } catch {} }, 1000) }
    soon()
    const stop = onAppError(soon)
    return () => { stop(); clearTimeout(timer) }
  }, [])
  return null
}
