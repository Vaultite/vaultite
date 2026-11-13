import fs from "node:fs"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { appPlaces, checkMarks, type Drawing, drawingText, editMarks, findsOf, idsIn, type Mark, type Media, pruned, type Rect, sentences, snapMarks, type Spot, spots,
  unshown, lifeOf, isAnswer } from "../../../core/desktop/screenmarks.ts"
import { fileTitle } from "../../../core/desktop/names.ts"
import { type KeptFile, toExcalidraw } from "./kept.ts"
import { messageOf } from "./errors.ts"

const IDLE_MS = 5 * 60_000
const FOLDER = "Drawings"

export function screenDrawings(plugin: Plugin, o: {
  send: (m: object) => void
  locate: (places: string[]) => Promise<Record<string, Rect>>
  tint: (agent: string) => string
  elements: (agent: string) => Record<string, Rect>
  live: (agent: string, ids: string[]) => Promise<Record<string, Rect>>
  find: (agent: string, text: string) => Promise<Rect | null>
  drawn: (agent: string) => Rect[]
  words: (agent: string) => string | undefined
  displays: (agent: string) => Rect[] | null
  media: { resolve: (m: Media) => Promise<Media>; bytes: (m: Media) => Promise<KeptFile | null> }
}) {
  const layers = new Map<string, Drawing>(), idle = new Map<string, ReturnType<typeof setTimeout>>()
  let n = 0
  const message = (agent: string) => ({ t: "drawing", agent, drawing: layers.get(agent) ?? null })
  const messages = () => [...layers.keys()].map(message)
  function drop(agent: string) {
    clearTimeout(idle.get(agent)); idle.delete(agent)
    if (!layers.delete(agent)) return false
    o.send(message(agent))
    return true
  }
  const up = (d: Drawing) => {
    layers.set(d.agent, d)
    clearTimeout(idle.get(d.agent)); idle.set(d.agent, setTimeout(() => drop(d.agent), IDLE_MS))
    o.send(message(d.agent))
  }
  const byId = (id?: string) => [...layers.values()].find((d) => d.id === id) ?? null

  async function placed(agent: string, ms: Mark[], had: Record<string, Rect> = {}) {
    const displays = o.displays(agent)
    if (!displays) throw new OpError("nothing was drawn and they saw no mark: no screen to draw on here (the Mac's menu-bar helper isn't connected)", 409)
    const want = appPlaces(ms), ids = [...new Set(spots(ms).flatMap((s) => ("el" in s ? [s.el] : [])))]
    const [here, moved] = await Promise.all([want.length ? o.locate(want) : {}, ids.length ? o.live(agent, ids).catch(() => ({})) : {}])
    const places: Record<string, Rect> = { ...had, ...o.elements(agent), ...moved, ...here }
    const missing = want.filter((p) => !places[p])
    if (missing.length) throw new OpError(`not on the user's screen: ${missing.join(", ")} (vau tabs lists the panes)`, 409)
    await Promise.all(findsOf(ms).map(async (text) => { if (places[`find:${text}`]) return; const r = await o.find(agent, text).catch(() => null); if (r) places[`find:${text}`] = r }))
    const unfound = findsOf(ms).filter((t) => !places[`find:${t}`])
    if (unfound.length) throw new OpError(`nothing on the user's screen says ${unfound.map((t) => JSON.stringify(t)).join(", ")} now (all those words, in order), so nothing was drawn and they saw no mark: aim again by an element's id or by words it does show, exactly as it shows them (a few in a row will do), never a guessed box; don't go on as if they saw it`, 409)
    ms = snapMarks(ms, places, o.drawn(agent))
    const why = unshown(ms, places, displays)
    ms = await Promise.all(ms.map(async (m, i): Promise<Mark> => {
      if (why[i] || (m.type !== "image" && m.type !== "video") || m.url) return m
      try { return { ...m, ...(await o.media.resolve(m)) } } catch (e) { why[i] = messageOf(e); return m }
    }))
    const left = ms.flatMap((m, i) => (why[i] ? [`the ${m.type} ${why[i]}`] : []))
    return { marks: ms.filter((_, i) => !why[i]), places, left }
  }
  function asking(ms: Mark[], say?: string): { question?: string } {
    if (!ms.some(isAnswer)) return {}
    if (!say?.trim()) throw new OpError("a choice's buttons come with its question, said and shown with them: put it in say (\"Which one, the watcher or the video cards?\"), never buttons alone")
    return { question: sentences(say).findLast((x) => x.trim().endsWith("?"))?.trim() ?? say.trim() }
  }
  function media(id: string, mark: string, state: { sound?: boolean; paused?: boolean }) {
    const now = byId(id), m = now?.marks.find((x) => x.id === mark)
    if (!now || m?.type !== "video") return false
    const next = { ...m }
    for (const k of ["sound", "paused"] as const) if (typeof state[k] === "boolean") { if (state[k]) next[k] = true; else delete next[k] }
    if (!!next.sound === !!m.sound && !!next.paused === !!m.paused) return false
    up({ ...now, marks: now.marks.map((x) => (x === m ? next : x)) })
    return true
  }
  function named(ms: Mark[], taken: Set<string>) {
    const next = (p: string) => { let id; do id = `${p}${++n}`; while (taken.has(id)); taken.add(id); return id }
    return ms.map((m) => {
      const id = m.id ?? next(m.type === "paper" ? "pad" : m.type === "image" || m.type === "video" ? m.type : "m")
      return m.type === "paper" ? { ...m, id, items: m.items.map((i) => (i.id ? i : { ...i, id: next("i") })) } : { ...m, id }
    })
  }

  async function draw(agent: string, marks: unknown, say?: string, hint?: string) {
    let ms: Mark[]
    try { ms = checkMarks(marks) } catch (e) { throw new OpError(messageOf(e)) }
    asking(ms, say ?? o.words(agent))
    const now = layers.get(agent), adding = !!now && !now.kept && !now.past
    const taken = adding ? idsIn(now!.marks) : new Set<string>()
    const twice = ms.flatMap((m) => [m.id, ...(m.type === "paper" ? m.items.map((i) => i.id) : [])]).filter((id): id is string => !!id && taken.has(id))
    if (twice.length) throw new OpError(`id ${twice.map((x) => JSON.stringify(x)).join(", ")} is up already: change it with actions, or give another`)
    const got = await placed(agent, ms)
    if (!got.marks.length) throw new OpError(`${got.left.join("; ")}, so nothing was drawn and they saw no mark: use an element's id, the words exactly as their screen shows them, or a box on their screen; don't go on as if they saw it`, 409)
    ms = named(got.marks, new Set([...taken, ...idsIn(got.marks)]))
    const caption = say ?? o.words(agent), asked = asking(ms, caption), q = { ...asked, ...(asked.question && hint ? { hint: hint.slice(0, 160) } : {}) }
    if (adding) up({ ...now!, marks: pruned([...now!.marks, ...ms]).slice(-40), places: { ...now!.places, ...got.places }, hidden: undefined, ...(caption ? { caption } : {}), ...q })
    else up({ id: `d${Date.now().toString(36)}${++n}`, agent, tint: o.tint(agent), t: Date.now(), marks: ms, places: got.places, ...(caption ? { caption } : {}), ...q })
    return { drawing: layers.get(agent)!, unshown: got.left, added: ms }
  }

  async function edit(agent: string, actions: unknown, say?: string) {
    const now = layers.get(agent)
    if (!now) throw new OpError("nothing of yours is drawn on the screen now (another session's layer is its own): draw it with marks", 409)
    let made: ReturnType<typeof editMarks>
    try { made = editMarks(pruned(now.marks), actions) } catch (e) { throw new OpError(messageOf(e)) }
    const q = asking(made.added, say ?? o.words(agent))
    const got = await placed(agent, made.marks.filter((m) => !m.gone), now.places)
    if (got.left.length) throw new OpError(`${got.left.join("; ")}: nothing was changed`, 409)
    const found = new Map(got.marks.map((m) => [m.id, m]))
    const marks = named(made.marks.map((m) => (m.id && found.has(m.id) ? found.get(m.id)! : m)), idsIn(made.marks))
    const caption = say ?? o.words(agent)
    up({ ...now, marks, places: got.places, past: false, kept: undefined, hidden: undefined, ...(caption ? { caption } : {}), ...q })
    return { drawing: layers.get(agent)!, touched: made.touched }
  }

  function settle(agent: string) {
    const now = layers.get(agent)
    if (!now) return
    const left = now.marks.filter((m) => !m.gone && lifeOf(m) !== "ask")
    if (!left.length) return void drop(agent)
    if (now.past && left.length === now.marks.length) return
    up({ ...now, marks: left.map((m) => { const next = { ...m }; delete next.beat; return next }), past: true, spoken: undefined, waits: undefined })
  }
  function changed(id: string, marks: string[]) {
    const d = byId(id)
    if (!d) return false
    const goes = new Set(marks), left = d.marks.filter((m) => !m.id || !goes.has(m.id) || lifeOf(m) === "dismiss")
    if (left.length === d.marks.length) return false
    if (left.some((m) => !m.gone)) up({ ...d, marks: left }); else drop(d.agent)
    return true
  }
  function moved(id: string, moves: { mark: string; dx: number; dy: number }[]) {
    const d = byId(id)
    if (!d) return false
    const next = shifted(d, moves)
    if (next === d) return false
    up(next)
    return true
  }

  function recaption(agent: string, caption: string) {
    const now = layers.get(agent)
    if (!now || now.kept || now.past || now.caption === caption) return
    layers.set(agent, { ...now, caption })
    o.send(message(agent))
  }

  function clear(by: { agent?: string; id?: string } = {}) {
    const which = by.agent ? [by.agent] : by.id ? [byId(by.id)?.agent].filter((a): a is string => !!a) : [...layers.keys()]
    return which.map(drop).some(Boolean)
  }
  function dismiss(id: string, mark: string) {
    const now = byId(id)
    if (!now || !now.marks.some((m) => m.id === mark)) return false
    const marks = now.marks.filter((m) => m.id !== mark && !m.gone)
    if (!marks.length) return drop(now.agent)
    up({ ...now, marks })
    return true
  }
  function toggle(agent: string, on?: boolean) {
    const now = layers.get(agent)
    if (!now) return null
    const show = on ?? !!now.hidden
    if (show === !now.hidden) return show
    up({ ...now, hidden: show ? undefined : true })
    return show
  }

  async function keep(ctx: OpCtx, p: { id?: string; agent?: string; path?: string; all?: boolean; places?: Record<string, Rect> }) {
    const d = p.id ? byId(p.id) : (p.agent && layers.get(p.agent)) || [...layers.values()].sort((a, b) => b.t - a.t)[0] || null
    if (!d) throw new OpError(p.id ? `no drawing ${p.id} on the screen now` : "nothing is drawn on the screen now", 404)
    const files: Record<string, KeptFile> = {}
    await Promise.all(d.marks.map(async (m) => { if ((m.type === "image" || m.type === "video") && m.id && !m.gone) { const f = await o.media.bytes(m); if (f) files[m.id] = f } }))
    const scene = toExcalidraw(d.marks, { tint: d.tint, places: { ...d.places, ...p.places }, all: p.all, files, question: d.question })
    if (!scene) throw new OpError("nothing to keep: it has no scratch pad, card, button or words (all: its marks too)", 409)
    const path = p.path ? withExt(p.path) : free(`${FOLDER}/${titleOf(d)}.excalidraw`)
    await ctx.api("PUT", "file", { path, text: `${JSON.stringify(scene, null, 2)}\n` })
    if (layers.get(d.agent) === d) { layers.set(d.agent, { ...d, kept: path }); o.send(message(d.agent)) }
    return path
  }
  const withExt = (p: string) => (/\.excalidraw$/i.test(p) ? p : `${p.replace(/\.md$/i, "")}.excalidraw`)
  function free(rel: string) {
    for (let i = 1; ; i++) {
      const p = i === 1 ? rel : rel.replace(/\.excalidraw$/, ` ${i}.excalidraw`)
      if (!fs.existsSync(plugin.vault.abs(p))) return p
    }
  }
  function text(agent: string) {
    const now = layers.get(agent)
    if (!now) return ""
    const body = drawingText({ ...now, marks: pruned(now.marks) })
    return body && `Still on their screen, your layer${now.hidden ? " (hidden now)" : ""}${now.kept ? ` (kept in ${now.kept})` : ""}: change it in place by id with draw actions (add, move, change, delete erases it), and only when the ask is about it; new marks replace it, clear takes it down.${now.marks.some((m) => m.type === "video" && !m.gone) ? " A video here is played, paused, heard or muted there (change: paused, sound), never opened again in a player; one they may mean besides (a player pane, another card): say which you changed." : ""}\n${body}`
  }
  return { draw, edit, settle, changed, moved, recaption, clear, dismiss, media, toggle, keep, text, messages, byId, layer: (agent: string) => layers.get(agent) ?? null, all: () => [...layers.values()] }
}

export function titleOf(d: Drawing) {
  const t = d.marks.map((m) => ("title" in m && m.title) || (m.type === "image" || m.type === "video" ? m.caption ?? "" : "")).find(Boolean) || sentences(d.caption ?? "")[0]?.replace(/[.!?…:]+$/, "") || ""
  const clean = fileTitle(t, 60)
  if (clean) return clean
  const at = new Date(d.t), two = (x: number) => String(x).padStart(2, "0")
  return `Sketch ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`
}

export function shifted(d: Drawing, moves: { mark: string; dx: number; dy: number }[]): Drawing {
  const by = new Map(moves.filter((m) => Number.isFinite(m.dx) && Number.isFinite(m.dy) && (m.dx || m.dy)).map((m) => [m.mark, m]))
  if (!by.size) return d
  const places = { ...d.places }, done = new Set<string>()
  const move = (s: Spot, v: { dx: number; dy: number }): Spot => {
    if ("area" in s) return s
    if (!("el" in s || "pane" in s || "ui" in s || "find" in s)) return { ...s, x: s.x + v.dx, y: s.y + v.dy }
    const k = "el" in s ? `el:${s.el}` : "pane" in s ? `pane:${s.pane}` : "ui" in s ? `ui:${s.ui}` : `find:${s.find}`
    if (!done.has(k) && places[k]) { done.add(k); places[k] = { ...places[k], x: places[k].x + v.dx, y: places[k].y + v.dy } }
    return s
  }
  let any = false
  const marks = d.marks.map((m) => {
    const v = m.id ? by.get(m.id) : undefined
    if (!v || m.gone) return m
    any = true
    if (m.type === "connect") return { ...m, from: move(m.from, v), to: move(m.to, v) }
    return m.at ? { ...m, at: move(m.at, v) } : m
  })
  return any ? { ...d, marks, places } : d
}
