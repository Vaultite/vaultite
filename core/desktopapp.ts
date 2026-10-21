// The desktop app's main process, asked from its server (forked with VAULTITE_DESKTOP=1, an IPC channel between them):
// the browser engine's agent calls (electron/browser/agent.ts). Elsewhere (the M1's server, a browser) there's none.
const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let next = 1
let listening = false

/** Whether this server runs in the desktop app (its browser can be asked). */
export const inDesktop = () => process.env.VAULTITE_DESKTOP === "1" && typeof process.send === "function" && process.connected

/** Ask the desktop app's browser engine `name` (an `agent:` call); fails after `ms`. */
export function desktopCall(name: string, args: unknown[], ms = 60_000): Promise<unknown> {
  if (!inDesktop()) return Promise.reject(new Error("the browser is in Vaultite's desktop app: run this where the desktop app runs (its terminals, or vau there)"))
  if (!listening) {
    listening = true
    process.on("message", (m: { type?: string; rid?: number; value?: unknown; error?: string }) => {
      if (m?.type !== "desktop:reply" || typeof m.rid !== "number") return
      const p = pending.get(m.rid)
      if (!p) return
      pending.delete(m.rid)
      clearTimeout(p.timer)
      if (typeof m.error === "string") p.fail(new Error(m.error)); else p.ok(m.value)
    })
  }
  const rid = next++
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { pending.delete(rid); fail(new Error(`the desktop app didn't answer ${name} in ${Math.round(ms / 1000)} s`)) }, ms)
    pending.set(rid, { ok, fail, timer })
    process.send!({ type: "desktop:call", rid, name, args })
  })
}
