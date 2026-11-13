import { isArchived, str } from "../../../core/vault.ts"
import { holdEnds } from "./hold.ts"
import { snoozedAs } from "./model.ts"
import { pushBack } from "./phone.ts"
import { firstMachine, holdNow, plugin, settings } from "./server.ts"
import { snoozed, snoozeMs } from "./snooze.ts"
import { list, put, threadOf } from "./store.ts"
import { waitsOnYou } from "./threads.ts"
import { logger } from "../../../core/plugins.ts"

const log = logger("inbox")

const WAKE = 30_000
const toldBack = new Set<string>()
export async function wake() {
  const now = Date.now()
  await holdEnds(now)
  if (holdNow(now)) return
  for (const old of list().filter((e) => e.snoozed && e.snoozed <= now)) {
    const e = put(snoozedAs(old, null)!, old, list(), true)
    if (e.nt === e.t && settings().push === "waiting" && !waitsOnYou(e)) pushBack(e.title, e.preview || e.body, { event: e.id })
  }
  const back = plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r) && r.snoozed && !toldBack.has(`${r.id}\0${r.snoozed}`) &&
    !snoozed(r.snoozed, now) && snoozeMs(r.snoozed) > now - 2 * WAKE)
  if (!back.length || !(await firstMachine())) return
  for (const r of back) { toldBack.add(`${r.id}\0${r.snoozed}`); if (!threadOf(r)) pushBack("Back in your inbox", str(r.title)) }
}

export function register() {
  const wakeTimer = setInterval(() => { if (plugin.loaded && !plugin.isOff()) void wake().catch((e) => log.error("wake", e)) }, WAKE)
  wakeTimer.unref?.()
  plugin.onUnload(() => clearInterval(wakeTimer))
}
