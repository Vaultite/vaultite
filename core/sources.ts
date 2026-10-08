// Where a block's data comes from, recorded (not declared, so it can't drift) while its text side runs inside `traced`.
// Outside a trace every note is a no-op, so /api/render pays nothing.
import { AsyncLocalStorage } from "node:async_hooks"

export type Trace = {
  /** What it names as the files it shows (ctx.source): vault paths, or ids (paths without .md). */
  named: Set<string>
  /** Vault paths it read from disk (vault.abs): what it shows when it names nothing (a table it reads). */
  files: Set<string>
  /** Whether it read the file it's in (or the one its `file:` names): its path, frontmatter or body. */
  here: boolean
  /** Kinds' collections whose items it read (vault.items). */
  kinds: Set<string>
  /** Plugins whose settings it read (.vaultite/plugins/<id>/data.json). */
  settings: Set<string>
  /** Plugins whose cache it read (.vaultite/cache/<id>.json). */
  caches: Set<string>
  /** Plugins whose live data it used (plugin.memo). */
  live: Set<string>
}

const store = new AsyncLocalStorage<Trace>()

/** fn() run while recording what it reads; its result (or its error) and the trace. */
export async function traced<T>(fn: () => T | Promise<T>): Promise<{ out: T | null; error: unknown; trace: Trace }> {
  const trace: Trace = { named: new Set(), files: new Set(), here: false, kinds: new Set(), settings: new Set(), caches: new Set(), live: new Set() }
  try {
    return { out: await store.run(trace, fn), error: null, trace }
  } catch (error) {
    return { out: null, error, trace }
  }
}

/** Note something read, when a block is being traced. */
export function noteSource(what: "named" | "files" | "kinds" | "settings" | "caches" | "live", value: string) {
  const t = store.getStore()
  if (t && value) t[what].add(value)
}

/** A vault file read from disk (vault.abs), when a block is being traced: hidden ones are settings and caches, noted
 *  where they're read. */
export function noteRead(rel: string) {
  const t = store.getStore()
  if (t && rel && !/(^|\/)\./.test(rel)) t.files.add(rel.replace(/^\/+/, ""))
}

/** The block read the file it's in. */
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
