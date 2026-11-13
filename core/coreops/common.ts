// What the core's operations share: the user's window, the plugins that are on, and how lists read as text.
import { z } from "zod"
import type { App } from "../app.ts"
import type { OpCtx } from "../ops.ts"
import { enabled, type Plugin } from "../plugins.ts"

/** Rows as lines, or what to say when there are none. */
export const lines = (rows: string[], empty = "(none)") => (rows.length ? rows.join("\n") : empty)

const NONE = { windows: 0, workspace: null }
const Shown = z.object({ windows: z.number().catch(0), workspace: z.int().nullable().catch(null) }).catch(NONE)

/** What the user's window answers (core/live.ts passes it on): a command's run, its commands, a pick. */
export const Ran = z.object({ ran: z.boolean().optional(), notices: z.array(z.object({ text: z.string(), kind: z.string().optional() })).optional() }).loose().nullish()
export const Commands = z.array(z.object({ id: z.string(), name: z.string(), keys: z.array(z.string()).optional(), available: z.boolean().nullable().optional() }).loose())
export const Picked = z.object({ index: z.number().catch(-1), typed: z.string().nullable().catch(null) }).nullable().catch(null)

async function shown(ctx: OpCtx) {
  try { return Shown.parse(await ctx.ui(null)) } catch { return NONE }
}

/** The workspace the user's window shows, or null: no window, or no server driving one (tests, scripts). */
export const windowWorkspace = async (ctx: OpCtx): Promise<number | null> => (await shown(ctx)).workspace

/** The open windows, 0 when there's no server driving any. */
export const windowCount = async (ctx: OpCtx): Promise<number> => (await shown(ctx)).windows

/** Every plugin that's on offering service `name` (plugin.provide), in plugin order: their functions. */
export function servicesOn(app: App, name: string): Plugin["services"][string][] {
  const on = enabled(app.vault, app.plugins)
  return app.plugins.filter((p) => on.has(p.id) && Object.hasOwn(p.services, name)).map((p) => p.services[name])
}

/** The first plugin that's on offering service `name`, or null. */
export const serviceOn = (app: App, name: string) => servicesOn(app, name)[0] ?? null

/** A vault path for a URL's query string. */
export const enc = encodeURIComponent
