import { z } from "zod"
import type { OpCtx } from "../../../core/plugins.ts"
import { paneSource, siteIn, type Target } from "../../../core/desktop/places.ts"
import { guideFor, guideLines, sitesOf } from "./guides.ts"
import { shownText } from "./shown.ts"
import { thingText } from "../../../core/desktop/uimodel.ts"
import { plugin } from "./self.ts"
import type { Mode, Moment, Excerpt } from "./types.ts"
import { guides } from "./settings.ts"
import { said, shownBy, key, personThread } from "./state.ts"
import { screenDrawing, tours } from "./windows.ts"
import { paneById, pageFor } from "./windowpanes.ts"
import { cut } from "./edits.ts"
import { closeUpText } from "./lane.ts"
import { jobs, liveEditing } from "./wiring.ts"
import { SNAPSHOT } from "./inpanes.ts"

const Snapshot = z.object({ snapshot: z.string() })
const FileText = z.object({ text: z.unknown() })
const TourRow = z.object({ id: z.string(), app: z.array(z.string()).optional(), site: z.array(z.string()).optional() })

export async function excerpts(ctx: Pick<OpCtx, "api">, ms: Moment[]) {
  const by = new Map<string, Moment[]>()
  const out: Excerpt[] = []
  for (const m of ms) if ((m.kind === "point" || m.kind === "ask") && m.pane && !out.some((e) => e.pane === m.pane)) {
    const pn = paneById(m.pane), x = pn && paneSource(pn.to)
    try {
      if (x?.kind === "terminal") out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: await plugin.ask<string>("terminal:screen", "", x.terminal, 60) })
      else if (x?.kind === "site") {
        const t = await pageFor(m.pane, "read"), r = Snapshot.parse(await plugin.desktop("agent:snapshot", t.tab))
        out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: cut(r.snapshot, SNAPSHOT) })
      }
    } catch {}
  }
  for (const m of [...ms].reverse()) if (m.path && m.scene && !out.some((e) => e.path === m.path)) out.push({ path: m.path, from: 0, to: 0, of: 0, lines: [], scene: m.scene })
  for (const m of ms) if (m.path && !m.scene && (m.kind === "ask" || m.kind === "point" || m.kind === "reply" || m.kind === "edit")) by.set(m.path, [...(by.get(m.path) ?? []), m])
  for (const [path, list] of by) {
    try {
      const read = async () => String(FileText.parse(await ctx.api("GET", `file?path=${encodeURIComponent(path)}`)).text ?? "")
      let text = await read()
      for (let i = 0; i < 8 && list.some((m) => m.kind === "ask" && m.waited !== undefined && m.text && !text.includes(m.text)); i++) { await new Promise((r) => setTimeout(r, 200)); text = await read() }
      const e = excerpt(path, text, list)
      if (e) out.push(e)
    } catch {}
  }
  return out
}
const WHOLE = 120, MOST = 160, ABOVE = 3, PARAGRAPH = 12
export function excerpt(path: string, text: string, ms: Moment[]): Excerpt | null {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const asked = ms.some((m) => m.kind !== "edit")
  const at = ms.flatMap((m) => [m.line ?? 0, ...(m.hunks ?? []).flatMap((h) => [h.line, h.line + h.added.length - 1])]).filter((n) => n > 0)
  if (!lines.length || (!at.length && !asked)) return null
  const keep = uncut(lines, ms)
  let from = 1, to = lines.length
  if (!asked || lines.length > WHOLE) {
    const pad = asked ? 40 : 6
    from = Math.max(1, Math.min(...at, lines.length) - pad)
    to = Math.min(lines.length, Math.max(...at, 1) + pad, from + MOST - 1)
  }
  return { path, from, to, of: lines.length, lines: lines.slice(from - 1, to).map((l, i) => (keep.has(from - 1 + i) ? l : cut(l, 400))) }
}

function uncut(lines: string[], ms: Moment[]) {
  const out = new Set<number>()
  const para = (i: number) => {
    let a = i, b = i
    while (a > 0 && i - a < PARAGRAPH && lines[a - 1].trim()) a--
    while (b + 1 < lines.length && b - i < PARAGRAPH && lines[b + 1].trim()) b++
    for (let k = a; k <= b; k++) out.add(k)
    return a
  }
  for (const m of ms) {
    if (m.kind === "edit" || !m.line || m.line > lines.length) continue
    let k = para(m.line - 1) - 1
    for (let n = 0; n < ABOVE && k >= 0; n++) {
      while (k >= 0 && !lines[k].trim()) k--
      if (k >= 0) k = para(k) - 1
    }
  }
  return out
}

const saidText = (id?: string) => { const n = said.find((x) => x.id === id); return n?.text ? `\n  you said: ${JSON.stringify(cut(n.text, 160))}` : "" }

export function awayIn(ms: Moment[]) {
  const m = ms.findLast((x) => x.kind === "ask" || x.kind === "point")
  return m?.app && !m.path && !m.pane && !m.ui ? (m.app === "private" ? "a private app" : appIn(m)) : ""
}
export const appIn = (m: { app?: string; appName?: string }) => (m.appName && m.appName !== m.app ? `${m.appName} (${m.app})` : m.app ?? "")

function toursHere(m: Moment) {
  const all = plugin.vault.shared("tours").flatMap((t) => TourRow.safeParse(t).data ?? [])
  const hosts = sitesOf(m), app = (awayIn([m]) || "vaultite").toLowerCase()
  return all.filter((t) => hosts.some((h) => siteIn(h, t.site ?? [])) || (t.app ?? []).some((a) => a.toLowerCase() === app)).slice(0, 8).map((t) => (/\.md$/i.test(t.id) ? t.id : `${t.id}.md`))
}

function pageJobLine(id: string) {
  const j = jobs.list().find((x) => x.id === id)
  if (!j) return `  over the page job ${id} works on: their changes there go to it; this question is yours`
  const asked = liveEditing.asksText(id), said = (j.last?.text ?? j.result?.text ?? "").replace(/\s+/g, " ").trim()
  return `  over the page job ${id} "${cut(j.title, 60)}" (${j.state}) works on: their changes there go to it, this question is yours, answer it now${asked ? `; asked live there: ${asked}` : ""}${said ? `; it said last: ${JSON.stringify(cut(said, 300))}` : ""}; more of its work (its diff, files, what it was told): companion job ${id}`
}

function reviewedLine(id: string) {
  const j = jobs.list().find((x) => x.id === id)
  const name = j ? `job ${id} "${cut(j.title, 60)}" (${j.state})` : `job ${id}`
  return `  just after they watched ${name}'s change (Show me) and read its choice card: these words are about that job, not the note, page or app behind them, unless they plainly name something else. What to change (or any feedback on it) goes to it: handoff --job ${id}, their words go with it; a question about it you answer (companion job ${id})`
}

export function momentsText(ms: Moment[], md: Mode, f: Target | null, notes: Excerpt[] = [], aware = "") {
  const guided = new Set<string>()
  const note = f?.path ? `${f.path}${f.x !== undefined ? ` at ${f.x},${f.y}` : ` at line ${f.line ?? 1}`}` : "", away = awayIn(ms)
  const head = `Mode: ${md}.${away ? ` The user is in ${away}, not Vaultite${note ? ` (Vaultite shows ${note})` : ""}.` : note ? ` The user is in ${note}.` : ""}`
  if (!ms.length) return `${head}${aware ? `\n${aware}` : ""}\nNothing yet: run vau companion next again.`
  const out = [head, ...(aware ? [aware] : [])]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : m.pane || m.ui ? ` ${m.title ? `"${m.title}" ` : ""}(${m.pane ? `pane ${m.pane}` : m.ui})${m.row ? `, row ${m.row}` : ""}`
      : m.app ? ` on screen, ${m.title ? `${JSON.stringify(m.title)} in ` : ""}${appIn(m)}${m.window ? ` (window ${m.window})` : ""}`
      : m.sx !== undefined ? ` on screen, at sx ${m.sx}, sy ${m.sy} (no window there${m.under ? "" : ", nothing Accessibility reads: see its picture"})` : ""
    if (m.kind === "change") {
      out.push(`- change in${at}: ${m.what ?? "it changed"}${m.url ? ` (${m.url})` : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      continue
    }
    if (m.kind === "watch") {
      out.push(`- watch ${m.item} "${m.title ?? ""}": ${m.what ?? "it changed"}${m.url ? ` (${m.url})` : ""}${m.text ? `\n  they asked: ${JSON.stringify(m.text)}` : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      continue
    }
    if (m.kind === "point" && !m.path && (m.pane || m.ui)) {
      out.push(`- point${at}: they pointed you here (look at this, as an ask)${m.text ? `\n  under the pointer: ${JSON.stringify(cut(m.text, 600))}` : ""}`)
      continue
    }
    const thread = m.item && (m.kind === "ask" || m.kind === "reply") && personThread(m.item) ? ` (in their comment thread ${m.item}, by the line: answer in it, companion comment --id ${m.item})` : ""
    if (m.kind === "ask") out.push(`- ask${at}${m.voice ? " (said: may hold the recognizer's slips)" : ""}${thread}${m.scene && m.find ? ` (in ${m.find})` : ""}${m.more || m.again ? " (they went on writing it: the whole line now)" : ""}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "point") out.push(`- point${at}: they pointed you here (look at this, as an ask)${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "edit") {
      out.push(`- edit${at}${m.again ? " (they went on writing: all of it now)" : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      for (const h of m.hunks ?? []) {
        out.push(`  at line ${h.line}:`)
        for (const l of h.removed) out.push(`  - ${l}`)
        for (const l of h.added) out.push(`  + ${l}`)
      }
    } else if (m.kind === "open") out.push(`- open${at}`)
    else if (m.kind === "reply" && m.bubble) out.push(`- reply to your bubble ${m.item}${at}: ${JSON.stringify(m.text ?? "")}${saidText(m.item)}`)
    else if (m.kind === "reply") out.push(`- reply to ${m.item}${at}${thread}: ${JSON.stringify(m.text ?? "")}`)
    else if (m.kind === "dismiss" && m.bubble) out.push(`- dismiss your bubble ${m.item}${at}: they closed it, ${JSON.stringify(cut(m.text ?? "", 200))}`)
    else if (m.kind === "move") out.push(m.into === "note" ? `- move${at}: they put your bubble in the note there (more for the note than a bubble), ${JSON.stringify(cut(m.text ?? "", 200))}`
      : `- move${at}: they folded what you wrote there back into a bubble (more for a bubble than the note), ${JSON.stringify(cut(m.text ?? "", 200))}`)
    else out.push(`- ${m.kind} ${m.item}${at}${m.kind === "accept" && m.to !== undefined ? ` (now ${JSON.stringify(cut(m.to, 200))})` : ""}`)
    if (m.shot) out.push(`  its picture: ${m.shot}${m.shotAt ? ` (the screen around their pointer, cropped: what its edges cut is whole on their screen; a pixel a point: its top left is sx ${m.shotAt.x}, sy ${m.shotAt.y}, so its pixel x, y is sx ${m.shotAt.x} + x, sy ${m.shotAt.y} + y${m.sx !== undefined ? `; their pointer at ${m.sx - m.shotAt.x}, ${m.sy! - m.shotAt.y} in it` : ""})` : ""}`)
    if (m.shotDown) out.push(`  its picture as the key went down: ${m.shotDown} (the screen changed while they spoke: what they meant may be only in this one${m.shotDownAt ? `; its top left is sx ${m.shotDownAt.x}, sy ${m.shotDownAt.y}` : ""})`)
    if (m.closeUp) out.push(`  ${closeUpText(m)}`)
    if (m.notices) out.push(`  Vaultite's toasts of the last minute (gone from the picture, maybe): ${m.notices}`)
    if (m.pageJob) out.push(pageJobLine(m.pageJob))
    if (m.reviewed) out.push(reviewedLine(m.reviewed))
    if (m.front === "realtime") out.push(`  asked through the realtime voice: it already told them you're looking, so answer at once, no "let me look"${m.talk?.length ? `; said before: ${m.talk.map((x) => JSON.stringify(x)).join(", ")}` : ""}`)
    if (m.under) out.push(`  under their pointer${m.sx !== undefined ? ` (sx ${m.sx}, sy ${m.sy})` : ""}${m.chrome ? ` (Vaultite's own ${m.chrome}, not what the pane shows)` : ""}: ${m.under}`)
    else if (m.chrome) out.push(`  under their pointer: Vaultite's own ${m.chrome}, not what the pane shows`)
    else if (m.sx !== undefined && m.app) out.push(`  their pointer: sx ${m.sx}, sy ${m.sy}`)
    for (const k of m.ink ?? []) out.push(`  they drew ${k.shape === "ring" ? "a ring round" : k.shape === "underline" ? "an underline under" : `a ${k.shape} over`} sx ${k.box.x}-${k.box.x + k.box.width}, sy ${k.box.y}-${k.box.y + k.box.height} (its box ${k.box.x},${k.box.y},${k.box.width},${k.box.height}): ${k.points.map((p) => p.join(",")).join(" ")}`)
    if (m.clicks?.length) out.push(`  they clicked as they spoke (each went to the app as a click; the picture may show what it did): ${m.clicks.map((c) => `${c.under ?? "something"} at sx ${c.sx}, sy ${c.sy}`).join("; ")}`)
    if (m.region) out.push(`  their box (one they drew and keep on screen; "record this" records it): sx ${m.region.x}-${m.region.x + m.region.width}, sy ${m.region.y}-${m.region.y + m.region.height}`)
    if (m.floating?.length) out.push(`  floating over the screen (another app's panel, maybe what they mean): ${m.floating.map((w) => `${w.name ? `${w.name} (${w.app})` : w.app} at sx ${w.frame.x}, sy ${w.frame.y}, ${w.frame.width}×${w.frame.height}`).join("; ")}`)
    if (m.near?.length) out.push("  near their pointer (point at one: --ax <id>):", ...m.near.map((e) => `    ${thingText(e, { frame: true })}`))
    if (m.screen) out.push("  what the window says (its Accessibility text):", ...m.screen.split("\n").slice(0, 400).map((l) => `    ${cut(l, 300)}`))
    if (m.summoned && (m.kind === "ask" || m.kind === "point") && (m.app || m.url)) {
      const g = guideFor(guides(), m)
      if (g && !guided.has(g.id)) { guided.add(g.id); out.push(...guideLines(g)) }
      else if (!g && m.app && m.app !== "private") out.push(`  no guide to ${m.app} yet (Guides/)`)
    }
    if (m.summoned && !m.tour && (m.kind === "ask" || m.kind === "point") && m.app !== "private" && !guided.has("tours")) {
      const here = toursHere(m)
      if (here.length) { guided.add("tours"); out.push(`  their tours here (companion tour): ${here.join(", ")}`) }
      const asked = tours.askable().filter((t) => !here.includes(t.path)).slice(0, 8)
      if (asked.length) { guided.add("tours"); out.push(`  their tours for anywhere (companion tour, when they ask for one in other words): ${asked.map((t) => `${t.path} (${t.ask.map((a) => JSON.stringify(a)).join(", ")})`).join("; ")}`) }
    }
  }
  for (const a of new Set(ms.flatMap((m) => (m.for && (m.kind === "ask" || m.kind === "point") ? [m.for] : [])))) {
    const up = screenDrawing.text(a), was = shownText(shownBy.get(key(a)) ?? [], Date.now(), ms.findLast((m) => m.origin)?.origin)
    if (up) out.push(up)
    if (was) out.push(was)
  }
  for (const e of notes) {
    if (e.pane) { out.push(`"${e.title ?? e.pane}" (pane ${e.pane}), what it shows now${e.text?.includes("[ref=") || /\be\d+\b/.test(e.text ?? "") ? " (refs for look --el, act)" : ""}:`, e.text ?? ""); continue }
    if (e.scene) { out.push(`${e.path}, the drawing (ids for companion draw, say --find):`, e.scene); continue }
    out.push(`${e.path}, lines ${e.from}-${e.to} of ${e.of}:`)
    e.lines.forEach((l, i) => out.push(`${String(e.from + i).padStart(4)}  ${l}`))
  }
  return out.join("\n")
}
