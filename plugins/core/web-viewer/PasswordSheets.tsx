// A password's sheets: its detail (copy, reveal, its one-time code, agents' uses of it) and its form (edit or new,
// with a generator). Both show the lock while the file is locked, and read the entry afresh after every write.
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"
import { Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Trash2, Wand2, X } from "lucide-react"
import {
  afterSheets, backDetail, Button, cn, dateText, detailPath, Empty, Group, Loading, menuBelow, notifyError, openDetail, openWebLink, replaceDetail, Section,
  SheetHead, Slider, Switch, useBusy, useSheetGuard,
} from "@vaultite"
import { generatePassword, GEN_DEFAULTS, type GenOptions } from "./generate"
import { siteIcon } from "./icons"
import { LockScreen, Marks, removeEntry, UseRow, useUses } from "./Passwords"
import {
  call, copySecret, EDIT_DETAIL, ENTRY_DETAIL, FREE_TAG, groupPath, hasPasswords, lockedNow, sharedGroups, state, usePasswordsLive, usesOf, webUrl,
  type Change, type Full, type Group as KdbxGroup,
} from "./passwordstore"

const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
const field = "h-11 w-full min-w-0 rounded-control border-[0.5px] border-border bg-card px-3 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-8 md:text-[14px]"

/** The entry, read again whenever the list changes (a write here or elsewhere); null once it's gone. */
function useFull(id: string | undefined) {
  const { status, entries } = usePasswordsLive()
  const [full, setFull] = useState<Full | null | undefined>(undefined)
  const open = !!status && !status.locked && !status.error && !!entries
  useEffect(() => {
    if (!id || !open) return
    let stop = false
    call<Full>("get", id).then((f) => { if (!stop) setFull(f) }, (e) => { if (!stop && !lockedNow(e)) setFull(null) })
    return () => { stop = true }
  }, [id, open, entries])
  return { status, open, full: id ? full : null, again: () => id && call<Full>("get", id).then(setFull, (e) => { if (!lockedNow(e)) setFull(null) }) }
}

function Gate({ children }: { children: ReactNode }) {
  const { status, entries } = usePasswordsLive()
  if (!hasPasswords()) return <Empty>Your passwords open in Vaultite's desktop app.</Empty>
  if (status === undefined) return <Loading />
  if (!status) return <Empty>No KeePass file is open on this computer.</Empty>
  if (status.locked || status.error || !entries) return <LockScreen status={status} />
  return <>{children}</>
}

// ---------- the detail ----------

export function EntrySheet({ id }: { id: string }) {
  return <Gate><Entry id={id} /></Gate>
}

function Entry({ id }: { id: string }) {
  const { full, again } = useFull(id)
  const { groups } = state.use()
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const [shown, setShown] = useState(false)
  if (full === undefined) return <Loading />
  if (!full) return <Empty>This password is gone from the file.</Empty>
  const where = groupPath(byId, full.group)
  return (
    <div className="flex flex-col gap-5" data-password-sheet={full.title}>
      <SheetHead icon={full.urls[0] ? siteIcon(webUrl(full.urls[0])) : KeyRound} tint="var(--foreground)" kicker={where || "Passwords"} title={full.title || "Untitled"}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button className="h-11 px-3 md:h-8" onClick={() => openDetail(detailPath(EDIT_DETAIL, full.id))} data-password-edit><Pencil className="size-4" />Edit</Button>
          <Button look="quiet" className="h-11 px-3 md:h-8" onClick={() => { backDetail(); void removeEntry(full, full) }} data-password-delete><Trash2 className="size-4" />Delete</Button>
          <span className="ml-auto flex gap-1.5"><Marks e={full} /></span>
        </div>
      </SheetHead>
      <Group>
        {full.username && <Field label="Username" value={full.username} actions={<Act icon={Copy} label="Copy username" run={() => void copySecret(full.username, "username")} />} />}
        <Field label="Password" mono={shown} value={full.password ? (shown ? full.password : "•".repeat(12)) : ""} data-password-value={shown ? "shown" : "hidden"}
          actions={full.password && <>
            <Act icon={shown ? EyeOff : Eye} label={shown ? "Hide password" : "Show password"} run={() => setShown(!shown)} />
            <Act icon={Copy} label="Copy password" run={() => void copySecret(full.password, "password")} />
          </>} />
        {full.code && <Code code={full.code} uri={full.otpUri} again={() => void again()} />}
        {full.urls.map((u, i) => (
          <Field key={i} label={full.urls.length > 1 ? `Website ${i + 1}` : "Website"} value={u}
            actions={<Act icon={ExternalLink} label="Open website" run={() => afterSheets(() => openWebLink(webUrl(u)))} />} />
        ))}
      </Group>
      {!!full.tags.length && (
        <div className="flex flex-wrap gap-1.5" data-password-tags>
          {full.tags.map((t) => <span key={t} className="rounded-chip bg-foreground/[0.06] px-2 py-0.5 text-[13px] text-muted-foreground">{t}</span>)}
        </div>
      )}
      {full.notes && (
        <Section title="Notes">
          <p className="rounded-[10px] bg-foreground/[0.04] px-3 py-2.5 text-[15px] leading-[20px] break-words whitespace-pre-wrap select-text md:text-[14px]">{full.notes}</p>
        </Section>
      )}
      <EntryUses e={full} />
      <p className="text-[13px] text-tertiary">Changed {dateText(full.modified, DAY)}</p>
    </div>
  )
}

function EntryUses({ e }: { e: Full }) {
  const uses = useUses()
  if (!uses) return null
  const mine = usesOf(uses, e)
  if (!mine.length && !e.shared) return null
  return (
    <Section title="Used by agents">
      {mine.length ? <div className="flex flex-col">{mine.slice(0, 20).map((u, i) => <UseRow key={`${u.t}-${i}`} u={u} />)}</div>
        : <Empty>No agent has used it yet.</Empty>}
    </Section>
  )
}

function Field({ label, value, mono, actions, ...rest }: { label: string; value: string; mono?: boolean; actions?: ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="flex min-h-14 items-center gap-2 py-2" {...rest}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted-foreground md:text-[12px]">{label}</div>
        <div className={cn("text-[17px] leading-[22px] break-all select-text md:text-[14px] md:leading-[20px]", mono && "font-mono", !value && "text-tertiary")}>{value || "None"}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-0.5">{actions}</div>}
    </div>
  )
}

function Act({ icon: Icon, label, run }: { icon: typeof Copy; label: string; run: (e: MouseEvent) => void }) {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={run}
      className="grid size-11 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-8">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}

const leftOf = (period: number) => period - (Math.floor(Date.now() / 1000) % period)

/** The one-time code, with what's left of its period; a new one is read as it ends. */
function Code({ code, uri, again }: { code: string; uri: string; again: () => void }) {
  const period = Number(/[?&](?:period|step)=(\d+)/i.exec(uri)?.[1]) || 30
  const [s, setS] = useState(() => leftOf(period))
  const ask = useRef(again)
  useEffect(() => { ask.current = again })
  useEffect(() => {
    const t = setInterval(() => { const n = leftOf(period); setS(n); if (n === period) ask.current() }, 1000)
    return () => clearInterval(t)
  }, [period])
  const shown = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code
  const r = 7, len = 2 * Math.PI * r
  return (
    <Field label="One-time code" mono value={shown} data-password-code
      actions={<>
        <span className="grid size-11 place-items-center md:size-8" data-tip={`${s} seconds left`} aria-label={`${s} seconds left`}>
          <svg viewBox="0 0 18 18" className={cn("size-[18px] -rotate-90", s <= 5 ? "text-[var(--red)]" : "text-primary")}>
            <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} />
            <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray={len} strokeDashoffset={len * (1 - s / period)} />
          </svg>
        </span>
        <Act icon={Copy} label="Copy one-time code" run={() => void copySecret(code, "one-time code")} />
      </>} />
  )
}

// ---------- the form ----------

export function EditSheet({ id, group }: { id?: string; group?: string }) {
  return <Gate><Edit id={id} group={group} /></Gate>
}

const genOptions = { current: GEN_DEFAULTS }

function Edit({ id, group }: { id?: string; group?: string }) {
  const { full } = useFull(id)
  if (id && full === undefined) return <Loading />
  if (id && !full) return <Empty>This password is gone from the file.</Empty>
  return <Form key={full?.id ?? "new"} full={full ?? null} group={group} />
}

function Form({ full, group }: { full: Full | null; group?: string }) {
  const { groups, entries } = state.use()
  const root = groups.find((g) => g.parent === null)
  const [start] = useState(() => ({
    title: full?.title ?? "", username: full?.username ?? "", password: full?.password ?? "", urls: full?.urls.length ? full.urls : [""],
    tags: (full?.tags ?? []).filter((t) => t !== FREE_TAG).join(", "), notes: full?.notes ?? "", free: !!full?.free,
    group: full?.group ?? (group && groups.some((g) => g.id === group && !g.bin) ? group : root?.id ?? ""),
  }))
  const [v, setV] = useState(start)
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((o) => ({ ...o, [k]: x }))
  const [shown, setShown] = useState(!full)
  const [gen, setGen] = useState(false)
  const [busy, run] = useBusy()
  const saved = useRef(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(start)
  useSheetGuard(() => (dirty && !saved.current ? [full ? `Your changes to ${full.title || "this password"}` : `The new password${v.title ? ` ${v.title}` : ""}`] : []))
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const shared = useMemo(() => sharedGroups(groups, entries ?? []), [groups, entries])
  const canFree = shared.has(v.group)
  const generate = (o: GenOptions = genOptions.current) => { genOptions.current = o; set("password", generatePassword(o)); setShown(true) }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const tags = v.tags.split(",").map((t) => t.trim()).filter((t) => t && t !== FREE_TAG)
    // (the switch speaks only for entries agents can reach; elsewhere the tag stays as it was)
    if (canFree ? v.free : start.free) tags.push(FREE_TAG)
    const change: Change = { ...(full ? { id: full.id } : {}), group: v.group || undefined, title: v.title.trim(), username: v.username.trim(), password: v.password,
      urls: v.urls.map((u) => u.trim()).filter(Boolean), tags, notes: v.notes }
    void run(async () => {
      try {
        const r = await call<{ id: string }>("save", change)
        saved.current = true
        if (full) backDetail()
        else replaceDetail(detailPath(ENTRY_DETAIL, r.id))
      } catch (err) { if (!lockedNow(err)) notifyError(err, full ? "Couldn't save it" : "Couldn't add it") }
    })
  }
  const pickGroup = (e: MouseEvent) => menuBelow(e, groups.filter((g) => !g.bin).map((g) => ({
    label: g.parent ? groupPath(byId, g.id) : g.name || "Top level", checked: g.id === v.group, run: () => set("group", g.id),
  })).sort((a, b) => (a.label === (root?.name || "Top level") ? -1 : b.label === (root?.name || "Top level") ? 1 : a.label.localeCompare(b.label))))
  const groupName = (g: KdbxGroup | undefined) => (g ? (g.parent ? groupPath(byId, g.id) : g.name || "Top level") : "Top level")

  return (
    <form onSubmit={save} className="flex flex-col gap-4" data-password-form={full ? "edit" : "new"}>
      <SheetHead icon={KeyRound} tint="var(--foreground)" kicker="Passwords" title={full ? `Edit ${full.title || "password"}` : "New password"} />
      <Labelled label="Title">
        <input value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus={!full} placeholder="Lighthouse" className={field} aria-label="Title" data-password-field="title" />
      </Labelled>
      <Labelled label="Username">
        <input value={v.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" spellCheck={false} className={field} aria-label="Username" data-password-field="username" />
      </Labelled>
      <Labelled label="Password">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input type={shown ? "text" : "password"} value={v.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" spellCheck={false}
              className={cn(field, "pr-10 font-mono")} aria-label="Password" data-password-field="password" />
            <button type="button" aria-label={shown ? "Hide password" : "Show password"} data-tip={shown ? "Hide password" : "Show password"} onClick={() => setShown(!shown)}
              className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-muted-foreground hover:text-foreground md:size-6">
              {shown ? <EyeOff className="size-4" strokeWidth={2} /> : <Eye className="size-4" strokeWidth={2} />}
            </button>
          </div>
          <Button className="h-11 md:h-8" onClick={() => { if (!gen) setGen(true); generate() }} data-password-generate><Wand2 className="size-4" />Generate</Button>
        </div>
        {gen && <Generator generate={generate} close={() => setGen(false)} />}
      </Labelled>
      <Labelled label="Websites">
        <div className="flex flex-col gap-2">
          {v.urls.map((u, i) => (
            <div key={i} className="flex gap-1">
              <input value={u} onChange={(e) => set("urls", v.urls.map((x, j) => (j === i ? e.target.value : x)))} placeholder="https://lighthouse.example.com" autoComplete="off" spellCheck={false}
                aria-label={`Website ${i + 1}`} className={field} data-password-field="url" />
              {v.urls.length > 1 && <Act icon={X} label="Remove website" run={() => set("urls", v.urls.filter((_, j) => j !== i))} />}
            </div>
          ))}
          <button type="button" onClick={() => set("urls", [...v.urls, ""])} data-password-add-url
            className="-ml-2 flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-control px-2 text-[15px] text-primary hover:bg-foreground/[0.06] md:min-h-7 md:text-[13px]">
            <Plus className="size-4" strokeWidth={2.25} />Add website
          </button>
        </div>
      </Labelled>
      <Labelled label="Group">
        <Button look="outline" className="h-11 w-full justify-between md:h-8" onClick={pickGroup} data-password-group>
          <span className="truncate">{groupName(byId.get(v.group))}</span><ChevronDown className="size-4 shrink-0" strokeWidth={2} />
        </Button>
      </Labelled>
      <Labelled label="Tags">
        <input value={v.tags} onChange={(e) => set("tags", e.target.value)} placeholder="Separated by commas" autoComplete="off" className={field} aria-label="Tags" data-password-field="tags" />
      </Labelled>
      <Labelled label="Notes">
        <textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={4} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }}
          className={cn(field, "h-auto py-2 leading-[20px] md:h-auto")} aria-label="Notes" data-password-field="notes" />
      </Labelled>
      <div className="flex min-h-12 items-center gap-3" data-password-free={canFree ? "can" : "cannot"}>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-[20px] md:text-[14px]">Agents can use it without asking</div>
          {!canFree && <div className="text-[13px] text-muted-foreground md:text-[12px]">Only for passwords in a group shared with agents</div>}
        </div>
        <Switch on={canFree ? v.free : false} disabled={!canFree} onChange={(on) => set("free", on)} label="Agents can use it without asking" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button look="quiet" className="h-11 md:h-8" onClick={backDetail}>Cancel</Button>
        <Button look="primary" type="submit" className="h-11 md:h-8" busy={busy} data-password-save><Check className="size-4" />{full ? "Save" : "Add"}</Button>
      </div>
    </form>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** The generator's choices: each change makes a new password. */
function Generator({ generate, close }: { generate: (o: GenOptions) => void; close: () => void }) {
  const [o, setO] = useState(genOptions.current)
  const change = (next: GenOptions) => { setO(next); generate(next) }
  const kinds = [["letters", "Letters"], ["digits", "Digits"], ["symbols", "Symbols"]] as const
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-[10px] bg-foreground/[0.04] px-3 py-3" data-password-generator>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-[15px] md:text-[13px]">Length <span className="text-muted-foreground tabular-nums">{o.length}</span></span>
        <Slider value={o.length} min={8} max={64} label="Length" onInput={(n) => setO({ ...o, length: n })} onChange={(n) => change({ ...o, length: n })} className="min-w-0 flex-1" />
        <Act icon={RefreshCw} label="Another one" run={() => generate(o)} />
        <Act icon={X} label="Close generator" run={close} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {kinds.map(([k, label]) => (
          <span key={k} className="flex items-center gap-2 text-[15px] md:text-[13px]">
            <Switch on={o[k]} label={label} disabled={o[k] && kinds.filter(([x]) => o[x]).length === 1} onChange={(on) => change({ ...o, [k]: on })} />{label}
          </span>
        ))}
      </div>
    </div>
  )
}
