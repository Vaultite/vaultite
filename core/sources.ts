import { AsyncLocalStorage } from "node:async_hooks"

export type Trace = {
  /** What it names as the files it shows (ctx.source): vault paths, or ids (paths without .md). */
  named: Set<string>
  /** Vault paths it read from disk (vault.abs): what it shows when it names nothing (a table it reads). */
  files: Set<string>
  /** Whether it read the file it's in (or the one its `file:` names): its path, frontmatter or body. */
  here: boolean
  kinds: Set<string>
  settings: Set<string>
  caches: Set<string>
  live: Set<string>
}

const store = new AsyncLocalStorage<Trace>()

export async function traced<T>(fn: () => T | Promise<T>): Promise<{ out: T | null; error: unknown; trace: Trace }> {
  const trace: Trace = { named: new Set(), files: new Set(), here: false, kinds: new Set(), settings: new Set(), caches: new Set(), live: new Set() }
  try {
    return { out: await store.run(trace, fn), error: null, trace }
  } catch (error) {
    return { out: null, error, trace }
  }
}

export function noteSource(what: "named" | "files" | "kinds" | "settings" | "caches" | "live", value: string) {
  const t = store.getStore()
  if (t && value) t[what].add(value)
}

export function noteRead(rel: string) {
  const t = store.getStore()
  if (t && rel && !/(^|\/)\./.test(rel)) t.files.add(rel.replace(/^\/+/, ""))
}

export function noteHere() {
  const t = store.getStore()
  if (t) t.here = true
}

/** The files a block shows, named by the block (ctx.source; outside one, `source` from core/plugins.ts): items (by
 *  their id) or vault paths, lists of them too. Nothing outside a trace. */
export function source(...things: unknown[]) {
  const t = store.getStore()
  if (!t) return
  for (const x of things.flat(2)) {
    const id = typeof x === "string" ? x : x && typeof x === "object" ? (x as { id?: unknown }).id : null
    if (typeof id === "string" && id) t.named.add(id)
  }
}
