import type { OpCtx } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import { paneSource, placeText, siteIn, type Target } from "../../../core/desktop/places.ts"
import { guideFor, guideLines, sitesOf } from "./guides.ts"
import { shownText } from "./shown.ts"
import { thingText } from "../../../core/desktop/uimodel.ts"
import { AS, PLACE, target, who } from "./args.ts"
import { plugin } from "./self.ts"
import type { Mode, Moment, Note, Excerpt } from "./types.ts"
import { guides, sayMs, wakes, str, mode } from "./settings.ts"
import { moments, seq, delivered, handed, asking, waiters, agents, seen, ends, dead, watching, notes, said, timers, did, shownBy, showed, acting, broadcast, key, isMain, meantFor, focus, placeOf, batches, agentOf, ROOTS, setAgent, putNote, personThread, dropNote } from "./state.ts"
import { keepSaid } from "./comments.ts"
import { screenDrawing, tours } from "./windows.ts"
import { paneById, headAware, pageFor, resolve } from "./windowpanes.ts"
import { streams, toolUse, answering, cut } from "./edits.ts"
import { session, writeSession, ASK_AGAIN, handing, fresh, due, handOver } from "./alwayson.ts"
import { closeUpText } from "./lane.ts"
import { jobs, liveEditing } from "./wiring.ts"
import { SNAPSHOT } from "./inpanes.ts"

plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you, a line with your @name (it stays in their note), @claude in a comment of theirs or Ask
companion (answer in that thread, companion comment --id). Always answer. edit: lines they changed after a pause (pair
mode): answer what's meant for you, @name or not; writing to themselves, pass. point: an ask without words (they held
your Talk key and drew or pointed): look there and answer, as for an ask. open: the note they went to, with the next moment. reply,
accept, reject, dismiss: their answer to your comment, suggestion or bubble. move: they moved your words, a bubble into
the note or what you wrote back into a bubble: a hint for next time. Lines count from 1 with the frontmatter. Asks,
replies and edits come with the note's text around them, numbered: no need to read it again. While you wait your cursor
rests; given moments, it shows you reading (thinking, for an ask) there until you act, or run this again: the user sees
a seen tick (companion pass says why). Run it again after acting, forever. With several agents (--as), each gets the
asks to its @name and answers to its items; edit and open go to the companion, or to an agent with --watch.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
    watch: { type: "boolean", description: "also get edit and open moments (pair mode), which only the companion gets otherwise" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
  },
  run: async (p, ctx) => {
    const name = who(p), k = key(name), era = ends.get(k)
    const over = () => ({ mode: mode(), focus: null, moments: [], cursor: delivered.get(k) ?? 0, notes: [], ended: true })
    // (from a session that ended, sent before it did: no cursor comes back for it)
    if (p.terminal && dead.has(p.terminal)) return over()
    seen.set(k, Date.now())
    if (p.watch) watching.add(k)
    else watching.delete(k)
    did(name, "next")
    const joined = !agents.has(k), a = agentOf(name)
    // (back without acting on what it was handed: it let it pass, which the user sees as a tick)
    asking.delete(k)
    if (handed.has(k)) setAgent(name, { state: "watching", seen: true })
    else if (joined || a.state === "away" || a.state === "writing" || a.state === "thinking" || a.state === "starting") setAgent(name, { state: "watching" })
    const after = p.after ?? delivered.get(k) ?? Math.max(0, seq - 20)
    const pending = () => pendingFor(name, after)
    let got = pending()
    // (nothing but opens (and what rides along) waiting: the moment to hand over, if it's due)
    const sess = !got.some(wakes) ? session(name) : null
    const handover = () => {
      fresh.delete(k); handing.set(k, Date.now())
      did(name, "asked to hand over")
      return { mode: mode(), focus: focus(), moments: [], cursor: after, notes: [], handover: true, as: isMain(name) ? "" : name }
    }
    if (sess && (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(sess)))) return handover()
    // (opens alone wait for the next moment, which they come with)
    if (!got.some(wakes) && p.timeout > 0) {
      waiters.get(k)?.([])
      const woken = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(k) === wake) waiters.delete(k); resolve(false) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m.length > 0) }
        waiters.set(k, wake)
      })
      // (its session ended while it waited)
      if (ends.get(k) !== era) return over()
      got = woken ? pending() : []
      seen.set(k, Date.now())
      // (woken to start fresh)
      if (!got.length && fresh.has(k) && session(name)) return handover()
    }
    if (got.length) got = hand(name, got)
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(k) ?? after, notes: await excerpts(ctx, got), ...(got.length && headAware(name) ? { aware: headAware(name) } : {}) }
  },
  text: (r) => (r.ended ? "Your session has ended: stop here, without running next again." : r.handover ? handoverAsk(r.as) : momentsText(r.moments, r.mode, r.focus, r.notes, r.aware)),
})

/** The moments for agent `name` after moment `after` (of the last half hour). */
export const pendingFor = (name: string, after = delivered.get(key(name)) ?? Math.max(0, seq - 20)) =>
  moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000 && meantFor(m, name))

/** Moments given to agent `name` (by its `next`, or as its chat session's message): counted on its session, its cursor
 *  reading them (thinking, for an ask) where the last is, until it acts or comes back for more. */
export function hand(name: string, got: Moment[]) {
  const k = key(name)
  delivered.set(k, got[got.length - 1].seq)
  // (of the notes they went to, the last one)
  got = got.filter((m, i) => m.kind !== "open" || !got.slice(i + 1).some((x) => x.kind === "open"))
  const s = session(name)
  if (s) { try { writeSession({ ...s, handed: (s.handed ?? 0) + got.length }) } catch { /* as it was */ } }
  did(name, "handed", got.map((m) => m.seq))
  batches.set(k, got.map((m) => m.seq))
  const at = [...got].reverse().find((m) => m.path || m.pane || m.ui), asked = got.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply")
  if (asked) asking.add(k)
  setAgent(name, { state: asked ? "thinking" : "reading", ...(at ? placeOf(at) : {}) })
  handed.add(k)
  return got
}

export const handoverAsk = (as: string, chat = false) => `Time for a fresh session: this one has grown long. In a few lines, write what the next one should know (what the user is working on, what they asked you to keep in mind, anything you promised), then ${chat ? "call your handover tool with those lines" : `run \`vau companion handover${as ? ` --as ${as}` : ""} "<those lines>"\``}. It starts the new session, which takes over your cursor and threads; then end your turn.`

plugin.op({
  id: "companion.handover",
  cli: "companion handover",
  summary: "Hand over to a fresh session (when next asks you to): it starts with your summary and open threads; then end your turn.",
  help: `  vau companion handover "Alice is planning the Lisbon trip; I promised to check the budget note tomorrow."`,
  kind: "write",
  lock: false,
  params: { summary: { type: "string", description: "what the next session should know, in a few lines" }, as: AS },
  args: ["summary"],
  run: async (p, ctx) => await handOver(ctx, who(p), str(p.summary)),
  text: (r) => `Handed over to ${r.id}: end your turn now.`,
})

/** The text around what the user asked or wrote, per note: all of a short note for an ask or a reply. */
export async function excerpts(ctx: OpCtx, ms: Moment[]) {
  const by = new Map<string, Moment[]>()
  const out: Excerpt[] = []
  // (a pane pointed at: what it shows now, the look; never for a change, which has its lines)
  for (const m of ms) if ((m.kind === "point" || m.kind === "ask") && m.pane && !out.some((e) => e.pane === m.pane)) {
    const pn = paneById(m.pane), x = pn && paneSource(pn.to)
    try {
      if (x?.kind === "terminal") out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: await plugin.ask<string>("terminal:screen", "", x.terminal, 60) })
      else if (x?.kind === "site") {
        const t = await pageFor(m.pane, "read"), r = await plugin.desktop("agent:snapshot", t.tab) as { snapshot: string }
        out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: cut(r.snapshot, SNAPSHOT) })
      }
    } catch { /* not readable now: the moment says where */ }
  }
  // (a drawing: its scene as the window that sent the moment saw it, the last one)
  for (const m of [...ms].reverse()) if (m.path && m.scene && !out.some((e) => e.path === m.path)) out.push({ path: m.path, from: 0, to: 0, of: 0, lines: [], scene: m.scene })
  for (const m of ms) if (m.path && !m.scene && (m.kind === "ask" || m.kind === "point" || m.kind === "reply" || m.kind === "edit")) by.set(m.path, [...(by.get(m.path) ?? []), m])
  for (const [path, list] of by) {
    try {
      const read = async () => String((await ctx.api("GET", `file?path=${encodeURIComponent(path)}`) as { text?: unknown }).text ?? "")
      let text = await read()
      // (an ask typed in the note, `waited`: the window's autosave lands a moment after it went)
      for (let i = 0; i < 8 && list.some((m) => m.kind === "ask" && m.waited !== undefined && m.text && !text.includes(m.text)); i++) { await new Promise((r) => setTimeout(r, 200)); text = await read() }
      const e = excerpt(path, text, list)
      if (e) out.push(e)
    } catch { /* gone, or not text */ }
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

/** The lines (from 0) read whole: the paragraph an ask, a point or a reply is in, and the few paragraphs just above it
 *  ("read this and the previous three"); other long lines are cut. */
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

/** A bubble's words, as a moment about it quotes them. */
const saidText = (id?: string) => { const n = said.find((x) => x.id === id); return n?.text ? `\n  you said: ${JSON.stringify(cut(n.text, 160))}` : "" }

/** The app the latest ask or point of `ms` was made in, when that's another app than Vaultite (on screen); else "". */
export function awayIn(ms: Moment[]) {
  const m = ms.findLast((x) => x.kind === "ask" || x.kind === "point")
  return m?.app && !m.path && !m.pane && !m.ui ? (m.app === "private" ? "a private app" : appIn(m)) : ""
}
/** An app on screen as an agent reads it: its name, then its bundle id. */
export const appIn = (m: { app?: string; appName?: string }) => (m.appName && m.appName !== m.app ? `${m.appName} (${m.app})` : m.app ?? "")

/** The tours (type: tour notes) for where moment `m` was: its site's or its app's, Vaultite's own when in its window. */
function toursHere(m: Moment) {
  const all = plugin.vault.shared("tours") as unknown as readonly { id: string; app?: string[]; site?: string[] }[]
  const hosts = sitesOf(m), app = (awayIn([m]) || "vaultite").toLowerCase()
  return all.filter((t) => hosts.some((h) => siteIn(h, t.site ?? [])) || (t.app ?? []).some((a) => a.toLowerCase() === app)).slice(0, 8).map((t) => (/\.md$/i.test(t.id) ? t.id : `${t.id}.md`))
}

/** What a question over a job's page says of it: the job, what it was asked there live, what it said last. */
function pageJobLine(id: string) {
  const j = jobs.list().find((x) => x.id === id)
  if (!j) return `  over the page job ${id} works on: their changes there go to it; this question is yours`
  const asked = liveEditing.asksText(id), said = (j.last?.text ?? j.result?.text ?? "").replace(/\s+/g, " ").trim()
  return `  over the page job ${id} "${cut(j.title, 60)}" (${j.state}) works on: their changes there go to it, this question is yours, answer it now${asked ? `; asked live there: ${asked}` : ""}${said ? `; it said last: ${JSON.stringify(cut(said, 300))}` : ""}; more of its work (its diff, files, what it was told): companion job ${id}`
}

/** What an ask right after a job's proof says of it: they just watched that job's change, so their words are about it. */
function reviewedLine(id: string) {
  const j = jobs.list().find((x) => x.id === id)
  const name = j ? `job ${id} "${cut(j.title, 60)}" (${j.state})` : `job ${id}`
  return `  just after they watched ${name}'s change (Show me) and read its choice card: these words are about that job, not the note, page or app behind them, unless they plainly name something else. What to change (or any feedback on it) goes to it: handoff --job ${id}, their words go with it; a question about it you answer (companion job ${id})`
}

/** Moments as an agent reads them. */
export function momentsText(ms: Moment[], md: Mode, f: Target | null, notes: Excerpt[] = [], aware = "") {
  const guided = new Set<string>()
  const note = f?.path ? `${f.path}${f.x !== undefined ? ` at ${f.x},${f.y}` : ` at line ${f.line ?? 1}`}` : "", away = awayIn(ms)
  // (asked over another app: they're there, Vaultite's note only behind it; said as the note, it acted in Vaultite)
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
    // (its Talk key's, in an app or on a site: the user's guide to it, once a message)
    if (m.summoned && (m.kind === "ask" || m.kind === "point") && (m.app || m.url)) {
      const g = guideFor(guides(), m)
      if (g && !guided.has(g.id)) { guided.add(g.id); out.push(...guideLines(g)) }
      else if (!g && m.app && m.app !== "private") out.push(`  no guide to ${m.app} yet (Guides/)`)
    }
    // (and the tours there, Vaultite's own when it wasn't another app: one line, once a message)
    if (m.summoned && !m.tour && (m.kind === "ask" || m.kind === "point") && m.app !== "private" && !guided.has("tours")) {
      const here = toursHere(m)
      if (here.length) { guided.add("tours"); out.push(`  their tours here (companion tour): ${here.join(", ")}`) }
      const asked = tours.askable().filter((t) => !here.includes(t.path)).slice(0, 8)
      if (asked.length) { guided.add("tours"); out.push(`  their tours for anywhere (companion tour, when they ask for one in other words): ${asked.map((t) => `${t.path} (${t.ask.map((a) => JSON.stringify(a)).join(", ")})`).join("; ")}`) }
    }
  }
  // (what its last answer left on their screen: a follow-up changes it in place)
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

plugin.op({
  id: "companion.look",
  cli: "companion look",
  summary: "Move your cursor to a place, without a word: in a note, a pane (a terminal's row, a page's element) or the app's own UI.",
  help: `  vau companion look --path Notes/Idea.md --line 12
  vau companion look --find "the second paragraph"
  vau companion look --path Drawings/Plan.excalidraw --find login
  vau companion look --ui tab:t3k2
  vau companion look --pane t3k2 --find "error:"
  vau companion look --pane t5x1 --el e12`,
  kind: "read",
  params: { ...PLACE, as: AS },
  run: async (p) => {
    const name = who(p), t = await resolve(target(p, true), name)
    const at = t.frame ? { x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height } : t.sx !== undefined && t.sy !== undefined ? { x: t.sx, y: t.sy } : undefined
    const on = at ? undefined : placeText(t, t.pane ? paneById(t.pane)?.title : undefined)
    showed(name, [{ t: Date.now(), what: "your cursor pointed", ...(at ? { at } : { on }) }])
    did(name, "look", undefined, at ? `at ${Math.round(at.x)},${Math.round(at.y)} on the screen` : `at ${on}`)
    setAgent(name, { ...t, state: acting(name), pointed: Date.now() })
    return t
  },
  text: (r) => `Looking at ${placeText(r, paneById(r.pane)?.title)}.`,
})

plugin.op({
  id: "companion.say",
  cli: "companion say",
  summary: "Say something in a bubble by your cursor: your voice, for answers in the moment, how something works, quick replies.",
  help: `As long as it needs, no longer: it stays a while, longer the more it says, and its history is a click on your cursor.
With a place, your cursor goes there first. With ask, it's a question (shown as one, with a box to answer); ignored, it
fades, which means "stay quiet". What they'd want in the note tomorrow goes in it (edit); a thought by a line, a comment.

  vau companion say "Done: three tasks added below."
  vau companion say "That date is a Sunday." --find "May 3"
  vau companion say "For you, or a note to yourself?" --ask
  vau companion say "This step needs a way back." --path Drawings/Plan.excalidraw --find login
  vau companion say "That's the failing test." --pane t3k2 --find "FAIL"
  vau companion say "Your sidebar's search is here." --ui button:switcher:open`,
  kind: "read",
  // (its place before its words: its bubble shows them as they come, where they belong)
  params: { ...PLACE, ask: { type: "boolean", description: "it asks them something: a question bubble they can answer in" },
    text: { type: "string", required: true, description: "what to say (Markdown)" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p)
    did(name, "say", undefined, str(p.text))
    const given = ROOTS.some((k) => p[k] !== undefined) || p.line !== undefined || p.find || p.x !== undefined
    const t = given ? await resolve(target(p, true), name) : {}
    setAgent(name, { ...t, state: acting(name), ...(given ? { pointed: Date.now() } : {}) })
    // (shown as it was written: its bubble, with its words and place as the call has them)
    const use = toolUse.getStore(), shown = use ? streams.get(use)?.note : undefined, was = shown ? notes.get(shown) : undefined
    // (its bubble closed as it was written: it stays closed, its words in its history)
    if (shown && !was) {
      const n: Note = { id: shown, kind: "say", agent: name, text: str(p.text), ...t, t: Date.now(), seen: true }
      keepSaid(n)
      return n
    }
    if (was) {
      Object.assign(was, { text: str(p.text), ...t, ...(p.ask ? { question: true } : {}) })
      broadcast({ t: "note", note: was })
      clearTimeout(timers.get(was.id))
      timers.set(was.id, setTimeout(() => dropNote(was.id), sayMs(str(p.text))))
    }
    const answers = was ? undefined : answering(name)
    const n = was ?? putNote({ kind: "say", agent: name, text: str(p.text), ...t, ...(p.ask ? { question: true } : {}), ...(answers ? { answers } : {}), writer: requestWriter.getStore() ?? { client: ctx.who.client, agent: ctx.who.agent } }, sayMs(str(p.text)))
    keepSaid(n)
    return n
  },
  text: () => "Said.",
})
