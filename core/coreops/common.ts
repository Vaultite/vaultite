// What the core's operations share: the user's window, the plugins that are on, and how lists read as text.
import type { App } from "../app.ts"
import type { OpCtx } from "../ops.ts"
import { enabled } from "../plugins.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : [])

/** Rows as lines, or what to say when there are none. */
export const lines = (rows: string[], empty = "(none)") => (rows.length ? rows.join("\n") : empty)

/** The workspace the user's window shows (the app tells the server: core/live.ts), or null: no window, or no server
 *  driving one (tests, scripts). */
export async function windowWorkspace(ctx: OpCtx): Promise<number | null> {
  try {
    const n = (await ctx.ui(null) as Any)?.workspace
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

/** The open windows, 0 when there's no server driving any. */
export async function windowCount(ctx: OpCtx): Promise<number> {
  try { return Number((await ctx.ui(null) as Any)?.windows ?? 0) } catch { return 0 }
}

/** Every plugin that's on offering service `name` (plugin.provide), in plugin order: their functions. */
export function servicesOn(app: App, name: string): ((...a: Any[]) => Any)[] {
  const on = enabled(app.vault, app.plugins)
  return app.plugins.filter((p) => on.has(p.id) && Object.hasOwn(p.services, name)).map((p) => p.services[name] as (...a: Any[]) => Any)
}

/** The first plugin that's on offering service `name`, or null. */
export const serviceOn = (app: App, name: string) => servicesOn(app, name)[0] ?? null

/** A vault path for a URL's query string. */
export const enc = encodeURIComponent
