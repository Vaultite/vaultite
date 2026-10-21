// A web page in a tab: a slim bar over the desktop app's native page. Native views draw above everything, so when
// anything of the app covers the box (sampled with elementFromPoint) the page is swapped for its snapshot until it's gone.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Globe, Lock, Pause, Play, RotateCw, Scissors, Volume2, VolumeX, X, type LucideIcon } from "lucide-react"
import { notify, notifyError, openInSplit, openView, post, typingIn, useEnabled, usePane, webPageActions, webPages, type WebPageState, type WebPages } from "@vaultite"
import { hostOf } from "./address"
import { ExtensionButtons } from "./Extensions"
import { AddressBar, type Go } from "./AddressBar"
import { ContainerButton } from "./ContainerButton"
import { argOf, colorOf, containerById, profileIn, ruleFor, splitArg } from "./containers"
import { markTyped } from "./history"
import { ShieldsButton } from "./shields"
import { Start } from "./Start"
import { agentNews, pausedPages, setFocusedPage, settingsRead, setTitle, shown } from "./state"

type Props = { arg: string; focused: boolean; setArg: (arg: string) => void }

export default function WebPage(props: Props) {
  return webPages ? <Page web={webPages} {...props} /> : <Elsewhere url={splitArg(props.arg).url} />
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

/** Something of the app's is over the box (see the head of this file); `data-under-pages` bits (a companion's cursor)
 *  are just drawn under the page. */
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
      if (at && at !== box && !box.contains(at) && !at.closest("[data-sonner-toaster], [data-under-pages], [data-status-bar]")) return true
    }
  }
  return false
}

/** Where in the box the page goes: above the status bar where that's drawn over the pane's foot (laid over it, the page
 *  would hide the bar, and the bar over the page would freeze it as a picture). */
function pageArea(r: DOMRect) {
  const bar = document.querySelector("[data-status-bar]")?.getBoundingClientRect()
  if (!bar?.height || bar.left >= r.right || bar.right <= r.left || bar.top >= r.bottom || bar.bottom <= r.top) return r
  return new DOMRect(r.left, r.top, r.width, Math.max(0, bar.top - r.top))
}

const http = (u: string) => /^https?:\/\//i.test(u)
/** What a tab may follow and name: the web, and an extension's own pages (its options). */
const ownPage = (u: string) => http(u) || /^chrome-extension:\/\//i.test(u)

function Page({ web, arg: tabArg, focused, setArg: setTabArg }: Props & { web: WebPages }) {
  const { group } = usePane()
  // (a tab's container never changes under its page: index.tsx draws a page afresh for another)
  const { container, url: arg } = splitArg(tabArg)
  const setArg = (url: string) => setTabArg(argOf(url, container))
  const box = useRef<HTMLDivElement>(null)
  const shot = useRef<HTMLImageElement>(null)
  const address = useRef<HTMLInputElement>(null)
  const [id, setId] = useState(0)
  const [state, setState] = useState<WebPageState>({ url: arg, title: "", back: false, forward: false, loading: http(arg) })
  const [saving, setSaving] = useState(false)
  useEnabled() // (other plugins' buttons, as they're switched)
  // What the effects below read without starting again.
  const live = useRef({ arg, state, setArg, setTabArg, error: false })
  useEffect(() => { live.current = { arg, state, setArg, setTabArg, error: !!state.error } })

  // A container that needs Touch ID: whether it's locked now (null: not known yet), asked again as containers lock.
  const [locked, setLocked] = useState<boolean | null>(container ? null : false)
  useEffect(() => {
    if (!container) return
    let gone = false
    const ask = () => void Promise.resolve(web.engine?.("lock:open", profileIn(container)))
      .then((open) => { if (!gone) setLocked(open === false) }, () => { if (!gone) setLocked(false) })
    void settingsRead().then(ask)
    const off = web.on((m) => { if (m.type === "engine:lock:locked") ask() })
    return () => { gone = true; off() }
  }, [container, web])
  useEffect(() => { if (locked && shot.current) shot.current.hidden = true }, [locked])

  // The page: the one this address had in these logins (a tab switched back to) or a new one; let go of when the tab goes
  // (or its container locks). A new web tab has none till an address is typed (its arg).
  const blank = !ownPage(arg)
  useEffect(() => {
    if (locked !== false || blank) return
    let gone = false, mine = 0
    settingsRead().then(() => {
      // A site that always opens in a container, opened in none: its tab goes there (drawn afresh, index.tsx).
      const rule = container ? null : ruleFor(arg)
      if (rule && containerById(rule)) { live.current.setTabArg(argOf(arg, rule)); return Promise.reject(null) }
      return web.open(arg, null, profileIn(container))
    }).then((r) => {
      if (gone) { void web.release(r.id); return }
      mine = r.id
      setId(r.id)
      setState(r.state)
    }, (e) => { if (e !== null) notifyError(e, "Couldn't open the page") })
    return () => { gone = true; if (mine) void web.release(mine); setId(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, blank])

  // The tab's address follows the page; one given to the tab (not from the page) is loaded.
  useEffect(() => {
    if (!id || arg === live.current.state.url || !ownPage(arg)) return
    void web.go(id, "load", arg)
  }, [id, arg, web])
  useEffect(() => {
    if (ownPage(state.url) && state.url !== live.current.arg) live.current.setArg(state.url)
    if (ownPage(state.url)) setTitle(state.url, state.title)
  }, [state.url, state.title])

  const clip = async () => {
    if (!id || saving) return
    setSaving(true)
    try {
      const page = await web.html(id)
      const r = await post<{ path: string; title: string; existing?: boolean }>("clip", { url: page.url, html: page.html })
      if (!r.existing) notify(`Saved "${r.title}"`, { action: { label: "Open", run: () => openInSplit(`file:${r.path}`) } })
      else {
        // Saved before: its note, and the page as it is now only if asked.
        openInSplit(`file:${r.path}`)
        notify(`Already saved: ${r.title}`, { action: { label: "Update", run: async () => {
          await post("clip", { url: page.url, html: page.html, update: true })
          notify(`Updated "${r.title}"`)
        } } })
      }
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
      group, container, url: () => live.current.state.url, onState: setState, clip: () => void clipRef.current(),
      focusAddress: () => { address.current?.focus(); address.current?.select() },
    })
    return () => { shown.delete(id) }
  }, [id, group, container, web])
  // (a new web tab's keyboard is its address's)
  useEffect(() => { if (blank && focused && !typingIn(document.activeElement)) address.current?.focus() }, [blank, focused])
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
      const whole = el.getBoundingClientRect(), r = pageArea(whole)
      el.style.setProperty("--page-foot", `${whole.bottom - r.bottom}px`)
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
      if (shot.current) shot.current.hidden = true // (under the page now, but where the status bar leaves the foot bare)
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

  const inside = containerById(container)
  const tint = inside ? colorOf(inside) : undefined

  const go: Go = (to, how, newTab) => {
    markTyped(to, how)
    if (newTab) { openView(`web/${argOf(to, container)}`, { newTab: true }); return }
    // (a site that always opens in another container: the tab moves there)
    const rule = ruleFor(to)
    if (rule && rule !== container && containerById(rule)) { setTabArg(argOf(to, rule)); return }
    if (!id) { setArg(to); return }
    void web.go(id, "load", to)
    void web.go(id, "focus")
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-web-page={id || ""}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5">
        <BarButton icon={ArrowLeft} label="Back" disabled={!state.back} onClick={() => void web.go(id, "back")} />
        <BarButton icon={ArrowRight} label="Forward" disabled={!state.forward} onClick={() => void web.go(id, "forward")} />
        <BarButton icon={state.loading ? X : RotateCw} label={state.loading ? "Stop" : "Reload"} disabled={!id} onClick={() => void web.go(id, state.loading ? "stop" : "reload")} />
        <ContainerButton container={container} url={state.url || arg} reopen={(to) => setTabArg(to)} />
        <AddressBar url={state.url} current={tabArg} tint={tint} inputRef={address} onGo={go} onLeave={() => { if (id) void web.go(id, "focus") }} />
        {(state.audible || state.muted) && (
          <BarButton icon={state.muted ? VolumeX : Volume2} label={state.muted ? "Unmute tab" : "Mute tab"} onClick={() => void web.go(id, state.muted ? "unmute" : "mute")} />
        )}
        {id > 0 && http(state.url) && <ShieldsButton id={id} url={state.url} />}
        {http(state.url) && webPageActions({ url: state.url, title: state.title }).map((a) => <BarButton key={a.label} icon={a.icon} label={a.label} onClick={a.run} />)}
        <ExtensionButtons pageId={id} url={state.url} />
        <BarButton icon={ArrowUpRight} label="Open in another browser" disabled={!http(state.url)} onClick={() => void web.external(state.url)} />
        <button type="button" onClick={() => void clip()} disabled={!id || saving || !http(state.url)} data-tip="Save to vault: the page as a note in Clippings" data-web-clip
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
          <Scissors className="size-4" strokeWidth={2} />
          {saving ? "Saving…" : "Save to vault"}
        </button>
      </div>
      {id > 0 && <AgentBar web={web} id={id} />}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        <img ref={shot} alt="" hidden draggable={false} className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%_-_var(--page-foot,0px))] w-full object-fill select-none" />
        {blank && <Start onOpen={(to, newTab) => go(to, "typed", newTab)} />}
        {state.error && <Problem error={state.error} url={state.url || arg} onRetry={() => void web.go(id, "reload")} />}
        {locked && inside && <Locked name={inside.name} unlock={() => void Promise.resolve(web.engine?.("lock:unlock", profileIn(container), inside.name))
          .then((ok) => { if (ok === true) setLocked(false) }, (e) => notifyError(e, "Couldn't unlock it"))} />}
      </div>
    </div>
  )
}

/** How long an agent's last step shows in the bar. */
const NEWS_MS = 6000

/** An agent at work in this tab: who and what it's doing, with Pause (its next steps are refused till Resume). */
function AgentBar({ web, id }: { web: WebPages; id: number }) {
  const news = agentNews.use((m) => m.get(id))
  const paused = pausedPages.use((s) => s.has(id))
  const [, tick] = useState(0)
  const fresh = !!news && Date.now() - news.at < NEWS_MS
  useEffect(() => {
    if (!fresh || !news) return
    const t = setTimeout(() => tick((n) => n + 1), NEWS_MS - (Date.now() - news.at) + 50)
    return () => clearTimeout(t)
  }, [fresh, news])
  if (!fresh && !paused) return null
  const pause = (on: boolean) => void Promise.resolve(web.engine?.("agents:pause", id, on)).catch((e) => notifyError(e, "Couldn't pause it"))
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-3 text-[13px]" data-web-agent
      style={{ background: "color-mix(in srgb, var(--purple) 9%, transparent)" }}>
      <Bot className="size-4 shrink-0" strokeWidth={2} style={{ color: "var(--purple)" }} />
      <span className="min-w-0 flex-1 truncate">
        {paused ? "Agents are paused in this tab" : <><span className="font-medium">{news!.by}</span> <span className="text-muted-foreground">{news!.what}</span></>}
      </span>
      <button type="button" onClick={() => pause(!paused)} data-web-agent-pause={paused ? "resume" : "pause"}
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium hover:bg-foreground/[0.06]">
        {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  )
}

function Locked({ name, unlock }: { name: string; unlock: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center bg-background px-8 pt-20 text-center" data-web-locked>
      <Lock className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">{name} is locked</p>
      <button type="button" onClick={unlock} className="mt-4 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Unlock with Touch ID</button>
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
