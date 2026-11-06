// The companion's drawing over the screen (companion draw --marks): one at a time, sent to the helper's overlay, gone
// when the exchange ends (the next ask, Clear, a while idle); Keep saves it as an .excalidraw file.
import fs from "node:fs"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { appPlaces, checkMarks, type Drawing, type Mark, type Rect, sentences, toExcalidraw } from "./screenmarks.ts"

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
  /** The agent's words of this exchange, for the beats (its last say since its last ask). */
  words: (agent: string) => string | undefined
}) {
  let now: Drawing | null = null, n = 0, idle: ReturnType<typeof setTimeout> | undefined
  /** What a helper connecting now is sent. */
  const message = () => ({ t: "drawing", drawing: now })
  const tell = () => o.send(message())
  function drop() {
    clearTimeout(idle)
    if (!now) return false
    now = null
    tell()
    return true
  }

  /** `marks` drawn by `agent` (added to its drawing up, else a new one), timed with `say` or its words. */
  async function draw(agent: string, marks: unknown, say?: string) {
    let ms: Mark[]
    try { ms = checkMarks(marks) } catch (e) { throw new OpError((e as Error).message) }
    const want = appPlaces(ms), places = { ...o.elements(agent), ...(want.length ? await o.locate(want) : {}) }
    const missing = want.filter((p) => !places[p])
    if (missing.length) throw new OpError(`not on the user's screen: ${missing.join(", ")} (vau tabs lists the panes)`, 409)
    const caption = say ?? o.words(agent)
    if (now && now.agent === agent && !now.kept) now = { ...now, marks: [...now.marks, ...ms].slice(-40), places: { ...now.places, ...places }, ...(caption ? { caption } : {}) }
    else now = { id: `d${Date.now().toString(36)}${++n}`, agent, tint: o.tint(agent), t: Date.now(), marks: ms, places, ...(caption ? { caption } : {}) }
    clearTimeout(idle)
    idle = setTimeout(drop, IDLE_MS)
    tell()
    return now
  }

  /** `agent`'s drawing up timed with `caption` now (its words whole, as they came after its marks). */
  function recaption(agent: string, caption: string) {
    if (!now || now.agent !== agent || now.kept || now.caption === caption) return
    now = { ...now, caption }
    tell()
  }

  /** Take the drawing down: `agent`'s only (any, without), or by its id. */
  const clear = (by?: { agent?: string; id?: string }) => (!now || (by?.agent && now.agent !== by.agent) || (by?.id && now.id !== by.id) ? false : drop())

  /** Keep the drawing (by id, else the one up) as an .excalidraw in the vault; `places`: where the overlay found its
   *  marks, for `all`. Its path. */
  async function keep(ctx: OpCtx, p: { id?: string; path?: string; all?: boolean; places?: Record<string, Rect> }) {
    const d = now && (!p.id || p.id === now.id) ? now : null
    if (!d) throw new OpError(p.id ? `no drawing ${p.id} on the screen now` : "nothing is drawn on the screen now", 404)
    const scene = toExcalidraw(d.marks, { tint: d.tint, places: { ...d.places, ...p.places }, all: p.all })
    if (!scene) throw new OpError("nothing to keep: it has no scratch pad, card or words (all: its marks too)", 409)
    const path = p.path ? withExt(p.path) : free(`${FOLDER}/${titleOf(d)}.excalidraw`)
    await ctx.api("PUT", "file", { path, text: `${JSON.stringify(scene, null, 2)}\n` })
    if (now === d) { now = { ...d, kept: path }; tell() }
    return path
  }
  const withExt = (p: string) => (/\.excalidraw$/i.test(p) ? p : `${p.replace(/\.md$/i, "")}.excalidraw`)
  function free(rel: string) {
    for (let i = 1; ; i++) {
      const p = i === 1 ? rel : rel.replace(/\.excalidraw$/, ` ${i}.excalidraw`)
      if (!fs.existsSync(plugin.vault.abs(p))) return p
    }
  }
  return { draw, recaption, clear, keep, message, current: () => now }
}

/** A kept drawing's name: its pad's title, else its first words, else when. */
export function titleOf(d: Drawing) {
  const t = d.marks.map((m) => ("title" in m && m.title) || "").find(Boolean) || sentences(d.caption ?? "")[0]?.replace(/[.!?…:]+$/, "") || ""
  const clean = t.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim()
  if (clean) return clean
  const at = new Date(d.t), two = (x: number) => String(x).padStart(2, "0")
  return `Sketch ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`
}
