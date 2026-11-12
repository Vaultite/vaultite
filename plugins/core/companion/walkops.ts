// QA walks (the desktop app's walk.ts keeps one): started, scratched and ended by voice or here, and once done sent as one
// job per project its items are in (the vault's project notes, else the preview or editor there), and kept in the vault.
import path from "node:path"
import type { OpCtx, Plugin } from "../../../core/plugins.ts"
import { inDesktop, OpError } from "../../../core/plugins.ts"
import { anchorText } from "../../../core/desktop/anchor.ts"
import type { Job, Where } from "./jobs.ts"
import type { Moment } from "./types.ts"
import { countText, type Project, projectFor, projectOf, type WalkItem, walkJobText, type WalkPlace } from "../../../core/desktop/walks.ts"
import type { Found, Over } from "./where.ts"
import { localStamp, localTime } from "../../../core/desktop/names.ts"
import { freeBase, ownCapture, saveFiles, vaultFileOn } from "./vaultfiles.ts"

type Jobs = { begin: (ctx: OpCtx, task: (w: Where) => Promise<string>, m: Moment | undefined, p: Record<string, unknown>) => Promise<Job>
  placeHere: (o: Over) => Promise<Found & { repo: string }> }

const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** An item as the helper sent it, kept to what it may be (its files only its own, and there). */
function itemOf(v: unknown, i: number): WalkItem | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, said = str(o.said).trim().slice(0, 2000)
  if (!said) return null
  const pl = (o.place && typeof o.place === "object" ? o.place : {}) as Record<string, unknown>, at = (o.at ?? {}) as Record<string, unknown>
  const place: WalkPlace = Object.fromEntries(Object.entries({ app: str(pl.app), appName: str(pl.appName), title: str(pl.title).slice(0, 300), url: str(pl.url).slice(0, 2000), path: str(pl.path),
    ui: str(pl.ui), under: str(pl.under).slice(0, 300), screen: str(pl.screen).slice(0, 3000), line: num(pl.line) || undefined, vaultite: pl.vaultite === true || undefined }).filter(([, x]) => x)) as WalkPlace
  const file = (f: unknown) => (ownCapture(f) ? f : "")
  const a = o.anchor && typeof o.anchor === "object" ? o.anchor as WalkItem["anchor"] : undefined
  return { n: i + 1, said, from: num(o.from), to: num(o.to), at: { x: Math.round(num(at.x)), y: Math.round(num(at.y)) }, place,
    ...(a && typeof a.label === "string" && a.label.trim() ? { anchor: { ...a, label: a.label.slice(0, 200) } } : {}),
    ...(file(o.frame) ? { frame: file(o.frame) } : {}), ...(file(o.clip) ? { clip: file(o.clip), clipMs: num(o.clipMs) } : {}) }
}

export function walkOps(plugin: Plugin, jobs: Jobs) {
  const setting = (k: string) => str(plugin.settings()[k]).trim() || str(plugin.manifest.settings?.[k]?.default)
  /** The vault's projects (type: project notes), not archived or private. */
  const projects = (): Project[] => [...plugin.vault.entries.values()].flatMap((e) => {
    if (e.type !== "project" || e.archived || e.fm?.private || !e.rel.endsWith(".md")) return []
    const p = projectOf(e.rel, String(e.item?.name || e.rel.split("/").pop()!.slice(0, -3)), (e.fm ?? {}) as Record<string, unknown>)
    return p ? [p] : []
  })

  /** Its items by project: a project note's, else a preview's or an editor's repo here (where.ts), else the rest. */
  async function grouped(items: WalkItem[]) {
    const all = projects(), groups = new Map<string, { label: string; project?: Project; found?: Found; items: WalkItem[] }>()
    // (once per place: each is a few git calls, and a walk's items mostly share a few)
    const places = new Map<string, Promise<(Found & { repo: string }) | undefined>>()
    for (const it of items) {
      const p = projectFor(it.place, all)
      let key = p ? `p:${p.note}` : "", label = p?.name ?? "", found: Found | undefined
      if (!p) {
        const o = { url: it.place.url, app: it.place.app, title: it.place.title, screen: it.place.screen, under: it.place.under }, k = JSON.stringify(o)
        if (!places.has(k)) places.set(k, jobs.placeHere(o).catch(() => undefined))
        const f = await places.get(k)
        if (f && f.from !== "vault" && f.from !== "note") { key = `d:${f.cwd}`; label = path.basename(f.cwd); found = f }
      }
      if (!key) { key = "other"; label = "other apps" }
      const g = groups.get(key) ?? { label, ...(p ? { project: p } : {}), ...(found ? { found } : {}), items: [] }
      g.items.push(it)
      groups.set(key, g)
    }
    // (the most said first; the rest last)
    return [...groups.values()].sort((a, b) => Number(a.label === "other apps") - Number(b.label === "other apps") || b.items.length - a.items.length)
  }

  /** Its files in the vault, beside its note: each item's frame and clip by its number. */
  async function save(ctx: OpCtx, items: WalkItem[], since: number) {
    const folder = setting("captures_folder").replace(/^\/+|\/+$/g, ""), base = freeBase(plugin, `${folder ? `${folder}/` : ""}${localStamp(since)} QA walk`)
    const files = items.flatMap((it) => [...(it.frame ? [{ from: it.frame, name: `${it.n}.png` }] : []), ...(it.clip ? [{ from: it.clip, name: `${it.n}.mp4` }] : [])])
    const at = new Map((await saveFiles(ctx, base, files)).map((rel, i) => [files[i].from, rel]))
    return { base, note: `${base}.md`, items: items.map((it) => ({ ...it, ...(it.frame ? { frame: at.get(it.frame)! } : {}), ...(it.clip ? { clip: at.get(it.clip)! } : {}) })) }
  }

  plugin.op({
    id: "companion.walk",
    cli: "companion walk",
    owner: "QA walks",
    summary: "A QA walk on this Mac: the user roams talking, each sentence an item tied to what their pointer was on; done sends the items as one job per project.",
    help: `Started by voice ("start a QA walk") or here; "scratch that" drops the last item, "done" sends them, "cancel the
walk" ends it sending nothing. Each item keeps their words, the thing under the pointer (role, name, what it's in) and,
with screen recording allowed, a frame and a short clip from the screen's timeline.

  vau companion walk start
  vau companion walk            (how it goes)
  vau companion walk done`,
    kind: "write",
    lock: false,
    params: { do: { type: "string", enum: ["status", "start", "scratch", "done", "cancel"], default: "status", description: "what to do" } },
    args: ["do"],
    run: async (p) => {
      if (!inDesktop()) throw new OpError("a QA walk is the desktop app's: open Vaultite on the Mac where they walk", 409)
      return await plugin.desktop("screen:walk", { do: str(p.do) || "status" }) as Record<string, unknown>
    },
    text: (r) => String(r.said ?? (r.on ? `A QA walk is on: ${countText(Number(r.items) || 0)}.` : "No QA walk is on.")),
  })

  plugin.op({
    id: "companion.walk-send",
    owner: "QA walks",
    summary: "A QA walk the user ended (the desktop app sends it): saved in the vault and handed off as one job per project its items are in.",
    kind: "write",
    lock: false,
    params: {
      items: { type: "array", required: true, description: "its items: { said, from, to, at, place, anchor, frame, clip, clipMs }" },
      since: { type: "number", description: "when it began (ms since 1970)" },
      clips: { type: "boolean", description: "whether the screen was kept (screen recording allowed)" },
    },
    run: async (p, ctx) => {
      const items = (Array.isArray(p.items) ? p.items as unknown[] : []).slice(0, 300).map(itemOf).filter((x): x is WalkItem => !!x).map((it, i) => ({ ...it, n: i + 1 }))
      if (!items.length) throw new OpError("items: a walk with nothing said")
      const since = num(p.since) || items[0].from || Date.now(), end = items.at(-1)!.to || Date.now()
      const saved = await save(ctx, items, since), byN = new Map(saved.items.map((it) => [it.n, it]))
      const sent: { label: string; items: number[]; id?: string; title?: string; why?: string }[] = []
      for (const g of await grouped(items)) {
        const its = g.items.map((it) => byN.get(it.n)!), first = g.items[0].place
        // (a project's repo is found by its GitHub page, where jobs run; else the place itself leads there)
        const m = { kind: "ask", t: Date.now(), summoned: true, ...(g.project?.repo ? { url: `https://github.com/${g.project.repo}` } : { url: first.url, app: first.app, title: first.title, screen: first.screen }) } as Moment
        const title = `QA walk: ${g.label} (${its.length})`
        try {
          const j = await jobs.begin(ctx, async (w) => walkJobText(g.label, its, since, saved.note, await vaultFileOn(plugin, w.machine), p.clips === true), m,
            { title, on: "", ...(!g.project?.repo && g.project?.path ? { cwd: g.project.path } : {}) })
          sent.push({ label: g.label, items: its.map((it) => it.n), id: j.id, title: j.title })
        } catch (e) {
          sent.push({ label: g.label, items: its.map((it) => it.n), why: (e as Error).message })
        }
      }
      const went = sent.map((s) => (s.id ? `${s.label} (${countText(s.items.length)}): the job "${s.title}" (${s.id})` : `${s.label} (${countText(s.items.length)}): not sent, ${s.why}`))
      const text = ["---", "type: note", "tags: [capture, qa-walk]", "---", "",
        `A QA walk, ${localTime(since)} to ${localTime(end)}: ${countText(items.length)}.`, "", ...went.map((w) => `- ${w}`), "",
        ...sent.flatMap((s) => [`## ${s.label}`, "", ...s.items.flatMap((n) => {
          const it = byN.get(n)!, on = it.anchor ? anchorText(it.anchor) : it.place.under ?? ""
          return [`${n}. ${it.said}${on ? ` (${on})` : ""}`, ...(it.frame ? [`   ![[${it.frame}|360]]${it.clip ? ` [[${it.clip}|clip]]` : ""}`] : it.clip ? [`   [[${it.clip}|clip]]`] : [])]
        }), ""])].join("\n")
      await ctx.api("PUT", "file", { path: saved.note, text })
      const ok = sent.filter((s) => s.id)
      const said = ok.length ? `Sent ${ok.length === 1 ? "a job" : `${ok.length} jobs`}: ${ok.map((s) => `${s.label} (${s.items.length})`).join(", ")}${ok.length < sent.length ? `; ${sent.length - ok.length} not sent` : ""}` : "Saved: no job took it"
      return { note: saved.note, said, jobs: sent }
    },
    text: (r) => `${r.said}. The walk: ${r.note}`,
  })
}
