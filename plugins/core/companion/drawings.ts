// What companions draw over the screen (draw --marks), a layer per session: marks live until the next ask, until
// dismissed, or until the screen under them changes; edited by id, hidden and shown, kept as an .excalidraw.
import fs from "node:fs"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { appPlaces, checkMarks, type Drawing, drawingText, editMarks, findsOf, idsIn, type KeptFile, type Mark, type Media, pruned, type Rect, sentences, snapMarks, type Spot, spots,
  toExcalidraw, unshown, lifeOf, isAnswer } from "./screenmarks.ts"
import { fileTitle } from "./names.ts"

/** A drawing left up this long with nothing new goes by itself. */
const IDLE_MS = 5 * 60_000
const FOLDER = "Drawings"

export function screenDrawings(plugin: Plugin, o: {
  /** To the helpers' overlays. */
  send: (m: object) => void
  /** Where the user's window has these places ("pane:t3", "ui:tab:t3"), in screen points. */
  locate: (places: string[]) => Promise<Record<string, Rect>>
  tint: (agent: string) => string
  /** The elements the agent's last ask came with, as places ("el:a3"). */
  elements: (agent: string) => Record<string, Rect>
  /** Those of `ids` the window can find again, where they are now. */
  live: (agent: string, ids: string[]) => Promise<Record<string, Rect>>
  /** Where words show on the screen of the agent's last ask (screen points), or null. */
  find: (agent: string, text: string) => Promise<Rect | null>
  /** What the user drew round things with that ask (rings' boxes). */
  drawn: (agent: string) => Rect[]
  /** The agent's words of this exchange, for the beats (its last say since its last ask). */
  words: (agent: string) => string | undefined
  /** The displays its last ask was on (screen points; [] unknown), or null when no helper is there to draw. */
  displays: (agent: string) => Rect[] | null
  /** An image or video card's source found (media.ts), or an OpError saying why it can't show. */
  media: { resolve: (m: Media) => Promise<Media>; bytes: (m: Media) => Promise<KeptFile | null> }
}) {
  /** Each session's layer, by its name; `idle`, when each goes by itself. */
  const layers = new Map<string, Drawing>(), idle = new Map<string, ReturnType<typeof setTimeout>>()
  let n = 0
  /** What the helper is told of `agent`'s layer (null: gone). */
  const message = (agent: string) => ({ t: "drawing", agent, drawing: layers.get(agent) ?? null })
  /** What a helper connecting now is sent: every layer up. */
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

  /** Where `ms` go: their places found (the app's, the ask's elements, words on the screen), a guessed pixel snapped,
   *  media found; those that can't show left out, each said why (`left`). */
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
    if (unfound.length) throw new OpError(`nothing on the user's screen says ${unfound.map((t) => JSON.stringify(t)).join(", ")} now, so nothing was drawn and they saw no mark: use the words exactly as it shows them (a few will do), an element by id, or the area's box; don't go on as if they saw it`, 409)
    // (a guessed pixel: round what they drew there, or the element it's on)
    ms = snapMarks(ms, places, o.drawn(agent))
    // (only marks that land on a display are drawn, and said to be; a card's picture or video found, or said why not)
    const why = unshown(ms, places, displays)
    ms = await Promise.all(ms.map(async (m, i) => {
      if (why[i] || (m.type !== "image" && m.type !== "video") || m.url) return m
      try { return { ...m, ...(await o.media.resolve(m)) } as Mark } catch (e) { why[i] = (e as Error).message; return m }
    }))
    const left = ms.flatMap((m, i) => (why[i] ? [`the ${m.type} ${why[i]}`] : []))
    return { marks: ms.filter((_, i) => !why[i]), places, left }
  }
  /** A choice's question, shown with its answers: the last question of its say (or of the words said with it), else all
   *  of it. Answers with no words are refused: buttons that came alone, unsaid, went unnoticed. */
  function asking(ms: Mark[], say?: string): { question?: string } {
    if (!ms.some(isAnswer)) return {}
    if (!say?.trim()) throw new OpError("a choice's buttons come with its question, said and shown with them: put it in say (\"Which one, the watcher or the video cards?\"), never buttons alone")
    return { question: sentences(say).findLast((x) => x.trim().endsWith("?"))?.trim() ?? say.trim() }
  }
  /** One of `id`'s videos as the user left it (its speaker or play pressed on the card): kept, so what's up says so. */
  function media(id: string, mark: string, state: { sound?: boolean; paused?: boolean }) {
    const now = byId(id), m = now?.marks.find((x) => x.id === mark)
    if (!now || m?.type !== "video") return false
    const next = { ...m }
    for (const k of ["sound", "paused"] as const) if (typeof state[k] === "boolean") { if (state[k]) next[k] = true; else delete next[k] }
    if (!!next.sound === !!m.sound && !!next.paused === !!m.paused) return false
    up({ ...now, marks: now.marks.map((x) => (x === m ? next : x)) })
    return true
  }
  /** Every mark and pad item named, so a later ask can change it by id. */
  function named(ms: Mark[], taken: Set<string>) {
    const next = (p: string) => { let id; do id = `${p}${++n}`; while (taken.has(id)); taken.add(id); return id }
    return ms.map((m) => {
      const id = m.id ?? next(m.type === "paper" ? "pad" : m.type === "image" || m.type === "video" ? m.type : "m")
      return m.type === "paper" ? { ...m, id, items: m.items.map((i) => (i.id ? i : { ...i, id: next("i") })) } : { ...m, id }
    })
  }

  /** `marks` drawn by `agent`: added to its drawing up (one from an exchange before, or kept, is replaced), timed with
   *  `say` or its words; `unshown`, why each mark left out couldn't show. */
  async function draw(agent: string, marks: unknown, say?: string) {
    let ms: Mark[]
    try { ms = checkMarks(marks) } catch (e) { throw new OpError((e as Error).message) }
    asking(ms, say ?? o.words(agent))
    const now = layers.get(agent), adding = !!now && !now.kept && !now.past
    const taken = adding ? idsIn(now!.marks) : new Set<string>()
    const twice = ms.flatMap((m) => [m.id, ...(m.type === "paper" ? m.items.map((i) => i.id) : [])]).filter((id): id is string => !!id && taken.has(id))
    if (twice.length) throw new OpError(`id ${twice.map((x) => JSON.stringify(x)).join(", ")} is up already: change it with actions, or give another`)
    const got = await placed(agent, ms)
    if (!got.marks.length) throw new OpError(`${got.left.join("; ")}, so nothing was drawn and they saw no mark: use an element's id, the words exactly as their screen shows them, or a box on their screen; don't go on as if they saw it`, 409)
    ms = named(got.marks, new Set([...taken, ...idsIn(got.marks)]))
    const caption = say ?? o.words(agent), q = asking(ms, caption)
    if (adding) up({ ...now!, marks: pruned([...now!.marks, ...ms]).slice(-40), places: { ...now!.places, ...got.places }, hidden: undefined, ...(caption ? { caption } : {}), ...q })
    else up({ id: `d${Date.now().toString(36)}${++n}`, agent, tint: o.tint(agent), t: Date.now(), marks: ms, places: got.places, ...(caption ? { caption } : {}), ...q })
    return { drawing: layers.get(agent)!, unshown: got.left }
  }

  /** `agent`'s drawing up changed in place by id (draw --actions without a path): marks and pad items added, moved,
   *  recoloured, erased (the pen run backward). */
  async function edit(agent: string, actions: unknown, say?: string) {
    const now = layers.get(agent)
    if (!now) throw new OpError("nothing of yours is drawn on the screen now (another session's layer is its own): draw it with marks", 409)
    let made: ReturnType<typeof editMarks>
    try { made = editMarks(pruned(now.marks), actions) } catch (e) { throw new OpError((e as Error).message) }
    const q = asking(made.added, say ?? o.words(agent))
    // (what's added or moved: its places found, its media too; one that can't show is refused, nothing changed)
    const got = await placed(agent, made.marks.filter((m) => !m.gone), now.places)
    if (got.left.length) throw new OpError(`${got.left.join("; ")}: nothing was changed`, 409)
    const found = new Map(got.marks.map((m) => [m.id, m]))
    const marks = named(made.marks.map((m) => (m.id && found.has(m.id) ? found.get(m.id)! : m)), idsIn(made.marks))
    const caption = say ?? o.words(agent)
    // (its words are this exchange's: what's added comes with them, the rest stays drawn)
    up({ ...now, marks, places: got.places, past: false, kept: undefined, hidden: undefined, ...(caption ? { caption } : {}), ...q })
    return { drawing: layers.get(agent)!, touched: made.touched }
  }

  /** `agent`'s exchange over (a new ask, its answer said): what lives until the next ask goes, the rest stays, from an
   *  exchange before; nothing left, the layer goes. */
  function settle(agent: string) {
    const now = layers.get(agent)
    if (!now) return
    const left = now.marks.filter((m) => !m.gone && lifeOf(m) !== "ask")
    if (!left.length) return void drop(agent)
    if (now.past && left.length === now.marks.length) return
    // (its pen doesn't run again: every mark's beat its first)
    up({ ...now, marks: left.map(({ beat: _b, ...m }) => m as Mark), past: true, spoken: undefined, waits: undefined })
  }
  /** The screen under marks of layer `id` changed (the helper saw it): those that point or live until then go, faded
   *  (cards stay till dismissed). */
  function changed(id: string, marks: string[]) {
    const d = byId(id)
    if (!d) return false
    const goes = new Set(marks), left = d.marks.filter((m) => !m.id || !goes.has(m.id) || lifeOf(m) === "dismiss")
    if (left.length === d.marks.length) return false
    if (left.some((m) => !m.gone)) up({ ...d, marks: left }); else drop(d.agent)
    return true
  }
  /** Marks of layer `id` whose things moved (the helper found them again, by how much in screen points): they follow. */
  function moved(id: string, moves: { mark: string; dx: number; dy: number }[]) {
    const d = byId(id)
    if (!d) return false
    const next = shifted(d, moves)
    if (next === d) return false
    up(next)
    return true
  }

  /** `agent`'s layer up timed with `caption` now (its words whole, as they came after its marks). */
  function recaption(agent: string, caption: string) {
    const now = layers.get(agent)
    if (!now || now.kept || now.past || now.caption === caption) return
    layers.set(agent, { ...now, caption })
    o.send(message(agent))
  }

  /** Take layers down: `agent`'s, the one with `id`, or (neither) every one. */
  function clear(by: { agent?: string; id?: string } = {}) {
    const which = by.agent ? [by.agent] : by.id ? [byId(by.id)?.agent].filter((a): a is string => !!a) : [...layers.keys()]
    return which.map(drop).some(Boolean)
  }
  /** One card the user dismissed (its × on the screen): gone, and its layer with it when it was the last. */
  function dismiss(id: string, mark: string) {
    const now = byId(id)
    if (!now || !now.marks.some((m) => m.id === mark)) return false
    const marks = now.marks.filter((m) => m.id !== mark && !m.gone)
    if (!marks.length) return drop(now.agent)
    up({ ...now, marks })
    return true
  }
  /** `agent`'s layer hidden or shown (`on`; neither, the other way): it stays, its marks and ids as they were (a before
   *  and after). Whether it's shown now, or null: no layer. */
  function toggle(agent: string, on?: boolean) {
    const now = layers.get(agent)
    if (!now) return null
    const show = on ?? !!now.hidden
    if (show === !now.hidden) return show
    up({ ...now, hidden: show ? undefined : true })
    return show
  }

  /** Keep the drawing (by id, else the one up) as an .excalidraw in the vault; `places`: where the overlay found its
   *  marks, for `all`. Its path. */
  async function keep(ctx: OpCtx, p: { id?: string; agent?: string; path?: string; all?: boolean; places?: Record<string, Rect> }) {
    const d = p.id ? byId(p.id) : (p.agent && layers.get(p.agent)) || [...layers.values()].sort((a, b) => b.t - a.t)[0] || null
    if (!d) throw new OpError(p.id ? `no drawing ${p.id} on the screen now` : "nothing is drawn on the screen now", 404)
    const files: Record<string, KeptFile> = {}
    await Promise.all(d.marks.map(async (m) => { if (m.type === "image" && m.id && !m.gone) { const f = await o.media.bytes(m); if (f) files[m.id] = f } }))
    const scene = toExcalidraw(d.marks, { tint: d.tint, places: { ...d.places, ...p.places }, all: p.all, files })
    if (!scene) throw new OpError("nothing to keep: it has no scratch pad, card or words (all: its marks too)", 409)
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
  /** What `agent` has up still, for its next ask's words: its marks and items by id, or "". */
  function text(agent: string) {
    const now = layers.get(agent)
    if (!now) return ""
    const body = drawingText({ ...now, marks: pruned(now.marks) })
    return body && `Still on their screen, your layer${now.hidden ? " (hidden now)" : ""}${now.kept ? ` (kept in ${now.kept})` : ""}: change it in place by id with draw actions (add, move, change, delete erases it), and only when the ask is about it; new marks replace it, clear takes it down.${now.marks.some((m) => m.type === "video" && !m.gone) ? " A video here is played, paused, heard or muted there (change: paused, sound), never opened again in a player; one they may mean besides (a player pane, another card): say which you changed." : ""}\n${body}`
  }
  return { draw, edit, settle, changed, moved, recaption, clear, dismiss, media, toggle, keep, text, messages, byId, layer: (agent: string) => layers.get(agent) ?? null, all: () => [...layers.values()] }
}

/** A kept drawing's name: its pad's title, else its first words, else when. */
export function titleOf(d: Drawing) {
  const t = d.marks.map((m) => ("title" in m && m.title) || (m.type === "image" || m.type === "video" ? m.caption ?? "" : "")).find(Boolean) || sentences(d.caption ?? "")[0]?.replace(/[.!?…:]+$/, "") || ""
  const clean = fileTitle(t, 60)
  if (clean) return clean
  const at = new Date(d.t), two = (x: number) => String(x).padStart(2, "0")
  return `Sketch ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`
}

/** Layer `d` with marks moved by `moves` (by mark id): a place they're at moves once however many marks share it (two
 *  marks on one button), a spot given as a box moves with its mark. `d` itself when nothing moved. */
export function shifted(d: Drawing, moves: { mark: string; dx: number; dy: number }[]): Drawing {
  const by = new Map(moves.filter((m) => Number.isFinite(m.dx) && Number.isFinite(m.dy) && (m.dx || m.dy)).map((m) => [m.mark, m]))
  if (!by.size) return d
  const places = { ...d.places }, done = new Set<string>()
  const move = (s: Spot, v: { dx: number; dy: number }): Spot => {
    if ("area" in s) return s
    const k = "el" in s ? `el:${s.el}` : "pane" in s ? `pane:${s.pane}` : "ui" in s ? `ui:${s.ui}` : "find" in s ? `find:${s.find}` : null
    if (!k) { const r = s as Rect; return { ...r, x: r.x + v.dx, y: r.y + v.dy } }
    if (!done.has(k) && places[k]) { done.add(k); places[k] = { ...places[k], x: places[k].x + v.dx, y: places[k].y + v.dy } }
    return s
  }
  let any = false
  const marks = d.marks.map((m) => {
    const v = m.id ? by.get(m.id) : undefined
    if (!v || m.gone) return m
    any = true
    if ("from" in m) return { ...m, from: move(m.from, v), to: move(m.to, v) } as Mark
    return "at" in m && m.at ? { ...m, at: move(m.at as Spot, v) } as Mark : m
  })
  return any ? { ...d, marks, places } : d
}
