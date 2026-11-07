// Which demo this page is: a bundle shared as a link (?bundle=gh:..., vaultite.com/b/...) gets a space of its own (its
// vault, the app's localStorage and sessionStorage, its drafts), so no bundle's page shows what another's left; the rest
// (vaultite.com's home, /demo) share the main one. boot.ts's first import: in place before any of the app reads them.

/** "" for the main demo, else the bundle's address (lowercase: GitHub's names aren't case-sensitive). */
export const SPACE = (() => {
  const b = new URLSearchParams(location.search).get("bundle")
  return b?.startsWith("gh:") ? b.toLowerCase() : ""
})()
const PREFIX = `vaultite-demo:${SPACE}|`

/** What the page keeps under `real`'s keys, as its own: each key prefixed with the space. */
function scoped(real: Storage): Storage {
  const own = () => {
    const out: string[] = []
    for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)) }
    return out
  }
  return {
    get length() { return own().length },
    key: (i: number) => own()[i] ?? null,
    getItem: (k: string) => real.getItem(PREFIX + k),
    setItem: (k: string, v: string) => real.setItem(PREFIX + k, v),
    removeItem: (k: string) => real.removeItem(PREFIX + k),
    clear: () => { for (const k of own()) real.removeItem(PREFIX + k) },
  }
}

if (SPACE) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    let real: Storage
    try { real = window[name] } catch { continue } // (storage off: the app copes as it does anywhere)
    const mine = scoped(real)
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => mine })
  }
  // Another tab's writes: only this space's are heard, under the app's own key (workspace.ts adopts another window's tabs).
  addEventListener("storage", (e) => {
    if (!e.isTrusted) return
    e.stopImmediatePropagation()
    if (e.key === null || !e.key.startsWith(PREFIX)) return
    dispatchEvent(new StorageEvent("storage", { key: e.key.slice(PREFIX.length), oldValue: e.oldValue, newValue: e.newValue, url: e.url }))
  }, true)
  // (core/drafts.ts's unsaved edits, by path: another space's vault has the same paths)
  const open = IDBFactory.prototype.open
  IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
    return open.call(this, `${name}:${SPACE}`, version)
  } as IDBFactory["open"]
}

/** Forgets what the app kept in this browser for this space (Reset): this space's keys, or the main one's `vaultite.`. */
export function forgetLocal() {
  try {
    if (SPACE) return localStorage.clear()
    for (const k of Object.keys(localStorage)) if (k.startsWith("vaultite.")) localStorage.removeItem(k)
  } catch { /* storage off: nothing kept */ }
}
