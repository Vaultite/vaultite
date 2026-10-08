// A web page in a tab: a slim bar over the desktop app's native page. Native views draw above everything, so when
// anything of the app covers the box (sampled with elementFromPoint) the page is swapped for its snapshot until it's gone.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, RotateCw, Scissors, X, type LucideIcon } from "lucide-react"
import { cn, notify, notifyError, openInSplit, post, typingIn, usePane, webPages, type WebPageState, type WebPages } from "@vaultite"
import { addressOf, hostOf } from "./address"
import { getSettings, profile, setFocusedPage, setTitle, settingsRead, shown } from "./state"

type Props = { arg: string; focused: boolean; setArg: (arg: string) => void }

export default function WebPage(props: Props) {
  return webPages ? <Page web={webPages} {...props} /> : <Elsewhere url={props.arg} />
}

/** On the web and phones: pages open outside (most sites refuse to be shown inside another page). */
function Elsewhere({ url }: { url: string }) {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-8 pt-20 text-center" data-web-elsewhere>
      <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] leading-[21px] text-muted-foreground">Web pages open in a tab in Vaultite's desktop app. Here they open in your browser.</p>
      <a href={url} target="_blank" rel="noreferrer" className="mt-3 max-w-full truncate text-[15px] text-primary hover:underline">Open {hostOf(url)}</a>
    </div>
  )
}

/** Something of the app's is over the box (see the head of this file). */
function covered(box: HTMLElement, r: DOMRect) {
  if ("dragging" in document.documentElement.dataset) return true
  // Every ~48px across and down (a menu or a flyout is wider than that), 8px in from the edges: the dividers beside a
  // pane (the sidebar's edge, a split's) reach a few pixels into it.
  const E = 8, cw = r.width - 2 * E, ch = r.height - 2 * E
  if (cw <= 0 || ch <= 0) return false
  const cols = Math.min(40, Math.max(2, Math.ceil(cw / 48) + 1)), rows = Math.min(40, Math.max(2, Math.ceil(ch / 48) + 1))
  const w = innerWidth - 1, h = innerHeight - 1
  for (let i = 0; i < cols; i++) {
    const x = Math.min(w, r.left + E + (cw * i) / (cols - 1))
    for (let j = 0; j < rows; j++) {
      const at = document.elementFromPoint(x, Math.min(h, r.top + E + (ch * j) / (rows - 1)))
      if (at && at !== box && !box.contains(at) && !at.closest("[data-sonner-toaster]")) return true
    }
  }
  return false
}

const http = (u: string) => /^https?:\/\//i.test(u)

function Page({ web, arg, focused, setArg }: Props & { web: WebPages }) {
  const { group } = usePane()
  const box = useRef<HTMLDivElement>(null)
  const shot = useRef<HTMLImageElement>(null)
  const address = useRef<HTMLInputElement>(null)
  const [id, setId] = useState(0)
  const [state, setState] = useState<WebPageState>({ url: arg, title: "", back: false, forward: false, loading: true })
  const [typed, setTyped] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // What the effects below read without starting again.
  const live = useRef({ arg, state, setArg, error: false })
  useEffect(() => { live.current = { arg, state, setArg, error: !!state.error } })

  // The page: the one this address had in these logins (a tab switched back to) or a new one; let go of when the tab goes.
  useEffect(() => {
    let gone = false, mine = 0
    settingsRead.then(() => web.open(arg, null, profile())).then((r) => {
      if (gone) { void web.release(r.id); return }
      mine = r.id
      setId(r.id)
      setState(r.state)
    }, (e) => notifyError(e, "Couldn't open the page"))
    return () => { gone = true; if (mine) void web.release(mine) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The tab's address follows the page; one given to the tab (not from the page) is loaded.
  useEffect(() => {
    if (!id || arg === live.current.state.url || !http(arg)) return
    void web.go(id, "load", arg)
  }, [id, arg, web])
  useEffect(() => {
    if (http(state.url) && state.url !== live.current.arg) live.current.setArg(state.url)
    if (http(state.url)) setTitle(state.url, state.title)
  }, [state.url, state.title])

  const clip = async () => {
    if (!id || saving) return
    setSaving(true)
    try {
      const page = await web.html(id)
      const r = await post<{ path: string; title: string; existing?: boolean }>("clip", { url: page.url, html: page.html })
      notify(r.existing ? `Already saved: ${r.title}` : `Saved "${r.title}"`, { action: { label: "Open", run: () => openInSplit(`file:${r.path}`) } })
    } catch (e) {
      notifyError(e, "Couldn't save the page")
    } finally {
      setSaving(false)
    }
  }
  const clipRef = useRef(clip)
  useEffect(() => { clipRef.current = clip })

  // What the desktop app says about this page (index.tsx's Background hands the events over).
  useEffect(() => {
    if (!id) return
    shown.set(id, {
      group, url: () => live.current.state.url, onState: setState, clip: () => void clipRef.current(),
      focusAddress: () => { address.current?.focus(); address.current?.select() },
    })
    return () => { shown.delete(id) }
  }, [id, group])
  useEffect(() => {
    if (!id) return
    setFocusedPage(id, focused)
    // The pane was focused (its tab clicked, a pane switch): the keyboard goes to the page, unless it's typing elsewhere.
    if (focused && !typingIn(document.activeElement)) void web.go(id, "focus")
    return () => setFocusedPage(id, false)
  }, [id, focused, web])

  // Keep the page over the box, or hidden behind its picture while the app draws over it.
  useEffect(() => {
    const el = box.current
    if (!id || !el) return
    let raf = 0, last = "", hidden = true, busy = false, gone = false, picture = ""
    const freeze = async () => {
      const bytes = await web.snapshot(id).catch(() => null)
      const img = shot.current
      if (!bytes || !img || gone) return
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
      img.src = url
      await img.decode().catch(() => {})
      if (picture) URL.revokeObjectURL(picture)
      picture = url
      img.hidden = false
    }
    const sync = async () => {
      raf = 0
      if (busy || gone) return
      const r = el.getBoundingClientRect()
      const show = !live.current.error && r.width >= 2 && r.height >= 2 && !covered(el, r)
      if (!show) {
        if (hidden) return
        busy = true
        await freeze()
        busy = false
        if (gone) return
        hidden = true
        last = ""
        delete el.dataset.live
        await web.place(id, null).catch(() => {})
        schedule() // (it may have gone meanwhile)
        return
      }
      const rect = { x: r.left, y: r.top, width: r.width, height: r.height }
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
      if (!hidden && key === last) return
      const wasHidden = hidden
      hidden = false
      last = key
      const placed = await web.place(id, rect).catch(() => undefined)
      el.dataset.live = "" // (the page is over the box: what the toasts' copies look for, index.tsx)
      // Back from under an overlay, in the focused pane with the keyboard nowhere in particular: give it back to the page.
      // (or it had the keyboard when it was hidden, and nothing else took it meanwhile)
      const free = !document.activeElement || document.activeElement === document.body
      if (wasHidden && free && (placed?.focused || el.closest("[data-pane]")?.id === "main-scroll")) void web.go(id, "focus")
    }
    // (A window that's hidden or covered gets no animation frames: a timer then, so the page is in place when it shows.)
    const schedule = () => {
      if (raf || gone) return
      raf = document.hidden ? window.setTimeout(() => void sync(), 50) : requestAnimationFrame(() => void sync())
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const mo = new MutationObserver(schedule)
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden", "data-dragging", "data-state"] })
    addEventListener("resize", schedule)
    document.addEventListener("visibilitychange", schedule)
    // (and now and then, for a move nothing above announces)
    const tick = setInterval(schedule, 500)
    schedule()
    return () => {
      gone = true
      cancelAnimationFrame(raf)
      clearTimeout(raf)
      ro.disconnect()
      mo.disconnect()
      removeEventListener("resize", schedule)
      document.removeEventListener("visibilitychange", schedule)
      clearInterval(tick)
      if (picture) URL.revokeObjectURL(picture)
    }
  }, [id, web])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const to = addressOf(typed ?? "", getSettings().search)
    if (!to || !id) return
    setTyped(null)
    address.current?.blur()
    void web.go(id, "load", to)
    void web.go(id, "focus")
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-web-page={id || undefined}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5">
        <BarButton icon={ArrowLeft} label="Back" disabled={!state.back} onClick={() => void web.go(id, "back")} />
        <BarButton icon={ArrowRight} label="Forward" disabled={!state.forward} onClick={() => void web.go(id, "forward")} />
        <BarButton icon={state.loading ? X : RotateCw} label={state.loading ? "Stop" : "Reload"} onClick={() => void web.go(id, state.loading ? "stop" : "reload")} />
        <form onSubmit={submit} className="mx-1 min-w-0 flex-1">
          <input ref={address} aria-label="Address" spellCheck={false} autoComplete="off" data-web-address
            value={typed ?? state.url} onChange={(e) => setTyped(e.target.value)}
            onFocus={(e) => { setTyped(state.url); e.currentTarget.select() }}
            onBlur={() => setTyped(null)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setTyped(null); e.currentTarget.blur(); void web.go(id, "focus") } }}
            className={cn("h-7 w-full rounded-[6px] bg-foreground/[0.05] px-2.5 text-[13px] outline-none placeholder:text-tertiary",
              "focus:bg-background focus:ring-1 focus:ring-primary/50", typed === null && "text-muted-foreground")} />
        </form>
        <BarButton icon={ArrowUpRight} label="Open in the browser" disabled={!http(state.url)} onClick={() => void web.external(state.url)} />
        <button type="button" onClick={() => void clip()} disabled={!id || saving || !http(state.url)} data-tip="Save to vault: the page as a note in Clippings" data-web-clip
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
          <Scissors className="size-4" strokeWidth={2} />
          {saving ? "Saving…" : "Save to vault"}
        </button>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        <img ref={shot} alt="" hidden draggable={false} className="pointer-events-none absolute inset-0 size-full object-fill select-none" />
        {state.error && <Problem error={state.error} url={state.url || arg} onRetry={() => void web.go(id, "reload")} />}
      </div>
    </div>
  )
}

function Problem({ error, url, onRetry }: { error: string; url: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center bg-background px-8 pt-20 text-center" data-web-error>
      <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">Couldn't open {hostOf(url)}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
      <button type="button" onClick={onRetry} className="mt-4 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Try again</button>
    </div>
  )
}

function BarButton({ icon: Icon, label, onClick, disabled }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }): ReactNode {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} data-tip={label}
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}
