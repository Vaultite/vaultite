// The Ask box (terminal:ask): a question for a coding agent in a new background terminal (terminal.ask), with the files
// pasted or dropped in, then a toast with Open. Where (agent, account, machine): picked under the field, kept per workspace.
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { ArrowUp, ChevronDown, FileText, Server, X } from "lucide-react"
import { accountsOf, agentsOn, cell, cn, defaultPlaceOf, getStore, isViewOpen, keyHint, notify, notifyError, op, openMenu, openView, otherMachines, PaletteFrame,
  pastedFiles, resolvePlace, saveAttachments, useAgents, useDefaultPlace, useMachines, useScopedState, type Agent, type AgentAccount, type MenuItem } from "@vaultite"

const shown = cell(false)
/** Open the Ask box (its field focused, so dictation types into it). */
export const openAsk = () => shown.set(true)

/** Where asks go when the user has picked it in the box (per workspace); what's left out is the workspace's default. */
type AskPlace = { agent?: string; profile?: string; machine?: string }
const NONE: AskPlace = {}

/** The agent asks go to: the one picked, else Claude Code, else the first that's on. */
const agentOf = (list: Agent[], name?: string) => list.find((a) => a.name === name) ?? list.find((a) => a.name === "claude") ?? list[0] ?? null
const speaker = (a: Agent | null) => a?.speaker ?? a?.label ?? "an agent"

// The unsent question, kept on this device until it's asked: clicking off the box or Esc closes it, not loses it.
const DRAFT = "vaultite.ask"
const draftOf = () => { try { return localStorage.getItem(DRAFT) ?? "" } catch { return "" } }
function keepDraft(text: string) {
  try { if (text.trim()) localStorage.setItem(DRAFT, text); else localStorage.removeItem(DRAFT) } catch { /* private mode, full */ }
}

/** A file pasted or dropped in, kept with the draft until it's asked (in memory: a reload lets go of it); `path` once
 *  saved, so asking again after a failure doesn't save it twice. */
type Attached = { id: number; file: File; url?: string; path?: string }
const attached = cell<Attached[]>([])
let nextId = 0
const attach = (files: File[]) => attached.update((l) => [...l, ...files.map((file) => ({ id: ++nextId, file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined }))])
const detach = (ids: number[]) => attached.update((l) => l.filter((x) => { const gone = ids.includes(x.id); if (gone && x.url) URL.revokeObjectURL(x.url); return !gone }))

export function AskBox() {
  return shown.use() ? <Box close={() => shown.set(false)} /> : null
}

function Box({ close }: { close: () => void }) {
  const [text, setText] = useState(draftOf)
  const [sending, setSending] = useState(false)
  const files = attached.use()
  const [over, setOver] = useState(false)
  const [saved, save] = useScopedState<AskPlace>("terminal:ask", NONE, "workspace")
  const home = useDefaultPlace(), machines = useMachines(), agents = useAgents()
  const field = useRef<HTMLTextAreaElement>(null)
  const agent = agentOf(agents, saved.agent)
  const fallback = defaultPlaceOf(agent?.name ?? null, machines, home)
  const machine = saved.machine ?? fallback.machine
  const profile = saved.profile ?? fallback.profile
  const others = otherMachines(machines, "terminal")
  // The ones that could run it but are away: listed, greyed, so the chip and its choices don't come and go with them.
  const away = (machines ?? []).filter((m) => !m.self && !m.online && !m.readOnly && (!m.plugins?.length || m.plugins.includes("terminal")))
  const machineLabel = (machine ? machines?.find((m) => m.id === machine)?.label ?? machine : machines?.find((m) => m.self)?.label) ?? "This machine"
  const accounts = useAccounts(agent, machine)
  const account = accounts.length > 1 ? accounts.find((x) => x.id === profile) ?? accounts[0] : null

  // At the end of a kept draft, so what's typed or dictated next follows it.
  useLayoutEffect(() => {
    const f = field.current
    f?.focus({ preventScroll: true })
    f?.setSelectionRange(f.value.length, f.value.length)
  }, [])
  // The field grows with what's typed (or dictated), up to a third of the screen, then scrolls.
  useLayoutEffect(() => {
    const f = field.current
    if (!f) return
    f.style.height = "auto"
    f.style.height = `${f.scrollHeight}px`
  }, [text])

  const send = async () => {
    const prompt = text.trim()
    if (!prompt || sending || !agent) return
    setSending(true)
    try {
      // (saved first, where pasted files go: on another machine the ask waits for its copies)
      const unsaved = files.filter((x) => !x.path), s = getStore()
      if (unsaved.length) {
        if (!s) throw new Error("The vault isn't loaded yet")
        const paths = await saveAttachments(s, "", unsaved.map((x) => x.file))
        unsaved.forEach((x, i) => { x.path = paths[i] })
      }
      const given = files.map((x) => x.path!)
      // Nothing picked here: the workspace's default, which gives way to this machine when that one's away.
      // A machine picked here that's away now: this one, said in the toast.
      const at = saved.machine === undefined ? await resolvePlace(agent.name, { profile: saved.profile })
        : machine && away.some((m) => m.id === machine) ? { machine: "", profile, instead: `${machineLabel} is offline` } : { machine, profile, instead: "" }
      const r = await op<{ id: string; title: string }>("terminal.ask", { prompt, agent: agent.name, ...(at.profile ? { account: at.profile } : {}),
        ...(at.machine ? { machine: at.machine } : {}), ...(given.length ? { files: given } : {}) })
      keepDraft("")
      detach(files.map((x) => x.id))
      close()
      const to = `terminal/${r.id}`
      notify(`Asked ${speaker(agent)}: ${r.title}${at.instead ? ` (${at.instead}: on this machine)` : ""}`, {
        action: { label: "Open", run: () => openView(to, { newTab: !isViewOpen(to) }) } })
    } catch (e) {
      setSending(false)
      notifyError(e, `Couldn't ask ${speaker(agent)}`)
      field.current?.focus()
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const got = pastedFiles(e.clipboardData)
    if (!got.length) return
    e.preventDefault()
    attach(got)
  }
  const dragsFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files")
  const onDragOver = (e: DragEvent) => { if (!dragsFiles(e) || sending) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true) }
  const onDrop = (e: DragEvent) => {
    setOver(false)
    if (!dragsFiles(e) || sending) return
    e.preventDefault()
    attach([...e.dataTransfer.files])
    field.current?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
  }

  /** A menu under the chip clicked, built once what it lists is known; picking in it gives the field the keyboard back. */
  const menuUnder = async (e: MouseEvent, build: () => Promise<MenuItem[]> | MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items = (await build()).map((it) => ({ ...it, run: () => { it.run(); setTimeout(() => field.current?.focus(), 0) } }))
    openMenu({ x: r.left, y: r.bottom + 4 }, items)
  }
  const whoMenu = () => Promise.all(agentsOn().filter((a) => !machine || machines?.find((m) => m.id === machine)?.plugins?.includes(a.plugin))
    .map(async (a): Promise<MenuItem[]> => {
      const list = await accountsOf(a, machine)
      if (list.length < 2) return [{ label: a.label, icon: a.icon, checked: a.name === agent?.name, run: () => save({ ...saved, agent: a.name, profile: undefined }) }]
      return list.map((x) => ({ label: `${a.label} · ${x.label}`, icon: a.icon, checked: a.name === agent?.name && x.id === account?.id,
        run: () => save({ ...saved, agent: a.name, profile: x.id }) }))
    })).then((rows) => rows.flat())
  const whereMenu = (): MenuItem[] => [
    { label: machines?.find((m) => m.self)?.label ?? "This machine", icon: Server, checked: !machine, run: () => save({ ...saved, machine: "" }) },
    ...others.map((m) => ({ label: m.label, icon: Server, checked: m.id === machine, run: () => save({ ...saved, machine: m.id }) })),
    ...away.map((m) => ({ label: m.label, icon: Server, disabled: true, hint: "Offline", run: () => {} })),
  ]

  const Icon = agent?.icon
  return (
    <PaletteFrame label="Ask an agent" onClose={close}>
      <div data-ask-box onDragOver={onDragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }} onDrop={onDrop}
        className={cn("flex flex-col", over && "bg-primary/[0.06] ring-1 ring-primary ring-inset")}>
        {files.length > 0 && (
          <div data-ask-files className={cn("flex flex-wrap gap-2 px-4 pt-4", sending && "opacity-60")}>
            {files.map((x) => <Thumb key={x.id} item={x} remove={sending ? undefined : () => { detach([x.id]); field.current?.focus() }} />)}
          </div>
        )}
        <textarea ref={field} value={text} onChange={(e) => { setText(e.target.value); keepDraft(e.target.value) }} onKeyDown={onKey} onPaste={onPaste} rows={1} disabled={sending}
          placeholder={`Ask ${speaker(agent)}…`} aria-label={`Ask ${speaker(agent)}`} enterKeyHint="send"
          className="max-h-[33dvh] min-h-14 w-full resize-none overflow-y-auto bg-transparent px-5 py-4 text-[17px] leading-[24px] outline-none placeholder:text-muted-foreground" />
        <div className="flex items-center gap-1.5 border-t-[0.5px] border-border px-3 py-2">
          <Chip onClick={(e) => void menuUnder(e, whoMenu)} label="Agent">
            {Icon && <Icon className="size-4 shrink-0" style={{ color: agent?.tint }} />}
            <span className="truncate">{agent ? [agent.label, account?.label].filter(Boolean).join(" · ") : "No agent"}</span>
          </Chip>
          {(others.length > 0 || away.length > 0 || machine) && (
            <Chip onClick={(e) => void menuUnder(e, whereMenu)} label="Machine">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{machineLabel}</span>
            </Chip>
          )}
          <span className="hidden flex-1 text-right text-[13px] whitespace-nowrap text-muted-foreground md:block">
            <span className="font-keys font-semibold text-foreground/80">{keyHint("Enter")}</span> to ask in the background
          </span>
          <span className="flex-1 md:hidden" />
          <button type="button" aria-label="Ask" disabled={!text.trim() || sending || !agent} onClick={() => void send()}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground disabled:cursor-default disabled:opacity-40 md:size-7">
            <ArrowUp className="size-5 md:size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </PaletteFrame>
  )
}

/** A file going with the question: an image's thumbnail, else its name; its x takes it off. */
function Thumb({ item, remove }: { item: Attached; remove?: () => void }) {
  const name = item.file.name || "Pasted image"
  return (
    <div data-ask-file className="group relative">
      {item.url
        ? <img src={item.url} alt={name} className="size-14 rounded-[8px] border-[0.5px] border-border object-cover" />
        : (
          <div className="flex h-14 max-w-48 items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-foreground/[0.04] px-3 text-[13px]">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
          </div>
        )}
      {remove && (
        <button type="button" aria-label={`Remove ${name}`} onClick={remove}
          className="absolute -top-1.5 -right-1.5 grid size-5 cursor-pointer place-items-center rounded-full border-[0.5px] border-border bg-popover text-muted-foreground shadow-sm after:absolute after:-inset-3 hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:after:hidden">
          <X className="size-3" strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}

/** A picker in the row under the field, like a model picker: what's chosen, a menu of the others. */
function Chip({ onClick, label, children }: { onClick: (e: MouseEvent) => void; label: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-haspopup="menu" onClick={onClick}
      className="flex h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 text-[15px] text-foreground/90 hover:bg-foreground/[0.06] md:h-7 md:text-[13px]">
      {children}
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** Agent `a`'s accounts on `machine` when it has several (else none), for the chip's label. */
function useAccounts(a: Agent | null, machine: string) {
  const [list, setList] = useState<AgentAccount[]>([])
  useEffect(() => {
    let live = true
    setList([])
    if (a) void accountsOf(a, machine).then((l) => { if (live) setList(l) })
    return () => { live = false }
  }, [a?.name, machine]) // eslint-disable-line react-hooks/exhaustive-deps
  return list
}
