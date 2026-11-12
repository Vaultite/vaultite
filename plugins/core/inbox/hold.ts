import { stampMs } from "../../../core/plugins.ts"
import { isArchived, type Item, str } from "../../../core/vault.ts"
import { pushBack } from "./phone.ts"
import { firstMachine, type Hold, holdNow, plugin, settings } from "./server.ts"
import { snoozeMs, stampOf } from "./snooze.ts"
import { addEvent, broadcast, list } from "./store.ts"
import { waitsOnYou } from "./threads.ts"

// hold: nothing is told (toasts, notifications, the phone) until a time, then one line of what came. It's
// kept by the server and shared (core/kept.ts), so every machine's server keeps it; each sums up its own events.

export function hold(until: Date | null, label = "") {
  const was = holdNow()
  if (!until) { if (was) { plugin.keep("hold", { ...was, until: stampOf(new Date()) }, { shared: true }); broadcast() } return null }
  const h: Hold = { until: stampOf(until), from: was?.from ?? stampOf(new Date()), ...(label ? { label } : {}) }
  plugin.keep("hold", h, { shared: true })
  heldSince = h
  broadcast()
  return h
}

// hold.json from before (iCloud carried it between machines): taken in, then removed.
let lookedAt = ""

let heldSince: Hold | null = null
export async function holdEnds(now = Date.now()) {
  const h = holdNow(now)
  if (h) { heldSince = h; return }
  if (!heldSince) return
  const from = snoozeMs(heldSince.from), what = heldSince.label
  heldSince = null
  broadcast()
  const came = list().filter((e) => !e.read && e.t >= from && e.source !== "inbox")
  // (results are the vault's: the first machine counts them)
  const results = (await firstMachine()) ? plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r) && !r.session && !r.terminal && stampMs(str(r.created)) >= from).length : 0
  const n = came.length + results, waiting = came.filter(waitsOnYou).length
  if (!n) return
  const e = addEvent({ source: "inbox", kind: "info", state: "open", title: `${what ? `During ${what}` : "While on hold"}: ${n} new${waiting ? `, ${waiting} waiting on you` : ""}` })
  if (e.nt === e.t && settings().push === "waiting") pushBack(e.title, undefined, { event: e.id })
}

export function register() {
  plugin.onSync((vault) => {
    const key = `${vault.path}:${vault.settingsVersion}`
    if (lookedAt === key) return
    lookedAt = key
    let old: Item | null
    try { old = plugin.readSettings("hold") } catch { return } // (mid-sync: the next change)
    if (!old) return
    plugin.keep("hold", old, { shared: true }) // (the file is the latest word: an old app wrote it since)
    plugin.saveSettings(null, "hold")
  })
}
