const hooks = new Set<() => void>()
let listening = false

export function atExit(fn: () => void): () => void {
  hooks.add(fn)
  if (!listening) {
    listening = true
    process.on?.("exit", () => {
      for (const h of hooks) {
        try { h() } catch { /* the next still runs */ }
      }
    })
  }
  return () => { hooks.delete(fn) }
}
