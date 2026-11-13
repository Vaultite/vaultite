import { isNumber, isObj, isText, strings } from "../../../core/values.ts"

export type UiAction = { action: string; path?: string; split?: "right" | "down" | null; newTab?: boolean; background?: boolean; container?: string | null; in?: string | null; id?: string; rid?: string
  text?: string; kind?: "error" | null; button?: { label: string; open: string } | null }

const text = (v: unknown): string | undefined => (isText(v) ? v : undefined)

export function liveMessageOf(raw: Record<string, unknown>) {
  return {
    raw, type: text(raw.type), v: text(raw.v), at: text(raw.at), web: text(raw.web), role: text(raw.role),
    paths: raw.paths === null ? null : Array.isArray(raw.paths) ? strings(raw.paths) : undefined, from: text(raw.from),
    to: raw.to === null ? null : text(raw.to), names: Array.isArray(raw.names) ? strings(raw.names) : undefined,
    kept: text(raw.kept), state: isNumber(raw.state) ? raw.state : undefined, rid: text(raw.rid), action: text(raw.action),
  }
}

export function uiActionOf(m: Record<string, unknown>, action: string): UiAction {
  const { split, kind, button } = m
  const label = isObj(button) ? text(button.label) : undefined, open = isObj(button) ? text(button.open) : undefined
  return {
    action, path: text(m.path), split: split === "right" || split === "down" || split === null ? split : undefined,
    newTab: m.newTab === true, background: m.background === true, container: m.container === null ? null : text(m.container), in: m.in === null ? null : text(m.in), id: text(m.id), rid: text(m.rid),
    text: text(m.text), kind: kind === "error" || kind === null ? kind : undefined,
    button: button === null ? null : label !== undefined && open !== undefined ? { label, open } : undefined,
  }
}
