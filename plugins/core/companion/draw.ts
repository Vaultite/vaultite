import { z } from "zod"
import { type OpCtx, OpError } from "../../../core/plugins.ts"
import { isAnswer, type Mark, type Rect as ScreenRect, rectOf, spots, VOCABULARY } from "../../../core/desktop/screenmarks.ts"
import type { Shown as ShownMark } from "./shown.ts"
import "./opening.ts"
import { plugin } from "./self.ts"
import { EDIT_WAIT, str } from "./settings.ts"
import { notes, did, showed, key, agentOf, setAgent, writingAt, dropNote } from "./state.ts"
import { type Draw, drawer } from "./comments.ts"
import { screenDrawing } from "./windows.ts"
import { editorFor, inTurn, askWindow, streams, toolUse, saidUndrawn } from "./edits.ts"
import { AS, PATH, target, who } from "./args.ts"
import { askOf } from "./wiring.ts"
import { edited } from "./propose.ts"
import { messageOf } from "./errors.ts"

type OnScreen = { say?: unknown; hint?: unknown; as?: unknown }
const PlaceRect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), label: z.string().optional() })
const Places = z.record(z.string(), z.unknown()).catch({}).transform((all): Record<string, ScreenRect> => Object.fromEntries(Object.entries(all)
  .flatMap(([k, r]) => { const x = PlaceRect.safeParse(r); return x.success ? [[k, x.data]] : [] })))

plugin.op({
  id: "companion.draw",
  cli: "companion draw",
  summary: "Draw on the screen (marks: ring, point, connect, a scratch pad..., hand-drawn in your colour with your words), or change a drawing's elements (actions, on an .excalidraw).",
  help: `marks: what to draw over the user's screen, in beats with your words (say); each call adds to what's up. At their
next ask what pointed goes and the cards stay (a pad, a sticky, a picture...), listed by id with the ask: a follow-up
about them changes them in place (actions, no path); new marks replace them; companion clear takes it all down. The
user can drag or dismiss a card, and Keep it all (companion save-drawing: an .excalidraw).
${VOCABULARY}
Which: a thing on their screen, a mark at it; a diagram or flow, a paper of Excalidraw's shapes (rect, diamond, arrow
from/to ids); a picture of something (a logo, an animal, an icon), a paper with an svg item, clean or sketch; their
file or a picture from the web, an image or video card.

  vau companion draw --say "Click Share. Then pick who." --marks '[{"type":"ring","at":{"el":"e12"},"label":"Share"},
    {"type":"connect","from":{"el":"e12"},"to":[900,420,120,30],"beat":1}, {"type":"num","at":[900,420],"n":2,"beat":1}]'
  vau companion draw --marks '[{"type":"paper","title":"Sales","grid":true,"items":[{"type":"chart","kind":"bar","values":[3,5,8],"labels":["Q1","Q2","Q3"]}]}]'
  vau companion draw --marks '[{"type":"paper","id":"flow","w":420,"h":160,"items":[{"type":"rect","id":"in","x":20,"y":50,"label":"Sign in"},
    {"type":"diamond","id":"ok","x":170,"y":30,"w":100,"h":100,"label":"Valid?"},{"type":"rect","id":"home","x":300,"y":50,"label":"Home","fill":"green"},
    {"type":"arrow","from":"in","to":"ok"},{"type":"arrow","from":"ok","to":"home","label":"yes"}]}]'
  vau companion draw --marks '[{"type":"paper","w":200,"h":200,"items":[{"type":"svg","style":"sketch","paths":[{"d":"M20 80 Q50 10 80 80 Z","fill":"green"}]}]}]'
  vau companion draw --marks '[{"type":"image","src":"screenshot","caption":"Your latest screenshot","at":"top-right"}]'

actions without a path: what's up changed in place, by the ids the ask listed (or your marks gave): {"op": "add",
"type": "rect" | ..., "in": "<pad id>", ...an item} (to the last pad without in), {"op": "add", "mark": {...a mark}},
{"op": "move", "id", "dx", "dy"} (or x, y; a card {"op": "move", "id", "at": "top-left"}), {"op": "change", "id",
"color", "fill", "label", "text", "w", "h", "caption"...; a video's "sound", "paused"}, {"op": "delete", "id"} (erased, its pen run backward).

  vau companion draw --actions '[{"op":"change","id":"video5","sound":true}]' --say "Here it is with sound."

  vau companion draw --actions '[{"op":"change","id":"home","fill":"blue"},{"op":"add","type":"rect","id":"err","x":170,"y":0,"w":90,"h":24,"label":"Retry"},
    {"op":"add","type":"arrow","from":"ok","to":"err","label":"no"},{"op":"delete","id":"old"}]'

actions with a path: a drawing's changes, all checked before any is made (\`vau docs excalidraw\` has every field). Ids are in the
drawing's text (next, vau render). Only in pair mode or when they asked you to.

  vau companion draw --path Drawings/Plan.excalidraw --actions '[{"op":"add","type":"rectangle","id":"login","x":0,"y":0,"label":"Log in","fill":"blue"},
    {"op":"add","type":"arrow","from":"login","to":"home","label":"ok"}, {"op":"move","id":"home","dx":40,"dy":0},
    {"op":"change","id":"home","label":"Start"}, {"op":"delete","id":"old"}]'`,
  kind: "write",
  lock: false,
  params: { marks: { type: "array", items: { type: "object" }, description: "marks to draw on the screen: {\"type\": \"ring\" | \"point\" | \"frame\" | \"connect\" | \"paper\" | ..., ...} (see help)" },
    say: { type: "string", description: "with marks, written after them: your words, said once the marks check; each mark's beat is a sentence of them" },
    hint: { type: "string", description: "with a choice's buttons: one short line under them, shown, never said (another way to answer)" },
    actions: { type: "array", items: { type: "object" }, description: "what to change, in order, by id: {\"op\": \"add\" | \"move\" | \"change\" | \"delete\", ...}; without path the drawing on the screen, with path that drawing file" },
    path: PATH, as: AS },
  run: async (p, ctx) => {
    if (p.marks !== undefined) return drawOnScreen(p, ctx)
    if (p.actions === undefined) throw new OpError("marks (on the screen) or actions (on the screen's drawing, or a drawing's with path)")
    if (p.path === undefined) return editOnScreen(p, ctx)
    const name = who(p), t = target(p), apply = drawer(t.path!)
    if (!apply) throw new OpError(`${t.path} isn't a drawing (a .excalidraw file, its plugin on): companion edit writes in notes`)
    did(name, "draw")
    const done = writingAt(name, { path: t.path, line: undefined, find: undefined, x: undefined, y: undefined })
    try {
      return await inTurn(t.path!, async () => {
        const f = await ctx.api("GET", `file?path=${encodeURIComponent(t.path!)}`), cur = String(f.text ?? "")
        let made: ReturnType<Draw>
        try { made = apply(cur, p.actions) } catch (e) { throw new OpError(messageOf(e)) }
        const ws = editorFor(t.path!), reply: { touched?: unknown } = {}
        const drawn = !!ws && await askWindow(ws, { t: "draw", agent: agentOf(name).name, path: t.path, actions: p.actions }, EDIT_WAIT + p.actions.length * 300, reply)
        if (!drawn) await ctx.api("PUT", "file", { path: f.path, text: made.text, base: cur })
        const touched = drawn && Array.isArray(reply.touched) ? reply.touched.map(String) : made.touched
        if (touched.length) setAgent(name, { find: touched.at(-1) })
        return { path: t.path, how: drawn ? "drawn" : "written", touched }
      })
    } finally { done() }
  },
  text: (r) => (r.changed ? `Changed the drawing on the screen (${r.changed.join(", ") || "nothing named"}).` : r.screen ? `Drew ${r.marks} on the screen (${r.screen}).${r.unshown ? ` Not drawn, they saw no mark: ${r.unshown.join("; ")}.` : ""}` : `${r.how === "drawn" ? "Drew on" : "Wrote"} ${r.path}${r.touched.length ? ` (${r.touched.join(", ")})` : ""}.`),
  did: (p) => (p.marks !== undefined ? { action: "ui", text: "Drew on the screen", paths: [], by: who(p) } : edited(p)),
})

async function drawOnScreen(p: OnScreen & { marks: unknown[] }, ctx: OpCtx) {
  const name = who(p)
  const { drawing: d, unshown, added } = await screenDrawing.draw(name, p.marks, str(p.say) || undefined, str(p.hint).trim() || undefined).catch((e) => {
    did(name, "draw")
    const use = toolUse.getStore(), n = use ? streams.get(use)?.note : undefined, ask = askOf(name)?.t
    if (n && ask !== undefined) saidUndrawn.set(key(name), { note: n, text: notes.get(n)?.text ?? str(p.say), ask })
    throw e
  })
  const landed = added.map((m) => ({ t: Date.now(), what: `your ${m.type}`, ...landing(m, d.places) }))
  showed(name, landed)
  did(name, "draw", undefined, `${landed.map((x) => `${/^[aeiou]/.test(x.what.slice(5)) ? "an" : "a"} ${x.what.slice(5)}${x.at ? ` at ${Math.round(x.at.x)},${Math.round(x.at.y)}` : ""}`).join(", ")} on the screen`)
  const r = spots(d.marks).map((s) => rectOf(s, d.places)).find(Boolean)
  const at = r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : {}
  if (str(p.say)) await ctx.op("companion.say", { text: str(p.say), ...at, ...(d.marks.some(isAnswer) ? { ask: true } : {}), ...(p.as ? { as: p.as } : {}) })
  else if (r) setAgent(name, at)
  return { screen: d.id, marks: p.marks.length - unshown.length, ...(unshown.length ? { unshown } : {}) }
}

function landing(m: Mark, places: Record<string, ScreenRect> = {}): Pick<ShownMark, "at" | "on"> {
  const s = spots([m])[0], r = s && rectOf(s, places)
  return r ? { at: { x: r.x, y: r.y, w: r.w, h: r.h } } : s && "area" in s ? { on: `the ${s.area} of the screen` } : {}
}

async function editOnScreen(p: OnScreen & { actions?: unknown }, ctx: OpCtx) {
  const name = who(p)
  did(name, "draw")
  const { drawing: d, touched } = await screenDrawing.edit(name, p.actions, str(p.say) || undefined)
  if (str(p.say)) await ctx.op("companion.say", { text: str(p.say), ...(p.as ? { as: p.as } : {}) })
  return { screen: d.id, changed: touched }
}

plugin.op({
  id: "companion.save-drawing",
  cli: "companion save-drawing",
  summary: "Keep the drawing on the screen as an .excalidraw in the vault, as it looked: its scratch pads, cards (a video as its first frame, linked), buttons and words (all: its marks too).",
  help: "What Keep does on the screen. Default path: Drawings/<its title>.excalidraw.",
  kind: "write",
  params: { id: { type: "string", description: "the drawing (default: the one up)" }, path: { ...PATH, description: "where (default Drawings/<its title>.excalidraw)" },
    all: { type: "boolean", description: "the marks on the screen too, as they were placed" }, places: { type: "object", description: "where the overlay found its places (Keep's)" } },
  run: async (p, ctx) => ({ path: await screenDrawing.keep(ctx, { id: str(p.id) || undefined, path: str(p.path) || undefined, all: p.all === true, places: Places.parse(p.places) }) }),
  text: (r) => `Kept ${r.path}.`,
  did: () => ({ action: "create", text: "Kept the companion's drawing", paths: [] }),
})

plugin.op({
  id: "companion.clear",
  cli: "companion clear",
  summary: "Take back your comments and suggestions (one by id, or all of yours, and your layer on the screen).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", description: "the item (n12); default: all of yours" }, as: AS },
  run: async (p) => {
    const name = who(p), gone = [...notes.values()].filter((n) => !n.by && (p.id ? n.id === p.id : n.agent === name))
    for (const n of gone) dropNote(n.id)
    const drew = !p.id && screenDrawing.clear({ agent: name })
    return { cleared: gone.length + (drew ? 1 : 0) }
  },
  text: (r) => `Cleared ${r.cleared}.`,
  did: (p) => ({ action: "ui", text: p.id ? `Took back ${str(p.id)}` : "Took back its comments and suggestions", paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.layer",
  cli: "companion layer",
  summary: "Your layer on the screen (what you drew there, by id): read it, or hide and show it (a before and after).",
  help: `Each session draws on its own layer (companion draw): its marks never touch another's. A mark stays until the next
ask (what points), until it's dismissed (cards) or until the screen under it changes (life). Hiding keeps it as it is,
ids and all: show brings it back at once, nothing drawn again.

  vau companion layer              what's on it, by id
  vau companion layer --hide       out of sight (the after: the screen as it is)
  vau companion layer --show       back (the before: what you marked)`,
  kind: "write",
  lock: false,
  params: { hide: { type: "boolean", description: "out of sight, kept as it is" }, show: { type: "boolean", description: "back on the screen" },
    toggle: { type: "boolean", description: "hidden if shown, shown if hidden" }, as: AS },
  run: async (p) => {
    const name = who(p), d = screenDrawing.layer(name)
    if (!d) return { layer: null, shown: false, text: "" }
    if (p.hide === true && p.show === true) throw new OpError("hide or show, not both")
    const shown = p.hide === true ? screenDrawing.toggle(name, false) : p.show === true ? screenDrawing.toggle(name, true) : p.toggle === true ? screenDrawing.toggle(name) : !d.hidden
    return { layer: d.id, shown, text: screenDrawing.text(name) }
  },
  text: (r) => (!r.layer ? "Nothing of yours is on the screen." : `Your layer ${r.layer}, ${r.shown ? "shown" : "hidden"}.${r.text ? `\n${r.text.split("\n").slice(1).join("\n")}` : ""}`),
  did: (p) => ({ action: "ui", text: p.hide === true ? "Hid its layer" : p.show === true ? "Showed its layer" : p.toggle === true ? "Toggled its layer" : "Read its layer", paths: [], by: who(p) }),
})
