import type { Condition, Target as UiTarget } from "../../../core/desktop/uimodel.ts"
import type { CursorState } from "../../../core/desktop/cursor.ts"
import type { Target } from "../../../core/desktop/places.ts"
import type { Agent, Boxed, EditAsk, Follow, Harness, How, Mode, Note, Reply } from "./live.ts"
import type { Change } from "./text.ts"

/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- the live socket's parser in the app's first load, where zod would add ~90 KB */
export type Rec = Record<string, unknown>
export const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const num = (v: unknown) => (typeof v === "number" ? v : undefined)
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined)
const oneOf = <T extends string>(xs: readonly T[], v: unknown) => xs.find((x) => x === v)
const each = <T>(v: unknown, read: (o: Rec) => T | null): T[] => (Array.isArray(v) ? v.flatMap((x) => { const y = isRec(x) ? read(x) : null; return y === null ? [] : [y] }) : [])
const listOf = <T>(v: unknown, read: (o: Rec) => T | null): T[] | undefined => (Array.isArray(v) ? each(v, read) : undefined)
const objOf = <T>(v: unknown, read: (o: Rec) => T | null): T | undefined => (isRec(v) ? read(v) ?? undefined : undefined)
function defined<T extends object>(o: T): T {
  for (const [k, v] of Object.entries(o)) if (v === undefined) Reflect.deleteProperty(o, k)
  return o
}

const rect = (o: Rec) => { const x = num(o.x), y = num(o.y), width = num(o.width), height = num(o.height); return x !== undefined && y !== undefined && width !== undefined && height !== undefined ? { x, y, width, height } : null }
const box = (o: Rec) => { const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h), zoom = num(o.zoom); return x !== undefined && y !== undefined && w !== undefined && h !== undefined && zoom !== undefined ? { x, y, w, h, zoom } : null }
const placeOf = (o: Rec): Target & Boxed => ({ path: str(o.path), line: num(o.line), find: str(o.find), x: num(o.x), y: num(o.y), pane: str(o.pane), ui: str(o.ui), row: num(o.row), el: str(o.el),
  app: str(o.app), window: num(o.window), sx: num(o.sx), sy: num(o.sy), display: num(o.display), frame: objOf(o.frame, rect), box: objOf(o.box, box) })

const STATES: readonly CursorState[] = ["watching", "reading", "thinking", "writing", "starting", "away", "listening"]
export function agentOf(o: Rec): Agent | null {
  const name = str(o.name), tint = str(o.tint), state = oneOf(STATES, o.state), t = num(o.t)
  if (name === undefined || tint === undefined || !state || t === undefined) return null
  const asks = isRec(o.asks) && typeof o.asks.event === "string" && typeof o.asks.text === "string" ? { event: o.asks.event, text: o.asks.text } : undefined
  return defined({ ...placeOf(o), name, tint, state, t, seen: bool(o.seen), why: str(o.why), pointed: num(o.pointed), rests: bool(o.rests), runs: str(o.runs), model: str(o.model), effort: str(o.effort), asks })
}
export const agentsOf = (v: unknown) => each(v, agentOf)

const reply = (o: Rec): Reply | null => {
  const by = oneOf(["user", "agent", "guest"], o.by), text = str(o.text)
  return by && text !== undefined ? defined({ by, text, name: str(o.name), t: num(o.t) }) : null
}
const change = (o: Rec): Change | null => {
  const id = str(o.id), find = str(o.find), text = str(o.text), line = num(o.line)
  return id !== undefined && find !== undefined && text !== undefined && line !== undefined ? defined({ id, find, text, line, intent: str(o.intent), stale: bool(o.stale) }) : null
}
const KINDS: readonly Note["kind"][] = ["say", "comment", "suggestion", "proposal", "highlight", "ask"]
export function noteOf(o: Rec): Note | null {
  const id = str(o.id), kind = oneOf(KINDS, o.kind), agent = str(o.agent), t = num(o.t)
  if (id === undefined || !kind || agent === undefined || t === undefined) return null
  return defined({ ...placeOf(o), id, kind, agent, t, text: str(o.text), replace: str(o.replace), replies: listOf(o.replies, reply), pinned: str(o.pinned),
    changes: listOf(o.changes, change), took: num(o.took), left: num(o.left), by: oneOf(["user", "guest"], o.by), tint: str(o.tint), ask: str(o.ask),
    dismissed: num(o.dismissed), orphaned: bool(o.orphaned), question: bool(o.question), seen: bool(o.seen), placed: bool(o.placed) })
}
export const notesOf = (v: unknown) => each(v, noteOf)

export const modeOf = (v: unknown): Mode | undefined => oneOf(["off", "quiet", "pair"], v)

const how = (o: Rec): How | null => { const agent = str(o.agent), model = str(o.model), effort = str(o.effort); return agent !== undefined && model !== undefined && effort !== undefined ? { agent, model, effort } : null }
export const howFrom = (v: unknown) => objOf(v, how)
export const profilesOf = (v: unknown): Record<string, How> =>
  (isRec(v) ? Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const h = objOf(x, how); return h ? [[k, h]] : [] })) : {})

const model = (o: Rec) => { const id = str(o.id), label = str(o.label); return id !== undefined && label !== undefined ? { id, label } : null }
export const harnessesOf = (v: unknown): Harness[] => each(v, (o) => {
  const id = str(o.id), name = str(o.name), installed = bool(o.installed)
  return id !== undefined && name !== undefined && installed !== undefined ? { id, name, installed, models: each(o.models, model), efforts: Array.isArray(o.efforts) ? o.efforts.filter((e) => typeof e === "string") : [] } : null
})

export const followsOf = (v: unknown): Follow[] => each(v, (o) => {
  const id = str(o.id), agent = str(o.agent), title = str(o.title), since = num(o.since)
  return id !== undefined && agent !== undefined && title !== undefined && since !== undefined ? defined({ id, agent, title, since, pane: str(o.pane), tab: str(o.tab), group: str(o.group), ui: str(o.ui) }) : null
})

export function editAskOf(o: Rec): EditAsk | null {
  const rid = str(o.rid), agent = str(o.agent), text = str(o.text)
  if (rid === undefined || agent === undefined || text === undefined) return null
  const { box: _b, ...place } = placeOf(o)
  return defined({ ...place, rid, agent, text, after: str(o.after), append: bool(o.append), animate: bool(o.animate) })
}

const CONDITIONS: readonly Condition["kind"][] = ["expanded", "selected", "checked", "focused", "disabled", "exists", "shows", "value", "changed"]
const uiTarget = (o: Rec): UiTarget => {
  const s = isRec(o.state) ? o.state : null, checked = oneOf(["mixed"], s?.checked) ?? bool(s?.checked)
  return defined({ role: str(o.role), name: str(o.name), inside: str(o.inside), ui: str(o.ui), id: str(o.id),
    state: s ? defined({ expanded: bool(s.expanded), selected: bool(s.selected), checked, disabled: bool(s.disabled), focused: bool(s.focused), value: str(s.value) }) : undefined })
}
export const conditionOf = (v: unknown): Condition | undefined => objOf(v, (o) => {
  const kind = oneOf(CONDITIONS, o.kind)
  return kind ? defined({ kind, not: bool(o.not), target: objOf(o.target, uiTarget), text: str(o.text) }) : null
})
