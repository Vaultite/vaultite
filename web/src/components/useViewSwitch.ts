import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { DrawnLine } from "@/core/anchors"
import { typingIn } from "@/core/commands"
import { trace } from "@/core/trace"
import { afterPlaced, cancelRestores, cursorOf } from "@/core/viewstate"
import type { EditorApi } from "@/editor/Editor"
import { fmLines, keepPlace, spotOf, useTextFocus } from "@/components/filePlace"
import { beforeMode, type Mode } from "@/components/fileState"
import { stepSwitch, SWITCH_START, switchLabel, WAITS, type SwitchEffect, type SwitchEvent, type SwitchState, type Timer } from "@/components/viewSwitch"

export type SwitchOptions = {
  path: string; tabId: string
  article: { current: HTMLElement | null }; editor: { current: { api: EditorApi; source: boolean } | null }; cur: { current: { fm: string; body: string } }
  shown: Mode; edit: Mode; follows: boolean; canFocus: boolean; locked: boolean; propsHidden: boolean; opens: boolean
  pick: (m: Mode) => void; keepAt: () => void; resume: (api: EditorApi | null) => void; coming: () => boolean
}
type Live = SwitchOptions & { focusText: ReturnType<typeof useTextFocus> }
type Ctx = { o: () => Live; send: (e: SwitchEvent) => void }
type Doers = Record<SwitchEffect, (was: SwitchState, now: SwitchState, e: SwitchEvent) => void>

function placeDoers({ o, send }: Ctx): Pick<Doers, "show" | "wait" | "place" | "shown" | "land" | "halt" | "resume"> {
  const stops = new Map<number, (() => void)[]>()
  let placed = 0
  const own = (n: number, stop: () => void) => stops.set(n, [...(stops.get(n) ?? []), stop])
  const arm = (n: number, t: Timer) => { const id = window.setTimeout(() => send({ type: t, n }), WAITS[t]); own(n, () => clearTimeout(id)); return id }
  const look = (v: string) => { const a = o().article.current; if (a) a.style.visibility = v }
  return {
    show: () => look(""),
    wait: (_, now) => { look("hidden"); arm(now.run?.n ?? 0, "late-shown"); arm(now.run?.n ?? 0, "gave-up") },
    place: (_, now) => {
      const run = now.run, { article, cur, editor } = o()
      if (!run?.spot) return
      const n = run.n
      look("hidden"); placed = arm(n, "placed")
      own(n, keepPlace(run.spot, run.editor ? editor.current?.api ?? null : null, fmLines(cur.current), article.current, () => send({ type: "held", n }), () => send({ type: "placed", n })))
    },
    shown: () => { clearTimeout(placed); look("") },
    land: (was, now) => {
      const { path, focusText } = o()
      trace("editor", { ev: "land", path, at: cursorOf(path) })
      own((now.run ?? was.run)?.n ?? 0, focusText(cursorOf(path)))
    },
    halt: (was) => { const n = was.run?.n ?? 0; for (const stop of stops.get(n) ?? []) stop(); stops.delete(n) },
    resume: () => o().resume(o().editor.current?.api ?? null),
  }
}

function otherDoers({ o, send }: Ctx): Omit<Doers, keyof ReturnType<typeof placeDoers>> {
  let frame = 0, unwait = () => {}, focus = () => {}, there: (() => void) | undefined
  const press = () => send({ type: "pressed" })
  return {
    note: () => { const { article, editor, cur } = o(); send({ type: "noted", spot: spotOf(article.current, editor.current?.api ?? null, fmLines(cur.current)) }) },
    leave: (_, __, e) => {
      const { path, editor, keepAt } = o()
      if (editor.current?.api.view.hasFocus) keepAt()
      if (e.type === "pick") trace("editor", { ev: "view", path, from: e.shown, to: e.to, at: cursorOf(path) })
    },
    blur: () => { const a = document.activeElement; if ((a instanceof HTMLElement || a instanceof SVGElement) && o().article.current?.contains(a)) a.blur() },
    pick: (_, __, e) => { if ("to" in e) o().pick(e.to) },
    cancel: () => cancelRestores(),
    veil: () => {
      const art = o().article.current
      if (!art) return
      // opacity, not visibility: a visibility:hidden editor can't take the cursor.
      art.style.opacity = "0"
      there = () => { clearTimeout(late); art.style.opacity = "" }
      const late = setTimeout(there, 600)
    },
    line: (_, __, e) => {
      if (e.type !== "edit-at") return
      const { cur, focusText } = o(), fm = fmLines(cur.current), { line, col, find, from } = e.at
      focusText([Math.max(0, line - fm), col, find], { hold: from && { line: Math.max(0, from.line - fm), y: from.y }, there })
      there = undefined
    },
    frames: () => {
      const typing = () => { const a = document.activeElement; return !!a && a !== document.body && typingIn(a) && !o().article.current?.contains(a) }
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => send({ type: "framed", typing: typing() })) })
    },
    unframe: () => cancelAnimationFrame(frame),
    await: () => { addEventListener("pointerdown", press, true); unwait = afterPlaced(`file:${o().path}`, () => send({ type: "found" })) },
    focus: () => { removeEventListener("pointerdown", press, true); focus = o().focusText(cursorOf(o().path)) },
    unopen: () => { removeEventListener("pointerdown", press, true); unwait(); focus() },
  }
}

function makeSwitch(first: SwitchOptions) {
  let state = SWITCH_START, live: Live = { ...first, focusText: () => () => {} }
  const shown = { current: first.shown }
  const send = (e: SwitchEvent) => {
    const was = state, { state: now, effects } = stepSwitch(was, e)
    state = now
    trace("editor", { ev: "switch", path: live.path, on: e.type, from: switchLabel(was), to: switchLabel(now), do: effects.join(" ") })
    for (const fx of effects) doers[fx](was, now, e)
  }
  const ctx = { o: () => live, send }, doers: Doers = { ...placeDoers(ctx), ...otherDoers(ctx) }
  return { send, shown, now: () => live, use: (next: Live) => { live = next; shown.current = next.shown } }
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
      const { path, locked, shown, edit, propsHidden: hidden } = now()
      if (e instanceof CustomEvent && e.detail === path && !locked) send({ type: "properties", shown, to: hidden ? "source" : edit, hidden })
    }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [send, now])
  useEffect(() => { send({ type: "mounted", opens: now().opens }); return () => send({ type: "unmounted" }) }, [send, now])
  const setMode = useCallback((to: Mode) => send({ type: "pick", to, shown: now().shown }), [send, now])
  const toLine = useCallback((line: number, find?: string, from?: DrawnLine, col = 0) => {
    const { locked, shown, edit } = now()
    if (!locked) send({ type: "edit-at", shown, to: edit, at: { line, find, from, col } })
  }, [send, now])
  const ready = useCallback(() => send({ type: "ready" }), [send])
  return { setMode, toLine, ready }
}
