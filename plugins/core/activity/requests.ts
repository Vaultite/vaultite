import fs from "node:fs"
import type { RequestEnd, RequestStart } from "../../../core/plugins.ts"
import { lookup, whoFrom, withCaller, withSession } from "./callers.ts"
import { describe, failed, opKind } from "./describe.ts"
import { changed, naming, record } from "./events.ts"
import type { Actor, ActivityEvent } from "./model.ts"
import { MINUTE, plugin } from "./store.ts"
import { busy, timing } from "./timings.ts"

const CLAIM = 2500
const BOOT = Date.now()

type Write = { start: number; end: number; paths: string[]; event: ActivityEvent | null; failed?: boolean }
const writes: Write[] = []
// A file's clock is coarser than Date.now(), and a write may land as its answer goes.
const BEFORE = 5, AFTER = 50
const writeAt = (mtime: number) => nearest(writes.filter((x) => !x.failed), mtime) ?? nearest(writes, mtime)
// Windows' file clock runs a ms or two ahead.
function nearest(writes: Write[], mtime: number) {
  // Date.now() is whole ms: a write that ended at `end` went on until end + 1.
  const exact = writes.findLast((x) => mtime >= x.start && mtime < x.end + 1)
  if (exact) return exact
  // Linux's coarse clock dates a write just before its request began, never after one ended.
  const next = process.platform !== "win32" && writes.find((x) => mtime < x.start && x.start - mtime <= BEFORE)
  if (next) return next
  const off = (x: Write) => (mtime < x.start ? (x.start - mtime) / BEFORE : (mtime - x.end) / AFTER)
  let best: Write | undefined
  for (const x of writes) if (off(x) <= 1 && (!best || off(x) <= off(best))) best = x
  return best
}

plugin.onRequest((s) => {
  const route = s.route
  const byApp = (s.client ?? "").startsWith("app")
  const { actor, lookup: ask } = whoFrom(s)
  const write = s.method !== "GET" && s.method !== "HEAD" && !route.startsWith("activity") && !(route.startsWith("ops/") && opKind(route.slice(4)) === "read")
  const caller = ask && (write || !byApp) && !route.startsWith("activity") ? lookup(s.port).catch(() => null) : null
  const w: Write | null = write ? { start: s.t, end: Infinity, paths: [], event: null } : null
  if (w) { writes.push(w); if (writes.length > 100) writes.splice(0, writes.length - 100) }
  return (end: RequestEnd) => {
    const late = timing(s, end, actor)
    if (w) { w.end = Date.now(); w.failed = end.status >= 400 }
    const did = end.status >= 400 && !byApp && !route.startsWith("activity") ? failed(s.method, route, end)
      : describe(s.method, route, s.query, end.body, byApp || actor.kind === "you")
    if (!did) return
    const finish = (as: Actor) => {
      const paths = [...new Set([...did.paths, ...(w?.paths ?? [])])]
      const who = actingAs(as, did.by, s, paths)
      if (late) late.who = who.name
      const ev = record({ t: s.t, actor: who, action: did.action, text: did.text, paths, ...(did.action === "request" ? { wrote: [...(w?.paths ?? [])] } : {}),
        method: s.method, route, status: end.status, ms: Math.round(end.ms) })
      if (w) w.event = ev
    }
    if (caller) {
      const done = caller.then(async (c) => finish(await withSession(withCaller(actor, c))))
      naming.add(done)
      void done.finally(() => naming.delete(done))
    }
    else finish(actor)
  }
})

const typing = new Map<string, { name: string; until: number }>()
function actingAs(a: Actor, by: string | undefined, s: RequestStart, paths: string[]): Actor {
  if (by && a.kind === "agent") return { ...a, name: by }
  if (a.kind !== "you" || s.method !== "PUT" || s.route !== "file") return a
  const t = paths.length === 1 ? typing.get(paths[0]) : undefined
  return t && t.until > s.t ? { kind: "agent", name: t.name } : a
}
/** An agent types into `path` in the app for `ms` from now (0: it's done): the app's saves of it meanwhile are its. */
plugin.provide("activity:typing", (path: string, name: string, ms: number) => {
  for (const [p, t] of typing) if (t.until <= Date.now()) typing.delete(p)
  if (ms > 0) typing.set(path, { name, until: Date.now() + ms }); else typing.delete(path)
  return true
})

let unclaimed: { t: number; paths: Set<string> } | null = null
let claimTimer: ReturnType<typeof setTimeout> | null = null
const QUIET = /^(\.vaultite\/(cache|generated|artifacts)\/|\.trash\/|\.git\/)|(^|\/)\.DS_Store$/

export const recaps = { dirty: true }
export const ownWrites = new Map<string, number>()
function ownRecap(p: string) { const t = ownWrites.get(p); return t !== undefined && Date.now() - t < 10_000 }

plugin.onChange((paths) => {
  busy()
  if (!paths) return
  const now = Date.now()
  for (const p of paths) {
    if (QUIET.test(p) || ownRecap(p)) continue
    recaps.dirty = true
    let mtime: number | null = null
    try { mtime = fs.statSync(plugin.vault.abs(p)).mtimeMs } catch {}
    const w = mtime !== null
      ? writeAt(mtime)
      : writes.findLast((x) => now - (x.end + AFTER) < 1500)
    if (w) {
      if (!w.paths.includes(p)) w.paths.push(p)
      if (w.event && !w.event.paths?.includes(p)) (w.event.paths ??= []).push(p)
      if (w.event?.wrote && !w.event.wrote.includes(p)) w.event.wrote.push(p)
      if (w.event) changed(w.event)
      continue
    }
    if (mtime !== null && now - mtime > 10 * MINUTE) continue // an old file coming back (iCloud downloading it): nothing done now
    unclaimed ??= { t: now, paths: new Set() }
    unclaimed.paths.add(p)
  }
  if (unclaimed && !claimTimer) {
    claimTimer = setTimeout(() => {
      claimTimer = null
      const u = unclaimed
      unclaimed = null
      if (!u || !u.paths.size) return
      const ps = [...u.paths].sort()
      const self = u.t - BOOT < 20_000 && ps.every((p) => /^(AGENTS\.md|CLAUDE\.md|Dashboards\/|\.vaultite\/)/.test(p))
      record({ t: u.t, actor: self ? { kind: "script", name: "Vaultite" } : { kind: "disk", name: "On disk" }, action: "change",
        text: ps.length === 1 ? `Changed ${ps[0]}` : `Changed ${ps.length} files (${ps.slice(0, 3).join(", ")}${ps.length > 3 ? "..." : ""})`, paths: ps })
    }, CLAIM)
    claimTimer.unref()
  }
})

export function claim(rel: string) {
  if (unclaimed?.paths.delete(rel) && !unclaimed.paths.size) unclaimed = null
}
