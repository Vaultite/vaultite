// The server side: the .obsidian/app.json settings that apply here (settings.ts), in /api/state as `obsidian`,
// and its types.json's property types, under the vault's own (the service `property-types`: propertyTypes in core).
import fs from "node:fs"
import path from "node:path"
import { OpError, Plugin, type OpCtx } from "../../../core/plugins.ts"
import { obsidianDefaults, obsidianSettings, obsidianTypes } from "./settings.ts"

export const plugin = new Plugin(import.meta.url)

// (the offer to run its plugins, until taken or dismissed: other-apps.run-all, other-apps.offered)
plugin.state(() => ({ obsidian: obsidianSettings(plugin.vault), obsidianOffer: plugin.settings({}).offered ? null : communityIds().length || null,
  obsidianRunning: typeof plugin.service("obsidian:run") === "function" }))
plugin.provide("property-types", () => obsidianTypes(plugin.vault))

// Its settings as the defaults of the app's own (excluded files, attachments, templates, daily notes): never written.
plugin.provide("setting-defaults", () => obsidianDefaults(plugin.vault))

// A plugin that runs Obsidian's plugins themselves says so (`replaces: {"obsidian": ["*"]}`, the "runner") and offers the
// services `obsidian:originals` (those it has: id, enabled, allowed) and `obsidian:run` ({ids, on, owner}).
type Original = { id: string; enabled: boolean; allowed: boolean }
type Runner = { id: string; name: string; on: boolean; source?: string }
type Row = { id: string; name: string; here: { id: string; name: string; on: boolean }[]; directory: { id: string; name: string; source: string; installed: boolean }[]
  original: "on" | "waiting" | "off" | null }
type Listed = { id: string; name: string; tier: string; on: boolean }
type Found = { id: string; name: string; source: string; installed: string | null; replaces?: { obsidian?: string[] } }
const json = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return null } }
const obsidianOf = (m: unknown) => { const r = (m as { replaces?: { obsidian?: unknown } })?.replaces?.obsidian; return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [] }
const covers = (m: unknown, id: string) => obsidianOf(m).includes(id)
const manifest = (p: { id: string; tier: string }) => p.tier === "vault" ? json(plugin.vault.abs(`.vaultite/plugins/${p.id}/manifest.json`)) : plugin.peer(p.id)?.manifest
const communityIds = () => { const l = json(path.join(plugin.vault.path, ".obsidian", "community-plugins.json")); return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [] }

/** What's here and in the directory: plugins standing in for Obsidian's, and the runner (installed, or to install). */
async function survey(ctx: OpCtx) {
  const list = (await ctx.op("plugin.list", {})) as Listed[]
  let found: Found[] = []
  try { found = ((await ctx.op("plugin.search", {})) as { plugins: Found[] }).plugins } catch { /* the directory can't be read: the app's only */ }
  const mine = list.find((p) => covers(manifest(p), "*")), theirs = found.find((e) => e.replaces?.obsidian?.includes("*"))
  const runner: Runner | null = mine ? { id: mine.id, name: mine.name, on: mine.on } : theirs ? { id: theirs.id, name: theirs.name, on: false, source: theirs.source } : null
  const originals = runner?.on ? await plugin.ask<Original[]>("obsidian:originals", []) : []
  return { list, found, runner, originals }
}

/** The runner installed and on, its services up (a vault plugin's backend loads a moment after it's turned on). */
async function runnerUp(ctx: OpCtx, r: Runner | null) {
  if (!r) throw new OpError("nothing here runs other apps' plugins: install plugin-compat from the plugin directory (vau plugin search plugin-compat)")
  if (r.source) await ctx.op("plugin.install", { source: r.source })
  if (!r.on) await ctx.op("plugin.enable", { id: r.id })
  for (let i = 0; i < 60 && typeof plugin.service("obsidian:run") !== "function"; i++) await new Promise((ok) => setTimeout(ok, 250))
  const run = plugin.service("obsidian:run")
  if (typeof run !== "function") throw new OpError(`${r.name} is on but doesn't run yet: try again in a moment, or see vau plugins check`)
  return run as (a: { ids: string[]; on: boolean; owner: boolean }) => Promise<unknown>
}

/** Turn off what stands in for these (opt-in plugins: the app's own on by default stay), naming them. */
async function standInsOff(ctx: OpCtx, list: Listed[], ids: string[]) {
  const off = list.filter((p) => p.on && p.tier === "vault" && ids.some((id) => covers(manifest(p), id)))
  for (const p of off) await ctx.op("plugin.disable", { id: p.id })
  return off.map((p) => p.name)
}

plugin.op({
  id: "other-apps.plugins",
  summary: "The plugins the vault has on in another app, each with what stands in for it here (a plugin of the app's or one to install) and whether the original runs.",
  help: `Reads the plugins the vault has on in another app (.obsidian/community-plugins.json) and, for each, the
plugins here whose manifest says they stand in for it (\`replaces\`: {"obsidian": [its ids]}): the app's and the vault's
own (on or off), and the plugin directory's; and \`original\`: whether the plugin itself runs here (on, waiting to be
allowed, off), when a plugin that runs them is on. vau other-apps use <id> original|<plugin> picks one.

  vau other-apps plugins`,
  kind: "read",
  cli: "other-apps plugins",
  run: async (_params, ctx) => {
    const ids = communityIds()
    if (!ids.length) return []
    const { list, found, originals } = await survey(ctx)
    const dir = path.join(plugin.vault.path, ".obsidian")
    return ids.map((id): Row => {
      const o = originals.find((x) => x.id === id)
      return {
        id, name: String(json(path.join(dir, "plugins", id, "manifest.json"))?.name ?? id),
        here: list.filter((p) => covers(manifest(p), id)).map((p) => ({ id: p.id, name: p.name, on: p.on })),
        directory: found.filter((e) => e.replaces?.obsidian?.includes(id) && !list.some((p) => p.id === e.id))
          .map((e) => ({ id: e.id, name: e.name, source: e.source, installed: e.installed !== null })),
        original: !o ? null : o.enabled && o.allowed ? "on" : o.enabled ? "waiting" : "off",
      }
    })
  },
  text: (rows: Row[]) => rows.length ? rows.map((r) => `- ${r.name} (${r.id}): ` + [r.original === "on" ? "the original runs" : r.original === "waiting" ? "the original waits to be allowed: vau other-apps use " + r.id + " original" : "",
    r.here.length ? r.here.map((h) => `${h.name} (${h.id}, ${h.on ? "on" : "off"})`).join(", ")
      : r.directory.length ? r.directory.map((d) => `${d.name}, to install: vau other-apps use ${r.id} ${d.id}`).join(", ") : "nothing stands in for it here"].filter(Boolean).join("; ")).join("\n")
    : "The vault has no plugins of another app (.obsidian/community-plugins.json).",
})

plugin.op({
  id: "other-apps.use",
  summary: "Pick what does another app's plugin's job here: the original (run as it is) or a plugin standing in for it; the other is turned off.",
  help: `\`with\`: "original" runs that app's plugin itself (installing and turning on the plugin that runs them if
needed; allowed on this machine when its owner asks), "none" turns it off, or the id of a plugin standing in for it
(installed from the directory if needed). The two never both run.

  vau other-apps use dataview original
  vau other-apps use dataview dataview`,
  kind: "write",
  lock: false,
  params: { id: { type: "string", required: true, description: "the other app's plugin's id" }, with: { type: "string", required: true, description: "original, none, or a plugin's id" } },
  args: ["id", "with"],
  cli: "other-apps use",
  run: async ({ id, with: use }, ctx) => {
    const s = await survey(ctx)
    const owner = !(await ctx.refusal?.("running other apps' plugins on this machine"))
    if (use === "original") {
      const run = await runnerUp(ctx, s.runner)
      await run({ ids: [id], on: true, owner })
      return { id, using: "original", off: await standInsOff(ctx, s.list, [id]) }
    }
    if (use !== "none") {
      const here = s.list.find((p) => p.id === use && covers(manifest(p), id)), there = s.found.find((e) => e.id === use && e.replaces?.obsidian?.includes(id))
      if (!here && !there) throw new OpError(`${use} doesn't stand in for ${id} (vau other-apps plugins)`)
      if (!here && there) await ctx.op("plugin.install", { source: there.source })
      await ctx.op("plugin.enable", { id: use })
    }
    if (s.runner?.on) await (await runnerUp(ctx, s.runner))({ ids: [id], on: false, owner })
    return { id, using: use, off: s.originals.some((o) => o.id === id && o.enabled) ? ["the original"] : [] }
  },
  text: (r) => `${r.id}: ${r.using === "original" ? "the original runs" : r.using === "none" ? "off" : r.using}${r.off.length ? ` (turned off ${r.off.join(" and ")})` : ""}`,
})

plugin.op({
  id: "other-apps.run-all",
  summary: "Run the vault's plugins from another app here as they are, all at once (those a plugin of the app's already stands in for, on, stay with it).",
  kind: "write",
  lock: false,
  params: {},
  cli: "other-apps run-all",
  run: async (_params, ctx) => {
    const s = await survey(ctx)
    // (what a vault plugin stands in for, on, stays with it; the app's own on by default, like Search, run beside the original)
    const ids = communityIds().filter((id) => !s.list.some((p) => p.on && p.tier === "vault" && covers(manifest(p), id)))
    const owner = !(await ctx.refusal?.("running other apps' plugins on this machine"))
    if (ids.length) await (await runnerUp(ctx, s.runner))({ ids, on: true, owner })
    plugin.saveSettings({ ...plugin.settings({}), offered: true })
    return { running: ids, kept: communityIds().filter((id) => !ids.includes(id)), allowed: owner }
  },
  text: (r) => `Running ${r.running.length} plugins from another app${r.allowed ? "" : " (each waits for this machine's owner to allow it)"}${r.kept.length ? `; ${r.kept.length} stay with what stands in for them` : ""}.`,
})

plugin.op({
  id: "other-apps.offered",
  summary: "Don't offer again to run the vault's plugins from another app (the offer shown once when such a vault opens).",
  kind: "write",
  params: {},
  run: () => { plugin.saveSettings({ ...plugin.settings({}), offered: true }); return { offered: true } },
})

// What stands in for Obsidian's plugins, by their id: plugins here (on or off) and the directory's (for Browse).
plugin.provide("obsidian:stand-ins", async () => {
  const list = (await plugin.runOp("plugin.list", {})).result as Listed[]
  let found: Found[] = []
  try { found = ((await plugin.runOp("plugin.search", {})).result as { plugins: Found[] }).plugins } catch { /* the app's only */ }
  const out: Record<string, { id: string; name: string; on: boolean; installed: boolean }[]> = {}
  for (const p of list) for (const id of obsidianOf(manifest(p))) if (id !== "*") (out[id] ??= []).push({ id: p.id, name: p.name, on: p.on, installed: true })
  for (const e of found) for (const id of e.replaces?.obsidian ?? []) if (id !== "*" && !list.some((p) => p.id === e.id)) (out[id] ??= []).push({ id: e.id, name: e.name, on: false, installed: false })
  return out
})

// A plugin standing in for Obsidian's turned on: the original stops (they'd draw the same).
plugin.around("plugin.enable", async (call, next) => {
  const r = await next(call.params)
  const id = String((call.params as { id?: string }).id ?? "")
  const p = ((await call.ctx.op("plugin.list", {})) as Listed[]).find((x) => x.id === id)
  const ids = p && p.tier === "vault" ? obsidianOf(manifest(p)).filter((x) => x !== "*") : []
  const run = plugin.service("obsidian:run")
  if (ids.length && typeof run === "function") await (run as (a: unknown) => Promise<unknown>)({ ids, on: false, owner: false })
  return r
})
