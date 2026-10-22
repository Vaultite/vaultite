// Containers that need Touch ID (the web-viewer's `lock`): their pages don't open or show until unlocked, and lock again
// when the Mac locks or sleeps, or after a while away, like Brave's app lock. The app tells which profiles lock.
import { powerMonitor, systemPreferences } from "electron"
import { AppWindow } from "../appwindow.ts"
import { allPages, guardOpen, handle, tell } from "./engine.ts"

/** Locked away for: the Mac idle this long locks them again. */
const AWAY = 15 * 60
const locking = new Set<string>()
const unlocked = new Set<string>()
const asking = new Map<string, Promise<boolean>>()
const PROFILE = /^c-[a-z0-9]{1,24}$/

guardOpen((profile) => !locking.has(profile) || unlocked.has(profile))

function lockAll() {
  if (!unlocked.size) return
  unlocked.clear()
  for (const p of allPages()) if (locking.has(p.profile)) p.hide()
  for (const w of AppWindow.getAllWindows()) tell(w, { type: "engine:lock:locked" })
}

handle("lock:set", (_win, profiles) => {
  const list = Array.isArray(profiles) ? profiles.filter((p): p is string => typeof p === "string" && PROFILE.test(p)) : []
  const added = list.filter((p) => !locking.has(p))
  locking.clear()
  for (const p of list) locking.add(p)
  // (a container just set to lock: its open pages go behind the lock at once)
  if (added.length) {
    for (const p of allPages()) if (added.includes(p.profile)) p.hide()
    for (const w of AppWindow.getAllWindows()) tell(w, { type: "engine:lock:locked" })
  }
})
handle("lock:can", () => process.platform === "darwin" && systemPreferences.canPromptTouchID())
handle("lock:open", (_win, profile) => typeof profile === "string" && (!locking.has(profile) || unlocked.has(profile)))
handle("lock:unlock", async (_win, profile, name) => {
  if (typeof profile !== "string" || !PROFILE.test(profile)) throw new Error("not a container")
  if (!locking.has(profile) || unlocked.has(profile)) return true
  // (one question at a time: a second tab asking waits for the first's answer)
  let q = asking.get(profile)
  if (!q) {
    q = systemPreferences.promptTouchID(`open ${String(name ?? "this container").slice(0, 40)}`).then(() => { unlocked.add(profile); return true }, () => false)
      .finally(() => asking.delete(profile))
    asking.set(profile, q)
  }
  return q
})
handle("lock:lock", () => lockAll())

powerMonitor.on("lock-screen", lockAll)
powerMonitor.on("suspend", lockAll)
setInterval(() => { if (unlocked.size && powerMonitor.getSystemIdleTime() >= AWAY) lockAll() }, 60_000).unref()
