import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { CircleAlert, Ellipsis, Folder, ListTree, RotateCcw, SquareTerminal, WifiOff } from "lucide-react"
import { Button, cn, isViewOpen, menuBelow, notifyError, op, openView, PaneControls, plural, useNoPhoneTitle, splitMachine, useDesktop, usePane, usePaneTopBar, usePortalHost } from "@vaultite"
import { ClaudeIcon } from "./ClaudeIcon"
import { NEW, nameTab } from "./titles"
import { type Seen, listedOf, see, seenOf } from "./seen"
import { useChat } from "./useChat"
import { type Options, TINT, home, modelLabel, folderName } from "./chatbits"
import { chatMenu, terminalOk, toTerminal } from "./chatmenu"

function whereOf(c: ReturnType<typeof useChat>, o: Options | null, last: Seen | null) {
  const model = c.s?.model || c.model || last?.model, cwd = c.cwd || last?.cwd
  const background = c.s?.background ? plural(c.s.background, "background task") : ""
  return [cwd && folderName(cwd, o), model && modelLabel(model, o), o && o.accounts.length > 1 && o.accounts.find((a) => a.id === c.account)?.label, background].flatMap((x) => (x ? [x] : []))
}

function useLastSeen(id: string, c: ReturnType<typeof useChat>, title: string, known: boolean) {
  const [listed, setListed] = useState<Seen | null>(null)
  const last = seenOf(id) ?? listed
  const named = known && !!title && (!!c.title || c.entries.length > 0)
  useEffect(() => { if (named) see(id, { title, cwd: c.cwd, model: c.s?.model || c.model }) }, [id, named, title, c.cwd, c.s?.model, c.model])
  const lost = !known && (!!c.unreachable || !!c.failed)
  useEffect(() => {
    if (!lost || seenOf(id)) return
    let on = true
    void listedOf(id).then((s) => { if (on && s) setListed(s) }, () => {})
    return () => { on = false }
  }, [id, lost])
  useEffect(() => { if (!known && last?.title) nameTab(id, last.title) }, [id, known, last?.title])
  return known ? null : last
}

export function Head({ id, title, c, o, scrolled, back }: { id: string; title: string; c: ReturnType<typeof useChat>; o: Options | null; scrolled: boolean
  back?: { name: string; go: () => void } }) {
  const desktop = useDesktop()
  const { hidden } = usePane()
  const subtitle = usePortalHost(!desktop && !hidden ? "phone-subtitle" : null)
  const known = c.ready && !(c.failed && !c.entries.length)
  const last = useLastSeen(id, c, title, known)
  const shown = known || !!last
  useNoPhoneTitle(!desktop && !hidden && !shown)
  const where = whereOf(c, o, last)
  if (!desktop) return subtitle && shown && where.length ? createPortal(where.join(" · "), subtitle) : null
  return <Bar id={id} title={known ? title : last?.title ?? ""} c={c} o={o} where={shown ? where : []} scrolled={scrolled} back={back} blank={!shown} />
}

function Bar({ id, title, c, o, where, scrolled, back, blank }: { id: string; title: string; c: ReturnType<typeof useChat>; o: Options | null; where: string[]; scrolled: boolean
  back?: { name: string; go: () => void }
  blank: boolean }) {
  const bar = useRef<HTMLElement>(null)
  usePaneTopBar(bar)
  const more = (e: MouseEvent) => menuBelow(e, chatMenu(id, { terminal: false }))
  return (
    <header ref={bar} data-chat-head className={cn("chat-head group/bar sight-top relative z-10 flex h-11 shrink-0 items-center border-b-[0.5px] bg-background px-5 transition-colors duration-200",
      scrolled ? "border-border/70" : "border-transparent")}>
      <div className="mx-auto flex w-full chat-column min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          {blank ? <span aria-hidden className="h-3.5 w-56 self-center rounded-chip bg-muted" />
            : <h1 data-chat-title className="min-w-0 shrink truncate text-[14px] font-semibold">{title || " "}</h1>}
          {blank ? <span aria-hidden className="chat-skel-2 h-3 w-28 self-center rounded-chip" />
            : where.length > 0 && (
              <span data-chat-where className="flex min-w-0 shrink-[2] items-center gap-1 truncate text-[13px] text-muted-foreground" data-tip={c.cwd ? home(c.cwd, o?.home) : undefined}>
                <Folder className="size-3.5 shrink-0 translate-y-[2px] self-start" strokeWidth={2} /><span className="truncate">{where.join(" · ")}</span>
              </span>
            )}
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
          {back && (
            <Button look="quiet" size="small" onClick={back.go} aria-label={`Show ${back.name.toLowerCase()}`} data-driven-back>
              <ListTree className="size-4" strokeWidth={2} />{back.name}
            </Button>
          )}
          {terminalOk(id) && (
            <button type="button" disabled={!c.ready} onClick={() => void toTerminal(id)} aria-label={c.tui ? "Show its terminal" : "Open in terminal"} data-open-terminal
              data-tip={c.tui ? "It runs in a terminal: show it" : "Resume it in Claude Code in a terminal"}
              className={cn(ICON, "chat-term w-auto min-w-7 gap-1.5 px-1.5 text-[13px]")}>
              <SquareTerminal className="size-4" strokeWidth={2} /><span>{c.tui ? "Show terminal" : "Open in terminal"}</span>
            </button>
          )}
          <button type="button" aria-label="More" aria-haspopup="menu" onClick={more} className={ICON}><Ellipsis className="size-4" /></button>
          <PaneControls />
        </div>
      </div>
    </header>
  )
}

const ICON = "grid size-7 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40"

export function Skeleton({ note, retry }: { note?: string; retry?: () => void }) {
  if (note) return <Unreached title={note} body="The chat shows here once it answers." retry={retry} />
  return (
    <div className="loading-in space-y-5 pt-2" aria-busy>
      <div className="ml-auto h-10 rounded-[18px] bg-muted" style={{ width: "40%" }} />
      <div className="space-y-2.5">{["92%", "80%", "60%"].map((w) => <div key={w} className="h-3.5 rounded-chip bg-muted" style={{ width: w }} />)}</div>
      <div className="space-y-2.5 pt-2">{["40%", "33%"].map((w) => <div key={w} className="chat-skel-2 h-3.5 rounded-chip" style={{ width: w }} />)}</div>
    </div>
  )
}

export function Away({ text }: { text: string }) {
  return (
    <div data-chat-away role="status" className="mx-auto mb-1.5 flex w-full chat-column items-center gap-2 px-5 text-[13px] text-muted-foreground max-md:px-4 max-md:text-[15px]">
      <WifiOff className="size-3.5 shrink-0" strokeWidth={2} /><span className="min-w-0 truncate">{/[.…]$/.test(text) ? text : `${text}. Trying again…`}</span>
    </div>
  )
}

export function Unread({ id, retry }: { id: string; retry: () => void }) {
  return <Unreached title="Couldn't load this chat" retry={retry} terminal={id} />
}

function Unreached({ title, body, retry, terminal }: { title: string; body?: string; retry?: () => void; terminal?: string }) {
  const [trying, setTrying] = useState(false)
  const now = () => { if (!retry) return; setTrying(true); retry(); setTimeout(() => setTrying(false), 1500) }
  return (
    <div data-chat-unread className="chat-gone loading-in flex flex-col items-center text-center">
      <WifiOff className="mb-3 size-5 text-muted-foreground" strokeWidth={2} />
      <p className="text-[15px] font-medium max-md:text-[17px]">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[14px] leading-[20px] text-muted-foreground max-md:text-[15px] max-md:leading-[21px]">{body}</p>}
      <div className="chat-gone-acts mt-4 flex gap-2">
        {retry && <Button look="secondary" className="max-md:h-11" busy={trying} onClick={now} data-retry><RotateCcw className="size-3.5" strokeWidth={2.25} />Try now</Button>}
        {terminal && terminalOk(terminal) && <Button look="quiet" className="max-md:h-11" onClick={() => void toTerminal(terminal)}><SquareTerminal className="size-4" strokeWidth={2} />Open in terminal</Button>}
      </div>
    </div>
  )
}

export function Welcome({ children }: { children?: ReactNode }) {
  return (
    <div data-welcome className="flex flex-col items-center text-center">
      <ClaudeIcon className="size-9 max-md:size-10" style={{ color: TINT }} />
      <p className="mt-4 text-[24px] leading-[30px] font-semibold tracking-tight chat-welcome-title">What should Claude work on?</p>
      <p className="mt-1.5 max-w-sm text-[14px] leading-[20px] text-muted-foreground max-md:text-[15px] max-md:leading-[21px]">It runs in the app and keeps going when you close it. What it asks comes here and to your inbox.</p>
      {children && <div className="mt-7 w-full text-left">{children}</div>}
    </div>
  )
}

export function Failed({ id, error, c }: { id: string; error: string; c: ReturnType<typeof useChat> }) {
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try { await op("claude-code.chat-send", { id, text: "Continue where you left off." }) } catch (e) { notifyError(e, "Couldn't try again") }
    setBusy(false)
  }
  return (
    <div data-chat-error role="alert" className="chat-alarm chat-ask-x rounded-card border-[0.5px]">
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-[3px] size-4 shrink-0 text-ink-(--red)" strokeWidth={2.25} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-[22px] font-medium max-md:text-[17px] max-md:leading-[24px]">Claude stopped</p>
          <p className="mt-0.5 text-[14px] leading-[20px] break-words whitespace-pre-wrap text-muted-foreground select-text max-md:text-[15px] max-md:leading-[21px]">{error}</p>
        </div>
      </div>
      <div className="chat-alarm-acts mt-3 flex gap-2">
        <Button look="secondary" className="max-md:h-11" busy={busy} onClick={() => void retry()} data-retry><RotateCcw className="size-3.5" strokeWidth={2.25} />Try again</Button>
        {terminalOk(id) && <Button look="quiet" className="max-md:h-11" disabled={!c.ready} onClick={() => void toTerminal(id)}><SquareTerminal className="size-4" strokeWidth={2} />Open in terminal</Button>}
      </div>
    </div>
  )
}

type Kin = { id: string; agent: string; title: string; state: string; link: string | null }
type Family = { parent: { title: string; link: string | null } | null; children: Kin[] }
const KIN_STATE: Record<string, string> = { working: "Working", waiting: "Waiting", done: "Done", error: "Failed", cancelled: "Cancelled" }
const AGENT_NAME: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode" }

function useFamily(id: string, state: string) {
  const [f, setF] = useState<Family | null>(null)
  useEffect(() => {
    if (!id || id === NEW) return
    let gone = false
    const read = () => void op<Family>("delegate.list", { of: splitMachine(id)[0] }).then((r) => { if (!gone) setF(r.parent || r.children.length ? r : null) }, () => {})
    read()
    const t = setInterval(() => { if (document.visibilityState === "visible" && f?.children.some((k) => k.state === "working" || k.state === "waiting")) read() }, 10_000)
    return () => { gone = true; clearInterval(t) }
  }, [id, state, f?.children.map((k) => k.state).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return f
}

export function Kinfolk({ id, state }: { id: string; state: string }) {
  const f = useFamily(id, state)
  if (!f) return null
  const go = (link: string | null) => { if (link) openView(link.replace(/^view:/, ""), { newTab: !isViewOpen(link.replace(/^view:/, "")) }) }
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground max-md:text-[15px]" data-family>
      {f.parent && <span>Delegated by <button type="button" data-family-parent className="cursor-pointer font-medium text-foreground/80 underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
        onClick={() => go(f.parent!.link)}>{f.parent.title}</button></span>}
      {f.children.length > 0 && <span className="flex flex-wrap items-center gap-1">
        Subagents
        {f.children.map((k) => (
          <button key={k.id} type="button" data-family-child={k.id} onClick={() => go(k.link)} data-tip={`${AGENT_NAME[k.agent] ?? k.agent}: ${k.title}`}
            className="flex h-6 max-w-[220px] cursor-pointer items-center gap-1.5 rounded-control bg-foreground/[0.05] px-2 text-foreground/80 hover:bg-foreground/[0.09] max-md:h-8">
            <span className="truncate">{AGENT_NAME[k.agent] ?? k.agent} · {k.title}</span>
            <span className={cn("shrink-0", k.state === "working" || k.state === "waiting" ? "text-tertiary" : "text-muted-foreground")}>{KIN_STATE[k.state] ?? k.state}</span>
          </button>
        ))}
      </span>}
    </div>
  )
}
