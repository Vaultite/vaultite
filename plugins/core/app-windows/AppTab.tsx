// An app's window in a tab (electron/apps.ts), kept over the box as it moves; the box is a hole in the page once the
// window is there (Holes.tsx), cut again only once it's back (`data-app-placed`), so the desktop never shows through.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { AppWindow, LoaderCircle } from "lucide-react"
import { appWindows, type AppProblem, type AppWindows } from "@vaultite"
import { AppIcon } from "./icons"
import { nameOf, onGone, onHere, parse, setWindowTitle } from "./state"

type Props = { arg: string; focused: boolean; setArg: (arg: string) => void }

export default function AppTab(props: Props) {
  return appWindows ? <Tab api={appWindows} {...props} /> : <Note text={`${nameOf(parse(props.arg).bundle)} opens in a tab in Vaultite's desktop app on a Mac.`} />
}

const PROBLEMS: Record<AppProblem | "gone" | "away", (name: string) => string> = {
  trust: () => "Vaultite needs Accessibility permission to show other apps' windows: System Settings, Privacy and security, Accessibility.",
  missing: (n) => `${n} isn't on this Mac.`,
  window: (n) => `${n} has no window here. It may be on another desktop (Space): bring it to this one, then try again.`,
  helper: () => "Couldn't move other apps' windows (the helper stopped).",
  reopen: () => "App windows was just turned on: this vault's window has to open again to show apps in it.",
  gone: (n) => `${n}'s window closed.`,
  away: (n) => `${n}'s window is on another desktop.`,
  space: (n) => `${n}'s window is on another desktop.`,
  self: () => "Vaultite can't show its own windows in a tab.",
}

function Tab({ api, arg, focused, setArg }: Props & { api: AppWindows }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"opening" | "shown" | AppProblem | "gone" | "away">("opening")
  const [attempt, setAttempt] = useState(0)
  const { bundle } = parse(arg)
  const name = nameOf(bundle)
  // The window it holds: the arg's, until the app gives another (the arg's is gone: the app restarted).
  const wid = useRef(parse(arg).wid)
  const live = useRef({ arg, setArg })
  useEffect(() => { live.current = { arg, setArg } })
  const [held, setHeld] = useState(0)
  /** Place the window again (it came back to this desktop). */
  const resync = useRef(() => {})

  useEffect(() => {
    if (!held) return
    const set = onGone.get(held) ?? new Set(), moves = onHere.get(held) ?? new Set()
    onGone.set(held, set)
    onHere.set(held, moves)
    const f = () => setState("gone")
    const m = (here: boolean) => { if (here) resync.current(); else setState((s) => (s === "shown" ? "away" : s)) }
    set.add(f)
    moves.add(m)
    return () => { set.delete(f); moves.delete(m) }
  }, [held])

  // Keep the window over the box (out of sight while the box can't be seen), as long as the tab is drawn.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let raf = 0, last = "", busy = false, again = false, gone = false, failed = false
    const sync = async () => {
      raf = 0
      if (gone || failed) return
      if (busy) { again = true; return }
      const r = el.getBoundingClientRect()
      const visible = r.width >= 2 && r.height >= 2 && document.visibilityState === "visible"
      const key = visible ? `${r.left},${r.top},${r.width},${r.height}` : "parked"
      if (!visible) delete el.dataset.appPlaced
      if (key === last) return
      busy = true
      const res: Awaited<ReturnType<AppWindows["show"]>> = await api.show(bundle, wid.current, visible ? { x: r.left, y: r.top, width: r.width, height: r.height } : null)
        .catch(() => ({ ok: false, why: "helper" as AppProblem }))
      busy = false
      if (gone) return
      last = key
      // (on another desktop: asked again as the tab is drawn, till it's here)
      if (!res.ok && res.why === "space") { last = ""; setState("away"); if (again) { again = false; schedule() } return }
      if (!res.ok) { failed = true; setState(res.why ?? "helper"); return }
      if (res.wid && res.wid !== wid.current) {
        wid.current = res.wid
        live.current.setArg(`${bundle}:${res.wid}`)
      }
      if (res.wid) setHeld(res.wid)
      if (res.wid && res.title !== undefined) setWindowTitle(res.wid, res.title)
      if (visible) setState(res.here === false ? "away" : "shown")
      if (visible && res.here !== false) el.dataset.appPlaced = ""
      if (again) { again = false; schedule() }
    }
    const schedule = () => { if (!raf && !gone) raf = requestAnimationFrame(() => void sync()) }
    resync.current = () => { last = ""; schedule() }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const mo = new MutationObserver(schedule)
    mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] })
    addEventListener("resize", schedule)
    document.addEventListener("visibilitychange", schedule)
    // (and now and then, for a move nothing above announces)
    const tick = setInterval(schedule, 500)
    schedule()
    return () => {
      gone = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      removeEventListener("resize", schedule)
      document.removeEventListener("visibilitychange", schedule)
      clearInterval(tick)
      // (its tab switched away or closed: out of sight; closed, index.tsx's onClose gives it back)
      void api.show(bundle, wid.current, null).catch(() => {})
    }
  }, [api, bundle, attempt])

  // The tab chosen: the keyboard goes to the app, as a web tab's goes to its page.
  useEffect(() => { if (focused && state === "shown" && held) void api.focus(held).catch(() => {}) }, [api, held, focused, state])

  // Another desktop: its tab's app there, or another window of it here (the tab no longer holds that one)
  const go = () => { if (wid.current) void api.focus(wid.current, true, bundle).catch(() => {}) }
  const here = () => {
    if (held) void api.release(held, true).catch(() => {})
    wid.current = 0
    setHeld(0)
    setArg(bundle)
    setState("opening")
    setAttempt((n) => n + 1)
  }

  const shown = state === "shown"
  const problem = state !== "opening" && !shown ? PROBLEMS[state](name) : null
  return (
    <div ref={box} className="relative h-full min-h-0" data-app-hole={shown ? bundle : undefined}>
      {!shown && (
        <Note text={problem ?? `Opening ${name}…`} bundle={bundle} busy={!problem}>
          {problem && (
            <div className="mt-4 flex gap-2">
              {state === "trust" && <Button onClick={() => void api.trusted(true)}>Ask for permission</Button>}
              {state === "away" ? <><Button onClick={go}>Go to it</Button><Button onClick={here}>Use a window here</Button></>
                : state === "reopen" && api.reopen
                ? <Button onClick={() => void api.reopen!()}>Reopen window</Button>
                : <Button onClick={() => { setState("opening"); setAttempt((n) => n + 1) }}>Try again</Button>}
            </div>
          )}
        </Note>
      )}
    </div>
  )
}

function Note({ text, bundle, busy, children }: { text: string; bundle?: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-8 pt-20 text-center">
      {bundle ? <AppIcon bundle={bundle} className="size-10 text-tertiary" /> : <AppWindow className="size-8 text-tertiary" strokeWidth={1.5} />}
      <p className="mt-4 flex items-center gap-2 text-[15px] leading-[21px] text-muted-foreground">
        {busy && <LoaderCircle className="size-4 shrink-0 animate-spin" strokeWidth={2} />}{text}
      </p>
      {children}
    </div>
  )
}

function Button({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">
      {children}
    </button>
  )
}
