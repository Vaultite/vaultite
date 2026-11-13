import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, Lock, RotateCw, type LucideIcon } from "lucide-react"
import { allPanes, canNavigate, cn, getTabLayout, navigate, onLook, PaneControls, usePane } from "@vaultite"
import { addressOf, hostOf } from "./address"
import { framedSite } from "./framed"
import { argOf, splitArg } from "./containers"

// A frame refused or offline still fires load: only no load at all is caught.
const SLOW_MS = 12_000

const isDark = () => document.documentElement.classList.contains("dark")

export default function FramedPage({ arg, setArg }: { arg: string; setArg: (arg: string) => void }) {
  const { container, url } = splitArg(arg)
  const site = framedSite(url)
  const { pane: tab, hidden } = usePane()
  const [reloads, setReloads] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const [dark, setDark] = useState(isDark)
  useEffect(() => onLook(() => setDark(isDark())), [])
  useEffect(() => { setLoaded(false); setSlow(false) }, [url, reloads])
  useEffect(() => {
    if (!site || loaded || hidden) return
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [site, loaded, hidden, url, reloads])

  const me = allPanes(getTabLayout()).find((t) => t.id === tab)
  return (
    <div className="relative flex h-full min-h-0 flex-col" data-web-framed={site ? hostOf(url) : ""}>
      <div className="@container/bar relative flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5 max-md:h-12">
        <BarButton icon={ArrowLeft} label="Back" disabled={!canNavigate(me, -1)} onClick={() => navigate(-1)} className="max-md:hidden" />
        <BarButton icon={ArrowRight} label="Forward" disabled={!canNavigate(me, 1)} onClick={() => navigate(1)} className="max-md:hidden @max-xs/bar:hidden" />
        <BarButton icon={RotateCw} label="Reload" disabled={!site} onClick={() => setReloads((n) => n + 1)} />
        <Address url={url} live={!!site} onGo={(to) => setArg(argOf(to, container))} />
        <BarButton icon={ArrowUpRight} label="Open in your browser" onClick={() => void window.open(url, "_blank", "noopener,noreferrer")} />
        <PaneControls />
        <Progress loading={!!site && !loaded && !slow && !hidden} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        {site && <iframe key={`${url} ${reloads}`} src={url} title={site.title} onLoad={() => setLoaded(true)}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" loading="lazy"
          className={cn("absolute inset-0 size-full border-0 transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
          style={{ colorScheme: dark ? "dark" : "light" }} />}
        {(!site || (slow && !loaded)) && (
          <div className="absolute inset-0 mx-auto flex max-w-[520px] flex-col items-center bg-background px-8 pt-20 text-center" data-web-elsewhere>
            <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
            <p className="mt-4 text-[15px] leading-[21px] text-muted-foreground">
              {site ? `${hostOf(url)} didn't load here.` : "The demo shows a few sites live. Vaultite's desktop app opens any page in a tab; here, it opens in your browser."}
            </p>
            <a href={url} target="_blank" rel="noreferrer" className="mt-3 max-w-full truncate text-[15px] text-primary hover:underline">Open {hostOf(url)}</a>
          </div>
        )}
      </div>
    </div>
  )
}

function Address({ url, live, onGo }: { url: string; live: boolean; onGo: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = url.replace(/^https?:\/\//i, "").replace(/\/$/, "")
  return (
    <div className="mx-1 flex h-7 min-w-12 flex-1 max-md:h-9 items-center gap-1.5 rounded-[6px] bg-foreground/[0.05] px-2.5 has-[input:focus]:bg-background has-[input:focus]:ring-1 has-[input:focus]:ring-primary/50"
      data-web-address-bar>
      {url.startsWith("https:") && <Lock className="size-3.5 shrink-0 text-tertiary" strokeWidth={2} aria-label="Secure" />}
      <input ref={input} value={draft ?? shown} spellCheck={false} autoComplete="off" aria-label="Address"
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none max-md:text-[17px]"
        onFocus={(e) => { setDraft(url); requestAnimationFrame(() => e.target.select()) }}
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(null); input.current?.blur() }
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return
          const to = addressOf(draft ?? url)
          input.current?.blur()
          if (to && to !== url) onGo(to)
        }} />
      {live && (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground @max-xs/bar:hidden" data-web-live
          data-tip="The site itself, live: the demo shows a few here. The desktop app opens any">
          <span className="size-1.5 rounded-full" style={{ background: "var(--green)" }} />Live
        </span>
      )}
    </div>
  )
}

const BAR_ICON = "grid size-7 max-md:size-11 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

function BarButton({ icon: Icon, label, onClick, disabled, className }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; className?: string }): ReactNode {
  return (
    <button type="button" disabled={disabled} aria-label={label} data-tip={label} className={cn(BAR_ICON, className)} onClick={onClick}>
      <Icon className="size-4 max-md:size-5" strokeWidth={2} />
    </button>
  )
}

function Progress({ loading }: { loading: boolean }) {
  const el = useRef<HTMLDivElement>(null), was = useRef(false)
  useEffect(() => {
    const e = el.current
    if (!e || loading === was.current) return
    was.current = loading
    e.getAnimations().forEach((a) => a.cancel())
    if (loading) e.animate([{ opacity: 1, transform: "scaleX(0.02)" }, { opacity: 1, transform: "scaleX(0.85)" }], { duration: 9000, easing: "cubic-bezier(.08,.7,.25,1)", fill: "forwards" })
    else e.animate([{ opacity: 1, transform: "scaleX(0.85)" }, { opacity: 1, transform: "scaleX(1)", offset: 0.4 }, { opacity: 0, transform: "scaleX(1)" }], { duration: 450, easing: "ease-out", fill: "forwards" })
  }, [loading])
  return <div ref={el} aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-[0.5px] h-[2px] origin-left opacity-0" style={{ background: "var(--primary)" }} />
}
