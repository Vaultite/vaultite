import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { ArrowUp, ChevronDown, Clock, Folder, Plus, Square, X } from "lucide-react"
import { cn, formatSize, haptic, ink, notify, notifyError, op, openMenu, useScopedState, type MenuItem } from "@vaultite"
import { NEW } from "./titles"
import { seenOf } from "./seen"
import type { Entry } from "./chatlog"
import { type Mode, useChat } from "./useChat"
import { type Ask, type Options, STRONG, home, modelLabel, folderName, EFFORT, MODE_SHORT } from "./chatbits"
import { AskCard, type AskKeys } from "./Asks"
import { type Picture, MAX_PICTURES, draftPictures, keepPictures, picturesIn, readPicture } from "./images"

type UserEntry = Extract<Entry, { k: "user" }>
type Picks = { model?: string; effort?: string; mode?: Mode; account?: string; cwd?: string }
export type Queued = { id: string; text: string }

export function Composer({ id, fresh, c, o, asks, working, queued, setArg, onSent }: { id: string; fresh: boolean; c: ReturnType<typeof useChat>; o: Options | null
  asks: Ask[]
  working: boolean; queued: Queued[]; setArg: (arg: string) => void
  onSent: (sent: { uuid?: string; text: string; queued: boolean }) => void }) {
  const DRAFT = `vaultite.chat.${fresh ? NEW : id}`
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT) ?? "" } catch { return "" } })
  const [pics, setPics] = useState<Picture[]>(() => draftPictures(DRAFT))
  const [reading, setReading] = useState(0)
  const [sending, setSending] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [saved, save] = useScopedState<Picks>("claude-code:chat", {}, "workspace")
  const [next, setNext] = useState<Picks>({})
  const field = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const askKeys = useRef<AskKeys | null>(null)
  const pending = asks[0] ?? null
  const keep = (v: string) => { setText(v); try { if (v.trim()) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT) } catch { /* private mode */ } }
  const keepPics = (ps: Picture[]) => { setPics(ps); keepPictures(DRAFT, ps) }
  useLayoutEffect(() => { const f = field.current; if (f) { f.style.height = "auto"; f.style.height = `${f.scrollHeight}px` } }, [text])
  useEffect(() => { if (fresh) field.current?.focus({ preventScroll: true }) }, [fresh])

  const picsNow = useRef(pics)
  useLayoutEffect(() => { picsNow.current = pics })
  const add = async (files: File[], pasted = false) => {
    const room = MAX_PICTURES - picsNow.current.length
    if (!files.length) return
    if (room <= 0) return notify(`A message takes ${MAX_PICTURES} pictures at most`)
    if (files.length > room) notify(`Added ${room}: a message takes ${MAX_PICTURES} pictures at most`)
    setReading((n) => n + 1)
    try {
      const read = await Promise.all(files.slice(0, room).map((f) => readPicture(f, pasted).catch((e) => { notifyError(e, `Couldn't add ${f.name || "the picture"}`); return null })))
      keepPics([...picsNow.current, ...read.filter((p): p is Picture => !!p)])
    } finally { setReading((n) => n - 1) }
    field.current?.focus({ preventScroll: true })
  }
  const addRef = useRef(add)
  useLayoutEffect(() => { addRef.current = add })
  useEffect(() => {
    const chat = box.current?.closest<HTMLElement>("[data-chat]")
    if (!chat) return
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files")
    let depth = 0
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDropping(true) } }
    const over = (e: DragEvent) => { if (files(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy" } }
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDropping(false) } }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault(); depth = 0; setDropping(false)
      const got = picturesIn(e.dataTransfer!.files)
      if (got.length) void addRef.current(got); else notify("Only pictures can be added to a message")
    }
    chat.addEventListener("dragenter", enter); chat.addEventListener("dragover", over); chat.addEventListener("dragleave", leave); chat.addEventListener("drop", drop)
    return () => { chat.removeEventListener("dragenter", enter); chat.removeEventListener("dragover", over); chat.removeEventListener("dragleave", leave); chat.removeEventListener("drop", drop) }
  }, [])
  const onPaste = (e: ClipboardEvent) => {
    const got = picturesIn(e.clipboardData.files)
    if (!got.length) return
    e.preventDefault()
    void add(got, true)
  }

  const picks: Picks = fresh ? saved : { model: c.s?.model || c.model || seenOf(id)?.model || undefined, effort: c.s?.effort || undefined, mode: c.s?.mode, ...next }
  const blocked = !fresh && c.ready && (c.tui !== null || !c.found)
  const said = text.trim()
  const away = !fresh && !!c.unreachable
  const ready = (!!said || pics.length > 0) && !sending && !blocked && !reading && !away
  const send = async () => {
    if (!ready) return
    setSending(true)
    const images = pics.map((p) => ({ data: p.data, type: p.type }))
    try {
      if (fresh) {
        const r = await op<{ id: string }>("claude-code.chat-start", { prompt: said, ...(images.length ? { images } : {}), ...(saved.cwd ? { cwd: saved.cwd } : {}), ...(saved.account ? { account: saved.account } : {}),
          ...(saved.model ? { model: saved.model } : {}), ...(saved.effort ? { effort: saved.effort } : {}), ...(saved.mode ? { mode: saved.mode } : {}) })
        keep(""); keepPics([])
        setArg(r.id)
        onSent({ text: said, queued: false })
      } else {
        const r = await op<{ uuid?: string; answered?: string }>("claude-code.chat-send", { id, text: said, ...(images.length ? { images } : {}), ...next })
        keep(""); keepPics([])
        setNext({})
        onSent({ uuid: r?.uuid || undefined, text: said, queued: r?.uuid !== "" && (working || !!r?.answered) })
      }
    } catch (e) { notifyError(e, fresh ? "Couldn't start the chat" : "Couldn't send it") }
    setSending(false)
    field.current?.focus({ preventScroll: true })
  }
  const stop = async () => {
    let taken: UserEntry[] = []
    try { taken = (await op<{ taken?: UserEntry[] }>("claude-code.chat-interrupt", { id }))?.taken ?? [] } catch (e) { return notifyError(e, "Couldn't stop it") }
    if (!taken.length) return
    const words = taken.map((e) => e.text.trim()).filter(Boolean)
    if (words.length) keep([...words, text.trim()].filter(Boolean).join("\n\n"))
    const srcs = taken.flatMap((e) => e.images ?? []).map((i) => (/^(api\/|\/|https?:)/.test(i.src) ? i.src : `api/claude-code/chat/${encodeURIComponent(id)}/${i.src}`))
    const files = await Promise.all(srcs.map((src, n) => fetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? new File([b], `Picture ${n + 1}`, { type: b.type }) : null), () => null)))
    await add(files.filter((f): f is File => !!f))
    notify(taken.length > 1 ? "Stopped: your queued messages are back in the box" : "Stopped: your queued message is back in the box")
    field.current?.focus({ preventScroll: true })
  }
  const onKey = (e: KeyboardEvent) => {
    const empty = !text && !pics.length, ask = askKeys.current
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (empty && ask?.yes) ask.yes(); else void send()
    } else if (e.key === "Escape" && empty && ask?.no) { e.preventDefault(); ask.no() }
    else if (e.key === "Escape" && working && empty) { e.preventDefault(); void stop() }
    else if (empty && ask?.pick && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); ask.pick(Number(e.key)) }
  }
  const choose = (p: Picks) => {
    if (fresh) return save({ ...saved, ...p })
    if (!c.ready) return
    if (!c.s) return setNext((n) => ({ ...n, ...p }))
    void op("claude-code.chat-set", { id, ...p }).catch((e) => notifyError(e, "Couldn't change it"))
  }
  const menu = (e: MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const refocus = (it: MenuItem): MenuItem => ({ ...it, run: () => { it.run(); setTimeout(() => field.current?.focus({ preventScroll: true }), 0) } })
    openMenu({ x: r.left, y: r.top - 4, flip: r.bottom + 4 }, items.map(refocus), true)
  }
  const loading = fresh ? !o : !c.ready || !o
  const accountModel = o?.accounts.find((a) => a.id === (fresh ? saved.account ?? "default" : c.account))?.model ?? o?.accounts[0]?.model ?? ""
  const model = picks.model ? modelLabel(picks.model, o) : accountModel ? modelLabel(accountModel, o) : "Default model"
  const effort = picks.effort || (fresh ? o?.accounts.find((a) => a.id === (saved.account ?? "default"))?.effort ?? o?.accounts[0]?.effort : c.effort) || ""
  const modeId: Mode = picks.mode ?? o?.accounts.find((a) => a.id === (fresh ? saved.account ?? "default" : c.account))?.mode ?? o?.accounts[0]?.mode ?? "auto"
  const mode = o?.modes.find((m) => m.id === modeId)?.label ?? "Auto mode"
  const account = o && o.accounts.length > 1 ? o.accounts.find((a) => a.id === (picks.account ?? c.account))?.label ?? o.accounts[0]?.label : ""
  const folder = fresh ? (saved.cwd || o?.vault || "") : ""
  const placeholder = away ? "Can't send till it answers…" : blocked ? (c.tui !== null ? "It runs in a terminal: answer it there" : "Nothing to reply to") : pending?.kind === "permission" ? "Or tell Claude what to do instead…"
    : pending?.kind === "question" ? (pending.questions?.length === 1 && !pending.questions[0].multi ? "Or type your own answer…" : "Or tell Claude something else…") : pending?.kind === "plan" ? "Or tell Claude what to change…" : working ? "Queue a message for Claude…" : fresh ? "Ask Claude to…" : "Reply to Claude…"
  const modelItems: MenuItem[] = [
    { label: accountModel ? `Default (${modelLabel(accountModel, o)})` : "Default model", checked: !picks.model, run: () => choose({ model: undefined }) },
    ...(o?.models ?? []).map((m) => ({ label: m.label, checked: m.id === picks.model || modelLabel(picks.model ?? "", o).startsWith(m.label), run: () => choose({ model: m.id }) })),
    ...(o?.efforts ?? []).map((x, n) => ({ label: `${EFFORT[x] ?? x} effort`, sep: n === 0, checked: x === effort, run: () => choose({ effort: x }) })),
  ]
  const stopping = working && !said && !pics.length
  return (
    <div className="chat-dock shrink-0" data-composer>
      <div className="mx-auto flex w-full chat-column flex-col gap-2">
        {pending && <AskCard key={pending.id} e={pending} id={id} pending docked of={[1, asks.length]} bind={(k) => { askKeys.current = k }} />}
        {queued.map((q, n) => (
          <div key={q.id} data-queued
            className="chat-queued flex max-w-[85%] items-center gap-2 rounded-[18px] border-[0.5px] border-dashed border-foreground/25 bg-muted/50 py-1 pr-1 pl-2.5 text-[14px] max-md:text-[16px]">
            <Clock className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
            <span className="line-clamp-2 min-w-0 break-words" data-tip="Queued: Claude reads it between its steps">{q.text || "Pictures"}</span>
            {/* Claude Code gives queued messages back only all at once, by stopping its turn */}
            {n === queued.length - 1 ? (
              <button type="button" data-queued-edit onClick={() => void stop()} data-tip="Stops Claude's turn and puts what you queued back here to edit or remove"
                className="shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground max-md:min-h-11 max-md:text-[14px]">Stop and edit</button>
            ) : <span className="shrink-0 pr-2 text-[12px] text-tertiary max-md:text-[13px]">Queued</span>}
          </div>
        ))}
        <div ref={box} data-dropping={dropping || undefined}
          className={cn("chat-box relative rounded-card border-[0.5px] border-border chat-float bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-foreground/25",
            dropping && "ring-2 ring-foreground/15")}>
          {dropping && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-card bg-card/90 text-[14px] font-medium text-foreground max-md:text-[16px]">Drop pictures to add them</div>}
          {(pics.length > 0 || reading > 0) && (
            <div data-pictures className="flex gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
              {pics.map((p) => <Thumb key={p.id} p={p} remove={() => { haptic("light"); keepPics(pics.filter((x) => x !== p)) }} />)}
              {reading > 0 && <div aria-label="Adding a picture" className="chat-pic shrink-0 animate-pulse rounded-control bg-muted" />}
            </div>
          )}
          <textarea ref={field} value={text} rows={1} disabled={blocked} onChange={(e) => keep(e.target.value)} onKeyDown={onKey} onPaste={onPaste} enterKeyHint="send"
            placeholder={placeholder} aria-label="Message Claude" data-fresh={fresh || undefined}
            className="chat-field resize-none overflow-y-auto bg-transparent outline-none placeholder:text-muted-foreground" />
          <div className="chat-foot">
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/*" multiple hidden data-attach-input
              onChange={(e) => { const fs = picturesIn(e.target.files ?? []); e.target.value = ""; void add(fs) }} />
            <button type="button" aria-label="Add pictures" data-tip={"Add pictures\nOr paste them, or drop them here"} data-attach disabled={blocked} onClick={() => picker.current?.click()}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:size-11">
              <Plus className="chat-plus" strokeWidth={2} />
            </button>
            <div data-chips className="flex min-w-0 flex-1 items-center gap-0.5 chat-chips overflow-x-auto pr-3 [scrollbar-width:none]">
              {loading && away ? null : loading ? <><ChipSkeleton w="w-16" /><ChipSkeleton w="w-24" /><span className="ml-auto" /><ChipSkeleton w="w-28" /></> : <>
                <Chip label="Permission mode" onClick={(e) => menu(e, (o?.modes ?? []).filter((m) => m.id !== "dontAsk").map((m) => ({ label: m.label, checked: m.id === modeId,
                  danger: m.id === "bypassPermissions", run: () => choose({ mode: m.id }) })))}>
                  <span className={cn(modeId === "bypassPermissions" && "text-ink-(--red)")} style={modeId === "plan" ? { color: ink("var(--teal)") } : undefined}>
                    <span className="max-md:hidden">{mode}</span><span className="md:hidden">{MODE_SHORT[modeId] ?? mode}</span>
                  </span>
                </Chip>
                {fresh && account && <Chip label="Account" onClick={(e) => menu(e, (o?.accounts ?? []).map((a) => ({ label: a.label, checked: a.label === account, run: () => choose({ account: a.id }) })))}>{account}</Chip>}
                {fresh && <Chip label="Folder" tip={folder ? home(folder, o?.home) : undefined} onClick={(e) => menu(e, folderItems(o, folder, (cwd) => choose({ cwd })))}>
                  <Folder className="size-3.5 shrink-0" strokeWidth={2} />{folder ? folderName(folder, o) : "Folder"}</Chip>}
                <span className="ml-auto" />
                <Chip label="Model and effort" onClick={(e) => menu(e, modelItems)}>
                  {model}
                  {effort && <span className="text-tertiary max-md:hidden"> · {EFFORT[effort] ?? effort}</span>}
                </Chip>
              </>}
            </div>
            {stopping ? (
              <button type="button" aria-label="Stop" data-tip="Stop (Esc)" onClick={() => void stop()} data-stop
                className={cn("grid size-8 shrink-0 cursor-pointer place-items-center rounded-full max-md:size-11", STRONG)}>
                <Square className="size-3 fill-current max-md:size-3.5" />
              </button>
            ) : (
              <button type="button" aria-label={working && !pending ? "Queue" : "Send"} disabled={!ready} onClick={() => void send()} data-send
                data-tip={away ? `Can't send: ${c.unreachable}` : working && !pending ? "Queue it: Claude reads it between its steps" : undefined}
                className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-150 max-md:size-11",
                  ready ? cn("cursor-pointer", STRONG) : "chat-send-off")}>
                <ArrowUp className="size-4 max-md:size-5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Thumb({ p, remove }: { p: Picture; remove: () => void }) {
  return (
    <div data-picture className="chat-pic group/pic relative flex shrink-0 items-center gap-2.5 rounded-control border-[0.5px] border-border bg-background/60 p-1.5 pr-3">
      <img src={p.url} alt="" draggable={false} className="h-full aspect-square shrink-0 rounded-chip bg-muted object-cover" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span data-picture-name className="truncate text-[13px] font-medium max-md:text-[15px]">{p.name}</span>
        <span className="text-[12px] text-muted-foreground tabular-nums max-md:text-[13px]">{formatSize(p.size)}</span>
      </span>
      <button type="button" aria-label={`Remove ${p.name}`} onClick={remove} data-remove-picture
        className="chat-pic-hit grid cursor-pointer place-items-center">
        <span className="grid size-5 place-items-center rounded-full bg-foreground text-background chat-pic-x">
          <X className="size-3" strokeWidth={2.75} />
        </span>
      </button>
    </div>
  )
}

function folderItems(o: Options | null, at: string, pick: (cwd: string) => void): MenuItem[] {
  if (!o) return []
  const list = [o.vault, ...o.folders.filter((f) => f !== o.vault)]
  return list.map((f, n) => ({ label: folderName(f, o), hint: home(f, o.home), checked: f === (at || o.vault), sep: n === 1, run: () => pick(f) }))
}

function ChipSkeleton({ w }: { w: string }) {
  return <span aria-hidden className={cn("chat-chip-skel mx-1 shrink-0 rounded-chip bg-muted", w)} />
}

function Chip({ label, tip, onClick, children }: { label: string; tip?: string; onClick: (e: MouseEvent) => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-haspopup="menu" onClick={onClick} data-tip={tip}
      className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control px-2 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:h-11 max-md:px-2 max-md:text-[15px]">
      {children}
      <ChevronDown className="size-3 shrink-0 opacity-70" />
    </button>
  )
}

