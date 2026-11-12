// A drawing on the screen as an .excalidraw scene (vau docs excalidraw), each thing as the overlay showed it: the
// server's alone (Keep), so none of it reaches the app's code.
import { CARDS, edgeOf, HEX, isAnswer, idsIn, type Mark, PALETTE, type Rect, rectOf, svgFit, type Action, type PaperItem } from "../../../core/desktop/screenmarks.ts"
import { flatten } from "../../../core/desktop/svgpath.ts"

const live = <T extends { gone?: number }>(x: T) => !x.gone
const r1 = (v: number) => Math.round(v * 10) / 10
const INK = "#1e1e1e"
type El = Record<string, unknown>

/** A kept image's bytes (a video's: its poster frame), by its mark's id: a data URL, and its pixels when known. */
export type KeptFile = { dataURL: string; mime: string; px?: [number, number] }
/** A character's width in Excalifont, about (a little wide, so a wrapped line still fits its box). */
const CHAR = 0.6
/** Excalidraw's padding between a shape and the label bound in it. */
const PAD = 5
/** `t` wrapped to lines `w` wide at `fontSize` (a word too long for one broken), as Excalidraw keeps a bound label. */
export function wrapText(t: string, w: number, fontSize: number) {
  const most = Math.max(1, Math.floor(w / (fontSize * CHAR)))
  return t.split("\n").map((line) => {
    const out: string[] = []
    let cur = ""
    for (let word of line.split(/ +/)) {
      while (word.length > most) { if (cur) { out.push(cur); cur = "" } out.push(word.slice(0, most)); word = word.slice(most) }
      if (!cur) cur = word
      else if (cur.length + 1 + word.length <= most) cur += ` ${word}`
      else { out.push(cur); cur = word }
    }
    return [...out, cur].join("\n")
  }).join("\n")
}
/** `marks` as the overlay showed them: pads, cards and buttons (`all`: screen marks too, where `places` has them);
 *  `files`, images' bytes and videos' first frames (none: a frame with its name); `question`, its answers'. Null: none. */
export function toExcalidraw(marks: Mark[], opts: { tint?: string; places?: Record<string, Rect>; all?: boolean; files?: Record<string, KeptFile>; question?: string } = {}) {
  marks = marks.filter(live)
  const tint = HEX[opts.tint ?? ""] ?? HEX.orange, els: El[] = [], files: Record<string, El> = {}
  const strokeOf = (c?: string) => (!c || c === "tint" ? tint : c === "ink" ? INK : c.startsWith("#") ? c : PALETTE[c]?.[0] ?? tint)
  const fillOf = (c?: string) => (!c || c === "none" ? "transparent" : c === "tint" ? tint : c === "ink" ? INK : c.startsWith("#") ? c : PALETTE[c]?.[1] ?? "transparent")
  let n = 0, seed = 1
  const taken = idsIn(marks)
  const id = (p: string) => { let x; do x = `${p}${++n}`; while (taken.has(x)); return x }
  const common = (x: number, y: number, w: number, h: number, more: El = {}): El =>
    ({ x: r1(x), y: r1(y), width: r1(w), height: r1(h), angle: 0, strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
      roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: seed++, version: 1, versionNonce: seed * 7919, isDeleted: false, boundElements: null,
      updated: 1, link: null, locked: false, ...more })
  /** A text, wrapped to `wrap` wide when given (its words whole as `originalText`). */
  const text = (x: number, y: number, t: string, fontSize = 20, more: El = {}, wrap?: number): El => {
    const shown = wrap ? wrapText(t, wrap, fontSize) : t, lines = shown.split("\n")
    const w = Math.max(...lines.map((l) => l.length)) * fontSize * CHAR, h = lines.length * fontSize * 1.25
    return { id: id("t"), type: "text", ...common(x, y, w, h), text: shown, originalText: t, fontSize, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, ...more }
  }
  const bind = (s: El, b: { id: unknown; type: string }) => { s.boundElements = [...((s.boundElements as El[] | null) ?? []), b] }
  /** A shape; its label bound in it, wrapped to its width, and the shape as tall as the label needs (`top`: the label
   *  at its top left, as a card's text). */
  const shape = (type: "rectangle" | "ellipse" | "diamond", x: number, y: number, w: number, h: number, label?: string, more: El = {}, own?: string, o: { size?: number; top?: boolean } = {}) => {
    const s: El = { id: own ?? id(type[0]), type, ...common(x, y, w, h, { ...(type === "rectangle" ? { roundness: { type: 3 } } : {}), ...more }) }
    els.push(s)
    if (label) {
      // (an ellipse's or diamond's label fits the box inside it, as Excalidraw's own does)
      const inner = type === "rectangle" ? 1 : type === "ellipse" ? Math.SQRT1_2 : 0.5, room = Math.max(40, w * inner - PAD * 2)
      const t = text(x, y, label, o.size ?? 16, { containerId: s.id, textAlign: o.top ? "left" : "center", verticalAlign: o.top ? "top" : "middle",
        strokeColor: s.backgroundColor !== "transparent" ? INK : s.strokeColor }, room)
      t.width = r1(Math.min(t.width as number, room))
      // (a one-line label in a small round shape overflows a little rather than stretch it, as it did on the screen)
      if (type === "rectangle" || String(t.text).includes("\n")) s.height = r1(Math.max(h, (t.height as number) / inner + PAD * 2))
      const ih = (s.height as number) * inner
      Object.assign(t, o.top ? { x: r1(x + PAD), y: r1(y + PAD) }
        : { x: r1(x + w / 2 - (t.width as number) / 2), y: r1(y + (s.height as number) / 2 - Math.min(ih - PAD * 2, t.height as number) / 2) })
      bind(s, { id: t.id, type: "text" })
      els.push(t)
    }
    return s
  }
  const linear = (type: "line" | "arrow", pts: [number, number][], more: El = {}, own?: string) => {
    const [x0, y0] = pts[0], rel = pts.map(([x, y]) => [r1(x - x0), r1(y - y0)]), xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1])
    const e: El = { id: own ?? id(type[0]), type, startBinding: null, endBinding: null, ...common(x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), more),
      points: rel, lastCommittedPoint: null, startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null }
    els.push(e)
    return e
  }
  /** A button as the overlay's chip: a pill with its words, linked when it opens something. Its box. */
  const chip = (x: number, y: number, label: string, link: string | null) => {
    const w = Math.min(320, label.length * 15 * CHAR + 36)
    const s = shape("rectangle", x, y, w, 36, label, { strokeColor: tint, roughness: 0, roundness: { type: 3 } }, undefined, { size: 15 })
    s.link = link
    return { w, h: s.height as number }
  }
  // (cards side by side, a row, in the order drawn; buttons one under another)
  let cx = 0, chips: { x: number; y: number; w: number } | null = null
  const GAP = 40
  const asks = marks.filter(isAnswer)
  for (const m of marks) {
    if (m.type !== "button" && m.type !== "copy" && m.type !== "open" && chips) { cx = chips.x + chips.w + GAP; chips = null }
    if (m.type === "paper") {
      const top = m.title ? 36 : 0
      if (m.title) els.push(text(cx, 0, m.title, 24))
      shape("rectangle", cx, top, m.w, m.h, undefined, { strokeColor: "#ced4da", backgroundColor: "#ffffff", roughness: 0 })
      const items = m.items.filter(live), made = new Map<string, El>()
      // (shapes first, so an arrow binds to what's drawn)
      for (const it of [...items.filter((i) => i.type !== "line" && i.type !== "arrow"), ...items.filter((i) => i.type === "line" || i.type === "arrow")]) paperEl(it, items, cx, top, made)
      cx += m.w + GAP
    } else if (m.type === "sticky") {
      shape("rectangle", cx, 0, 240, 160, [m.title, m.text].filter(Boolean).join("\n\n"), { backgroundColor: "#ffec99", strokeColor: "#f08c00" }, undefined, { size: 18, top: true })
      cx += 240 + GAP
    } else if (m.type === "list") {
      const t = text(cx, 0, [m.title, ...m.items.map((x, i) => `${m.numbered ? `${i + 1}.` : "•"} ${x}`)].filter(Boolean).join("\n"), 18, {}, 360)
      els.push(t)
      cx += (t.width as number) + GAP
    } else if (m.type === "write") {
      const t = text(cx, 0, m.text, m.size === "l" ? 32 : m.size === "s" ? 16 : 22, { strokeColor: tint }, 420)
      els.push(t)
      cx += (t.width as number) + GAP
    } else if (m.type === "button" || m.type === "copy" || m.type === "open") {
      chips ??= { x: cx, y: 0, w: 0 }
      // (a choice's question atop its answers, as the card asked it)
      if (m === asks[0] && opts.question) {
        const q = text(chips.x, chips.y + (chips.y ? 8 : 0), opts.question, 18, {}, 360)
        els.push(q); chips.y = (q.y as number) + (q.height as number) + 12; chips.w = Math.max(chips.w, q.width as number)
      }
      const a: Action | null = m.type === "button" ? m.do : null
      const label = m.type === "copy" ? m.label ?? "Copy" : m.type === "open" ? m.label ?? "Open" : m.label
      const link = m.type === "open" ? m.url : a && "open" in a ? a.open : null
      const c = chip(chips.x, chips.y, label, link)
      chips.y += c.h + 10; chips.w = Math.max(chips.w, c.w)
      // (what it copies, under it: the words the card held)
      const copies = m.type === "copy" ? m.text : a && "copy" in a ? a.copy : null
      if (copies) { const t = text(chips.x + 4, chips.y, copies, 14, { fontFamily: 3 }, 360); els.push(t); chips.y += (t.height as number) + 14; chips.w = Math.max(chips.w, t.width as number) }
    } else if (m.type === "image" || m.type === "video") {
      const f = m.id ? opts.files?.[m.id] : undefined, px = f?.px ?? m.px ?? [16, 10], k = Math.min(1, 480 / px[0], 360 / px[1]), w = Math.round(px[0] * k), h = Math.round(px[1] * k)
      const link = /^https?:/i.test(m.src) ? m.src : m.url && !m.url.startsWith("api/companion/media/") ? m.src : null
      let bottom = h, cw = w
      if (f) {
        // (the picture, or the video's first frame with a play badge over it, one group, opening the video)
        const fileId = `f${hash16(f.dataURL)}`, group = m.type === "video" ? [id("g")] : []
        files[fileId] = { mimeType: f.mime, id: fileId, dataURL: f.dataURL, created: 1 }
        els.push({ id: id("i"), type: "image", ...common(cx, 0, w, h, { strokeColor: "transparent", roughness: 0, groupIds: group }), fileId, status: "saved", scale: [1, 1], crop: null, link })
        if (m.type === "video") {
          const r = Math.max(24, Math.min(36, Math.min(w, h) / 5)), ox = cx + w / 2, oy = h / 2
          shape("ellipse", ox - r, oy - r, r * 2, r * 2, undefined, { strokeColor: "#ffffff", backgroundColor: "#1e1e1e", opacity: 70, roughness: 0, groupIds: group })
          const t = r * 0.45
          linear("line", [[ox - t * 0.7, oy - t], [ox + t, oy], [ox - t * 0.7, oy + t], [ox - t * 0.7, oy - t]], { strokeColor: "#ffffff", backgroundColor: "#ffffff", strokeWidth: 1, roughness: 0, groupIds: group })
        }
      } else {
        // (no picture of it: a frame as wide as its name needs, up to the card's width, and as tall as its lines)
        const label = `${m.type === "video" ? "Video" : "Image"}: ${m.name ?? m.src.split("/").pop()}`
        const s = shape("rectangle", cx, 0, Math.max(w, Math.min(480, label.length * 16 * CHAR + PAD * 2 + 24), 240), Math.max(h, 120), label, { strokeColor: tint, roughness: 0 })
        s.link = link
        bottom = s.height as number; cw = s.width as number
      }
      if (m.caption) els.push(text(cx, bottom + 10, m.caption, 16, {}, cw))
      cx += cw + GAP
    }
  }
  function paperEl(it: PaperItem, items: PaperItem[], ox: number, oy: number, made: Map<string, El>) {
    const p = (q: [number, number]): [number, number] => [ox + q[0], oy + q[1]]
    const stroke = strokeOf(it.color), bg = fillOf(it.fill), own = it.id && !made.has(it.id) ? it.id : undefined
    const keep = (e: El) => { if (it.id) made.set(it.id, e); return e }
    if (it.type === "line" || it.type === "arrow") {
      const ends = [it.from, it.to].map((e) => (typeof e === "string" ? made.get(e) : undefined))
      const pts = [p(edgeOf(it.from, it.to, items)), p(edgeOf(it.to, it.from, items))]
      const e = linear(it.type, pts, { strokeColor: stroke,
        ...(ends[0] ? { startBinding: { elementId: ends[0].id, focus: 0, gap: 6 } } : {}), ...(ends[1] ? { endBinding: { elementId: ends[1].id, focus: 0, gap: 6 } } : {}) }, own)
      for (const s of ends) if (s) bind(s, { id: e.id, type: "arrow" })
      keep(e)
      if (it.label) {
        const t = text((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 - 10, it.label, 16, { containerId: e.id, textAlign: "center", verticalAlign: "middle" })
        bind(e, { id: t.id, type: "text" }); els.push(t)
      }
    } else if (it.type === "rect" || it.type === "ellipse" || it.type === "diamond") keep(shape(it.type === "rect" ? "rectangle" : it.type, ox + it.x, oy + it.y, it.w, it.h, it.label, { strokeColor: stroke, backgroundColor: bg }, own))
    else if (it.type === "path") keep(linear("line", it.points.map(p), { strokeColor: stroke }, own))
    else if (it.type === "text") keep(els[els.push(text(ox + it.x, oy + it.y, it.text, it.size === "l" ? 28 : it.size === "s" ? 14 : 18, { strokeColor: it.color ? stroke : INK, ...(own ? { id: own } : {}) })) - 1])
    else if (it.type === "svg") {
      // (its paths as lines, fitted into its box as the screen draws them; one grouped, so it moves as one)
      const fit = svgFit(it), group = id("g")
      it.paths.forEach((sp) => {
        for (const sub of flatten(sp.d)) {
          const pts = sub.pts.map(([x, y]) => p([it.x + fit.ox + (x - fit.vx) * fit.k, it.y + fit.oy + (y - fit.vy) * fit.k]))
          const f = fillOf(sp.fill ?? it.fill)
          linear("line", pts, { strokeColor: sp.color === "none" ? "transparent" : strokeOf(sp.color ?? it.color), backgroundColor: sub.closed ? f : "transparent",
            strokeWidth: Math.max(1, Math.min(4, sp.width ?? 2)), roughness: it.style === "sketch" ? 1 : 0, groupIds: [group], roundness: null })
        }
      })
    } else if (it.type === "chart") {
      const top = Math.max(...it.values, 0), low = Math.min(...it.values, 0), span = top - low || 1, step = it.w / it.values.length
      const yOf = (v: number) => oy + it.y + it.h - ((v - low) / span) * it.h
      if (it.kind === "bar") it.values.forEach((v, i) => shape("rectangle", ox + it.x + i * step + step * 0.15, Math.min(yOf(v), yOf(0)), step * 0.7, Math.abs(yOf(v) - yOf(0)), undefined, { strokeColor: stroke, backgroundColor: stroke, fillStyle: "hachure", roundness: null }))
      else linear("line", it.values.map((v, i): [number, number] => [ox + it.x + i * step + step / 2, yOf(v)]), { strokeColor: stroke })
      it.labels?.forEach((l, i) => els.push(text(ox + it.x + i * step + 2, oy + it.y + it.h + 4, l, 12)))
    }
  }
  if (opts.all) {
    // (the marks on the screen, under the cards, where they were: their places as the overlay found them)
    const below = 260, stroke = tint
    for (const m of marks) {
      const r = "at" in m && m.at ? rectOf(m.at, opts.places) : null
      const o = (q: Rect): Rect => ({ ...q, y: q.y + below })
      if (m.type === "connect") {
        const a = rectOf(m.from, opts.places), b = rectOf(m.to, opts.places)
        if (a && b) linear("arrow", [[a.x + a.w / 2, a.y + a.h / 2 + below], [b.x + b.w / 2, b.y + b.h / 2 + below]], { strokeColor: stroke })
        continue
      }
      if (!r || CARDS.has(m.type)) continue
      const q = o(r)
      if (m.type === "ring") shape("ellipse", q.x - 10, q.y - 10, q.w + 20, q.h + 20, undefined, { strokeColor: stroke })
      else if (m.type === "frame" || m.type === "spotlight") shape("rectangle", q.x - 6, q.y - 6, q.w + 12, q.h + 12, undefined, { strokeColor: stroke, roundness: null })
      else if (m.type === "underline") linear("line", [[q.x, q.y + q.h + 4], [q.x + q.w, q.y + q.h + 4]], { strokeColor: stroke })
      else if (m.type === "strike") linear("line", [[q.x, q.y + q.h / 2], [q.x + q.w, q.y + q.h / 2]], { strokeColor: stroke })
      else if (m.type === "num") shape("ellipse", q.x - 14, q.y - 14, 28, 28, String(m.n), { strokeColor: stroke })
      else if (m.type === "point") linear("arrow", [[q.x - 50, q.y - 40], [q.x - 4, q.y - 4]], { strokeColor: stroke })
      if ("label" in m && m.label) els.push(text(q.x, q.y - 34, m.label, 16, { strokeColor: stroke }))
    }
  }
  if (!els.length) return null
  return { type: "excalidraw", version: 2, source: "vaultite", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files }
}
const hash16 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i += Math.max(1, s.length >> 12)) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + s.length.toString(16) }
