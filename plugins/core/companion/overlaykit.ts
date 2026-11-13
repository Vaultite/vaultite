import { notify, op } from "@vaultite"
import { type Note, viewOf } from "./live"
import { changeAt } from "./text"

export const unsent = () => { notify("Couldn't send it: not connected to the server. Try again in a moment", { kind: "error", id: "companion-unsent" }) }
export const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const DRAFT = "draft"

export function stepTo(n: Note, dir: 1 | -1) {
  const v = n.path ? viewOf(n.path) : null
  if (!v) return
  const text = v.state.doc.toString(), head = v.state.selection.main.head
  const at = (n.changes ?? []).filter((c) => !c.intent && !c.stale).map((c) => changeAt(text, c)).filter((i) => i >= 0).map((i) => v.state.doc.lineAt(i).from).sort((a, b) => a - b)
  if (!at.length) return
  const to = dir > 0 ? at.find((x) => x > head) ?? at[0] : [...at].reverse().find((x) => x < head) ?? at[at.length - 1]
  v.dispatch({ selection: { anchor: to }, scrollIntoView: true })
  v.focus()
}

export const proposes = (n: Note) => ((n.changes ?? []).some((c) => !c.intent) ? "proposes" : "is writing")

export const answerAsk = (event: string, v: "approve" | "deny") => (event.startsWith("chat:")
  ? op("claude-code.chat-answer", { id: event.slice(5), allow: v === "approve" }) : op("inbox.answer", { id: event, answer: v }))

const shallow = (x: unknown, y: unknown) => !!x && !!y && typeof x === "object" && typeof y === "object"
  && Object.keys(x).length === Object.keys(y).length && Object.entries(x).every(([k, v]) => Object.is(v, (y as Record<string, unknown>)[k]))
export const sameProps = <P extends object>(a: P, b: P) => Object.entries(b).every(([k, v]) => typeof v === "function" || Object.is((a as Record<string, unknown>)[k], v) || shallow((a as Record<string, unknown>)[k], v))
export const coarse = matchMedia("(pointer: coarse)")