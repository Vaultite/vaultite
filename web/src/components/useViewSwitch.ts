import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { DrawnLine } from "@/core/anchors"
import { typingIn } from "@/core/commands"
import { trace } from "@/core/trace"
import { afterPlaced, cancelRestores, cursorOf } from "@/core/viewstate"
import type { EditorApi } from "@/editor/Editor"
import { fmLines, keepPlace, spotOf, useTextFocus } from "@/components/filePlace"
import { beforeMode, type Mode } from "@/components/fileState"
import { doEffect, stepSwitch, SWITCH_START, switchLabel, WAITS, type SwitchDoers, type SwitchEvent, type Timer } from "@/components/viewSwitch"

type Shown = { api: EditorApi; source: boolean }
type Focus = ReturnType<typeof useTextFocus>
export type SwitchOptions = {
  path: string; tabId: string
  article: { current: HTMLElement | null }; editor: { current: Shown | null }; cur: { current: { fm: string; body: string } }
  shown: Mode; edit: Mode; follows: boolean; canFocus: boolean; locked: boolean; propsHidden: boolean; opens: boolean
  pick: (m: Mode) => void; keepAt: () => void; resume: (api: EditorApi | null) => void; coming: () => boolean
}
type Live = { current: SwitchOptions & { focusText: Focus } }

const VEIL = 600
const look = (o: Live, visibility: string) => { const art = o.current.article.current; if (art) art.style.visibility = visibility }

function toLine(o: Live, at: { line: number; col: number; find?: string; from?: DrawnLine }, veil: boolean) {
  const { article, cur, focusText } = o.current, art = article.current
  // opacity, not visibility: a visibility:hidden editor can't take the cursor.
  let there: (() => void) | undefined
  if (veil && art) {
    art.style.opacity = "0"
    there = () => { clearTimeout(late); art.style.opacity = "" }
    const late = setTimeout(there, VEIL)
  }
  const fm = fmLines(cur.current)
  focusText([Math.max(0, at.line - fm), at.col, at.find], { hold: at.from && { line: Math.max(0, at.from.line - fm), y: at.from.y }, there })
}

function placeDoers(o: Live, send: (e: SwitchEvent) => void) {
  const timers = new Map<string, number>(), holds = new Map<number, () => void>(), focuses = new Map<number, () => void>()
  const key = (n: number, t: Timer) => `${n}:${t}`
  const doers: Pick<SwitchDoers, "hide" | "show" | "resume" | "place" | "arm" | "disarm" | "land" | "halt"> = {
    hide: () => look(o, "hidden"),
    show: () => look(o, ""),
    resume: () => o.current.resume(o.current.editor.current?.api ?? null),
    place: ({ n, spot, editor }) => {
      const { article, cur } = o.current, ed = editor ? o.current.editor.current : null
      holds.set(n, keepPlace(spot, ed?.api ?? null, fmLines(cur.current), article.current, () => send({ type: "held", n }), () => send({ type: "placed", n })))
    },
    arm: ({ n, timer }) => { timers.set(key(n, timer), window.setTimeout(() => send({ type: timer, n }), WAITS[timer])) },
    disarm: ({ n, timer }) => { clearTimeout(timers.get(key(n, timer))); timers.delete(key(n, timer)) },
    land: ({ n }) => {
      const { path, focusText } = o.current
      trace("editor", { ev: "land", path, at: cursorOf(path) })
      focuses.set(n, focusText(cursorOf(path)))
    },
    halt: ({ n }) => {
      for (const [k, id] of timers) if (k.startsWith(`${n}:`)) { clearTimeout(id); timers.delete(k) }
      const hold = holds.get(n), focus = focuses.get(n)
      holds.delete(n); focuses.delete(n)
      hold?.(); focus?.()
    },
  }
  return doers
}

function openDoers(o: Live, send: (e: SwitchEvent) => void) {
  let frame = 0, unwait = () => {}, focus: (() => void) | undefined
  const press = () => send({ type: "pressed" })
  const typing = () => {
    const a = document.activeElement
    return !!a && a !== document.body && typingIn(a) && !o.current.article.current?.contains(a)
  }
  const doers: Pick<SwitchDoers, "frames" | "cancel-frames" | "await-placed" | "focus-open" | "end-open"> = {
    frames: () => { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => send({ type: "framed", typing: typing() })) }) },
    "cancel-frames": () => cancelAnimationFrame(frame),
    "await-placed": () => {
      addEventListener("pointerdown", press, true)
      unwait = afterPlaced(`file:${o.current.path}`, () => send({ type: "found" }))
    },
    "focus-open": () => { removeEventListener("pointerdown", press, true); focus = o.current.focusText(cursorOf(o.current.path)) },
    "end-open": () => { removeEventListener("pointerdown", press, true); unwait(); focus?.() },
  }
  return doers
}

function makeSwitch(first: SwitchOptions) {
  let state = SWITCH_START
  const o: Live = { current: { ...first, focusText: () => () => {} } }, shown = { current: first.shown }
  const send = (e: SwitchEvent) => {
    const was = state, { state: next, effects } = stepSwitch(was, e)
    state = next
    trace("editor", { ev: "switch", path: o.current.path, on: e.type, from: switchLabel(was), to: switchLabel(next), do: effects.map((x) => x.do) })
    for (const fx of effects) doEffect(doers, fx)
  }
  const doers: SwitchDoers = {
    ...placeDoers(o, send), ...openDoers(o, send),
    note: () => { const { article, editor, cur } = o.current; send({ type: "noted", spot: spotOf(article.current, editor.current?.api ?? null, fmLines(cur.current)) }) },
    keep: ({ from, to }) => {
      const { path, editor, keepAt } = o.current
      if (editor.current?.api.view.hasFocus) keepAt()
      trace("editor", { ev: "view", path, from, to, at: cursorOf(path) })
    },
    blur: () => {
      const a = document.activeElement
      if ((a instanceof HTMLElement || a instanceof SVGElement) && o.current.article.current?.contains(a)) a.blur()
    },
    pick: ({ mode }) => o.current.pick(mode),
    "to-line": ({ at, veil }) => toLine(o, at, veil),
    "cancel-restores": () => cancelRestores(),
  }
  const use = (now: Live["current"]) => { o.current = now; shown.current = now.shown }
  return { send, shown, use, now: () => o.current }
}

export function useViewSwitch(options: SwitchOptions) {
  const [sw] = useState(() => makeSwitch(options))
  const focusText = useTextFocus(options.editor, options.article, sw.shown, options.cur)
  useLayoutEffect(() => sw.use({ ...options, focusText }))
  const { send, now } = sw
  useLayoutEffect(() => {
    const { editor, shown, canFocus, coming } = now(), ed = !!editor.current?.api.view.dom.isConnected
    send({ type: "shown", shown, canFocus, editor: ed, coming: !ed && coming() })
    return () => send({ type: "left" })
  }, [options.shown, send, now])
  useEffect(() => {
    const before = (to: Mode, tab: string) => { if (tab === options.tabId) send({ type: "elsewhere", to, shown: now().shown, follows: now().follows }) }
    beforeMode.add(before)
    return () => { beforeMode.delete(before) }
  }, [options.tabId, send, now])
  useEffect(() => {
    const on = (e: Event) => {
      const { path, locked, shown, edit, propsHidden } = now()
      if (!(e instanceof CustomEvent) || e.detail !== path || locked) return
      send({ type: "properties", shown, to: propsHidden ? "source" : edit, hidden: propsHidden })
    }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [send, now])
  useEffect(() => { send({ type: "mounted", opens: now().opens }); return () => send({ type: "unmounted" }) }, [send, now])
  const setMode = useCallback((to: Mode) => send({ type: "pick", to, shown: now().shown }), [send, now])
  const toLine = useCallback((line: number, find?: string, from?: DrawnLine, col = 0) => {
    const { locked, shown, edit } = now()
    if (!locked) send({ type: "edit-at", shown, edit, at: { line, find, from, col } })
  }, [send, now])
  const ready = useCallback(() => send({ type: "ready" }), [send])
  return { setMode, toLine, ready }
}
