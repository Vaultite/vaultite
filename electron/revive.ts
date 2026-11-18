import type { WebContents } from "electron"
import { logger } from "../core/log.ts"

const log = logger("browser")

export function revive(wc: WebContents, gone?: () => void, giveUp?: () => void) {
  let times: number[] = []
  wc.on("render-process-gone", (_e, d) => {
    if (d.reason === "clean-exit" || wc.isDestroyed()) return
    gone?.()
    const now = Date.now()
    times = times.filter((t) => now - t < 60_000)
    log.error(`a page's process ended (${d.reason}, exit ${d.exitCode}): ${times.length < 3 ? "reloading" : "left, it keeps ending"}`)
    if (times.length >= 3) return giveUp?.()
    times.push(now)
    setTimeout(() => { if (!wc.isDestroyed()) wc.reload() }, 300)
  })
}
