// Linux's vault watcher. Node's recursive fs.watch there adds an inotify watch on every folder, .git and node_modules too,
// and a big vault runs out of them (ENOSPC): this one watches folder by folder, skipping what nobody needs to hear about.
import fs from "node:fs"
import path from "node:path"

export type TreeWatcher = { close(): void; on(event: "error", fn: (e: Error) => void): void }

/** Watch `root`'s folders but those `skip` names (vault-relative), telling `changed` each changed path, or null. */
export function watchTree(root: string, skip: (rel: string) => boolean, changed: (rel: string | null) => void): TreeWatcher {
  const watches = new Map<string, fs.FSWatcher>()
  let failed: ((e: Error) => void) | null = null
  let error: Error | null = null
  const fail = (e: Error) => { if (error) return; error = e; failed?.(e) }

  /** Watch a folder and those in it; `fresh`: it just appeared, so what's in it already (made with it) is told too. */
  function add(rel: string, fresh = false) {
    if (watches.has(rel) || error) return
    const abs = rel ? path.join(root, rel) : root
    let w: fs.FSWatcher
    try {
      w = fs.watch(abs, (event, name) => {
        if (name === null || name === undefined) return changed(rel || null)
        const child = rel ? `${rel}/${name}` : String(name)
        changed(child)
        if (event === "rename") {
          const st = fs.lstatSync(path.join(root, child), { throwIfNoEntry: false })
          if (st?.isDirectory()) { if (!skip(child)) add(child, true) } else drop(child)
        }
      })
    } catch (e) {
      // A folder gone between being listed and watched is nothing; anything else (ENOSPC) is.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || !rel) fail(e as Error)
      return
    }
    w.on("error", (e) => { if (rel && !fs.existsSync(abs)) drop(rel); else fail(e) })
    watches.set(rel, w)
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { /* gone already */ }
    for (const e of entries) {
      const sub = rel ? `${rel}/${e.name}` : e.name
      if (fresh && !skip(sub)) changed(sub)
      if (e.isDirectory() && !skip(sub)) add(sub, fresh)
    }
  }

  /** A folder gone (or moved away): its watches and its subfolders'. */
  function drop(rel: string) {
    for (const [r, w] of watches) if (r === rel || r.startsWith(rel + "/")) { w.close(); watches.delete(r) }
  }

  add("")
  return {
    close() { for (const w of watches.values()) w.close(); watches.clear() },
    on(_event, fn) { failed = fn; if (error) queueMicrotask(() => fn(error!)) },
  }
}
