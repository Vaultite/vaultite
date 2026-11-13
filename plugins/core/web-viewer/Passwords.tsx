import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { ArrowRight, Bot, ChevronDown, Copy, Ellipsis, FingerprintPattern, Folder, Globe, KeyRound, Lock, LockKeyhole, Pencil, Plus, Trash2, User } from "lucide-react"
import {
  afterSheets, Button, capitalize, cn, confirmDialog, detailPath, Empty, FilterField, fmtAgo, menuBelow, menuFor, notify, notifyError, openDetail, openWebLink,
  plural, SidebarRow, useBusy, type MenuItem,
} from "@vaultite"
import { SiteIcon } from "./icons"
import {
  approvedText, call, chooseFile, copySecret, deleting, EDIT_DETAIL, ENTRY_DETAIL, fetchUses, fileName, forgetFile, groupPath, hasPasswords, lockedNow,
  lockNow, NEW_DETAIL, refresh, state, usePasswordsLive, webUrl, type Full, type Group, type Row, type Status, type Use,
} from "./passwordstore"

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
const ALL = "", AGENTS = "agents"
const field = "h-11 w-full min-w-0 rounded-control border-[0.5px] border-border bg-card px-3 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-8 md:text-[13px]"

export function PasswordsView() {
  if (!hasPasswords()) return <div className="px-4 pt-6"><Empty>Your passwords open in Vaultite's desktop app.</Empty></div>
  return <Passwords />
}

function Passwords() {
  const { status, groups, entries } = usePasswordsLive()
  if (status === undefined) return null
  if (!status) return <Setup />
  if (status.locked || status.error || !entries) return <div className="h-full overflow-y-auto"><LockScreen status={status} /></div>
  return <Unlocked status={status} groups={groups} entries={entries} />
}

function Centered({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[340px] flex-col items-center px-4 pt-[12vh] pb-10 text-center">
      <span className="mb-4 grid size-16 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground"><Icon className="size-7" strokeWidth={1.75} /></span>
      <h2 className="mb-1 text-[20px] leading-[26px] font-semibold break-all">{title}</h2>
      {children}
    </div>
  )
}

function Setup() {
  return (
    <div className="h-full overflow-y-auto" data-passwords-setup>
      <Centered icon={KeyRound} title="Your passwords">
        <p className="mb-5 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">Open your KeePass file, the one KeePassXC or Strongbox opens, to use its passwords here.</p>
        <Button look="primary" onClick={() => void chooseFile()} data-passwords-choose>Choose your KeePass file…</Button>
      </Centered>
    </div>
  )
}

export function LockScreen({ status }: { status: NonNullable<Status> }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, run] = useBusy()
  const input = useRef<HTMLInputElement>(null)
  const unlock = (given?: string) => void run(async () => {
    try {
      const r = await call("unlock", given)
      if (r?.error) { setError(capitalize(r.error)); if (given) input.current?.select(); return }
      setPassword(""); setError("")
      await refresh()
    } catch (e) { notifyError(e, "Couldn't unlock your passwords") }
  })
  const name = fileName(status.file)
  if (status.error) return (
    <Centered icon={LockKeyhole} title={name}>
      <p className="mb-5 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]" data-passwords-error>{capitalize(status.error)}.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void chooseFile(status.file)}>Type its password…</Button>
        <Button look="quiet" onClick={() => void chooseFile()}>Use another file…</Button>
      </div>
    </Centered>
  )
  return (
    <Centered icon={LockKeyhole} title={name}>
      <p className="mb-5 text-[15px] text-muted-foreground md:text-[13px]">Locked</p>
      <div className="flex w-full flex-col gap-3" data-passwords-lock>
        {status.touchId && (
          <Button look="primary" className="w-full" busy={busy && !password} onClick={() => unlock()} data-passwords-touchid>
            <FingerprintPattern className="size-4" strokeWidth={2} />Unlock with Touch ID
          </Button>
        )}
        <form className="relative" onSubmit={(e) => { e.preventDefault(); if (password) unlock(password) }}>
          <input ref={input} type="password" value={password} autoFocus={!status.touchId} autoComplete="off" spellCheck={false}
            placeholder={status.touchId ? "Or type its password" : "Password"} aria-label="Password" aria-invalid={!!error || undefined}
            onChange={(e) => { setPassword(e.target.value); setError("") }} className={cn(field, "pr-10")} data-passwords-password />
          <button type="submit" aria-label="Unlock" data-tip="Unlock" disabled={!password || busy}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 md:size-6">
            <ArrowRight className="size-4" strokeWidth={2.25} />
          </button>
        </form>
        {error && <p className="-mt-1 text-[13px] text-[var(--red)]" role="alert" data-passwords-unlock-error>{error}</p>}
      </div>
      <Button look="quiet" size="small" className="mt-6" onClick={() => void chooseFile()}>Use another file…</Button>
    </Centered>
  )
}


type Tree = { group: Group; depth: number; count: number }[]
function treeOf(groups: Group[], entries: Row[]) {
  const kids = new Map<string | null, Group[]>()
  for (const g of groups) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g])
  const direct = new Map<string, number>()
  for (const e of entries) direct.set(e.group, (direct.get(e.group) ?? 0) + 1)
  const sorted = (id: string) => [...(kids.get(id) ?? [])].filter((k) => !k.bin).sort((a, b) => collator.compare(a.name, b.name))
  const root = groups.find((g) => g.parent === null)
  const tree: Tree = []
  const walk = (g: Group, depth: number): number => {
    const at = tree.length
    tree.push({ group: g, depth, count: 0 })
    let n = direct.get(g.id) ?? 0
    for (const k of sorted(g.id)) n += walk(k, depth + 1)
    tree[at].count = n
    return n
  }
  if (root) for (const k of sorted(root.id)) walk(k, 0)
  return { root, tree, bin: groups.find((g) => g.bin && !groups.find((p) => p.id === g.parent)?.bin) }
}

function within(groups: Group[], id: string) {
  const set = new Set([id])
  for (let grew = true; grew;) { grew = false; for (const g of groups) if (g.parent && set.has(g.parent) && !set.has(g.id)) { set.add(g.id); grew = true } }
  return set
}

function Unlocked({ status, groups, entries }: { status: NonNullable<Status>; groups: Group[]; entries: Row[] }) {
  const [q, setQ] = useState("")
  const [picked, setWhere] = useState(ALL)
  const uses = useUses()
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const where = picked && (picked === AGENTS ? !uses : !byId.has(picked)) ? ALL : picked
  const { root, tree, bin } = useMemo(() => treeOf(groups, entries), [groups, entries])
  const binned = useMemo(() => new Set(groups.filter((g) => g.bin).map((g) => g.id)), [groups])
  const kept = deleting.use(entries, (e) => e.id)
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const inside = where && where !== AGENTS ? within(groups, where) : null
    const keep = new Set(kept.list)
    return entries.filter((e) => keep.has(e) && (inside ? inside.has(e.group) : !binned.has(e.group)) && words.every((w) =>
      e.title.toLowerCase().includes(w) || e.username.toLowerCase().includes(w) || e.urls.some((u) => u.toLowerCase().includes(w)) || e.tags.some((t) => t.toLowerCase().includes(w))))
      .sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.username, b.username))
  }, [entries, kept.list, q, where, groups, binned])
  const binCount = useMemo(() => entries.filter((e) => binned.has(e.group)).length, [entries, binned])
  const places: { id: string; label: string; icon: typeof Folder; depth: number; count?: number }[] = [
    { id: ALL, label: "All passwords", icon: KeyRound, depth: 0, count: entries.length - binCount },
    ...tree.map((t) => ({ id: t.group.id, label: t.group.name || "Group", icon: Folder, depth: t.depth, count: t.count })),
    ...(bin && binCount ? [{ id: bin.id, label: "Recycle bin", icon: Trash2, depth: 0, count: binCount }] : []),
    ...(uses ? [{ id: AGENTS, label: "Agents' logins", icon: Bot, depth: 0 }] : []),
  ]
  const here = places.find((p) => p.id === where)
  const newIn = where && where !== AGENTS && where !== bin?.id ? where : root?.id ?? ""
  const more = (): MenuItem[] => [
    { label: "Use another file…", icon: Folder, run: () => void chooseFile() },
    { label: "Stop using it", icon: Trash2, danger: true, sep: true, run: () => void forgetFile() },
  ]
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && shown[0] && where !== AGENTS && e.target instanceof Element && e.target.matches("input")) { e.preventDefault(); openDetail(detailPath(ENTRY_DETAIL, shown[0].id)) } }
  return (
    <div className="@container flex h-full min-h-0" data-passwords={fileName(status.file)}>
      <nav aria-label="Groups" data-size-up className="hidden w-56 shrink-0 flex-col gap-px overflow-y-auto border-r-[0.5px] border-border px-2 py-3 @2xl:flex" data-passwords-groups>
        {places.map((p) => (
          <div key={p.id} style={{ paddingLeft: p.depth * 12 }} className={cn((p.id === AGENTS || p.id === bin?.id) && "mt-3")}>
            <SidebarRow icon={p.icon} label={p.label} open active={where === p.id} onClick={() => setWhere(p.id)} data-passwords-group={p.id || "all"}>
              {p.count != null && <span className="mr-1 text-[12px] text-tertiary tabular-nums">{p.count}</span>}
            </SidebarRow>
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2" onKeyDown={onKey}>
          <Button look="secondary" size="small" className="max-w-[40%] @2xl:hidden" data-passwords-group-chip
            onClick={(e) => menuBelow(e, places.map((p) => ({ label: p.label, icon: p.icon, checked: where === p.id, sep: p.id === AGENTS || p.id === bin?.id, run: () => setWhere(p.id) })))}>
            <span className="truncate">{here?.label ?? "All passwords"}</span><ChevronDown className="size-3.5 shrink-0" strokeWidth={2.25} />
          </Button>
          <FilterField value={q} onChange={setQ} placeholder={where === AGENTS ? "Search agents' logins" : "Search passwords"} />
          <Button look="primary" size="small" onClick={() => openDetail(detailPath(NEW_DETAIL, newIn))} data-passwords-new><Plus className="size-4" strokeWidth={2.25} />New</Button>
          <IconButton icon={Lock} label="Lock" onClick={lockNow} data="lock" />
          <IconButton icon={Ellipsis} label="More" onClick={(e) => menuBelow(e, more())} data="more" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 [scrollbar-gutter:stable]" data-passwords-list>
          {where === AGENTS ? <AgentLogins uses={uses ?? []} entries={entries} q={q} /> : !shown.length ? (
            <div className="px-1 pt-6"><Empty>{q.trim() ? `No password matches "${q.trim()}".` : where === ALL ? "No passwords yet." : "No passwords in this group."}</Empty></div>
          ) : (
            <div className="flex flex-col">
              {shown.map((e) => <EntryRow key={e.id} e={e} group={e.group !== where ? groupPath(byId, e.group) : ""} binned={binned.has(e.group)} leaving={kept.leaving(e.id)} />)}
            </div>
          )}
          {where !== AGENTS && !!shown.length && <p className="px-1 pt-3 text-[12px] text-tertiary">{plural(shown.length, "password")}</p>}
        </div>
      </div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, data }: { icon: typeof Lock; label: string; onClick: (e: MouseEvent) => void; data: string }) {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={onClick} data-passwords-action={data}
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-7">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}

export function Marks({ e }: { e: Row }) {
  const chip = "shrink-0 rounded-chip px-1.5 text-[11px] leading-[16px] font-medium"
  return (
    <>
      {e.expired && <span className={cn(chip, "bg-[var(--red)]/12 text-[var(--red)]")} data-passwords-mark="expired">Expired</span>}
      {e.shared && (e.free
        ? <span className={cn(chip, "bg-[var(--purple)]/14 text-[var(--purple)]")} data-tip="Agents use it without asking" data-passwords-mark="free">Agent-free</span>
        : <span className={cn(chip, "bg-foreground/[0.06] text-muted-foreground")} data-tip="Agents can use it, asking you first" data-passwords-mark="shared">For agents</span>)}
    </>
  )
}

const open = (e: Row) => openDetail(detailPath(ENTRY_DETAIL, e.id))
async function copyPassword(e: Row) {
  try { const f = await call("get", e.id); await copySecret(f.password, "password") } catch (err) { if (!lockedNow(err)) notifyError(err, "Couldn't copy the password") }
}

function EntryRow({ e, group, binned, leaving }: { e: Row; group: string; binned: boolean; leaving?: "" }) {
  const items = (): MenuItem[] => [
    ...(e.username ? [{ label: "Copy username", icon: User, run: () => void copySecret(e.username, "username") }] : []),
    { label: "Copy password", icon: Copy, run: () => void copyPassword(e) },
    ...(e.urls[0] ? [{ label: "Open website", icon: Globe, run: () => afterSheets(() => openWebLink(webUrl(e.urls[0]))) }] : []),
    { label: "Edit", icon: Pencil, sep: true, run: () => openDetail(detailPath(EDIT_DETAIL, e.id)) },
    { label: binned ? "Delete for good…" : "Delete", icon: Trash2, danger: true, run: () => void removeEntry(e) },
  ]
  const meta = [e.username, group].filter(Boolean).join(" · ")
  return (
    <button type="button" onClick={() => open(e)} onContextMenu={menuFor(items)} data-leaving={leaving} data-passwords-entry={e.title}
      className="relative isolate flex min-h-14 w-full cursor-pointer items-center gap-3 py-1.5 text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-control hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07] md:min-h-12">
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-foreground/[0.05] text-muted-foreground">
        {e.urls[0] ? <SiteIcon url={webUrl(e.urls[0])} className="size-[18px]" /> : <KeyRound className="size-[18px]" strokeWidth={1.75} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[17px] leading-[22px] md:text-[14px] md:leading-[19px]">{e.title || "Untitled"}</span>
          <Marks e={e} />
        </span>
        {meta && <span className="block truncate text-[15px] text-muted-foreground md:text-[12px]">{meta}</span>}
      </span>
    </button>
  )
}

const changeOf = (f: Full) => ({ id: f.id, group: f.group, title: f.title, username: f.username, password: f.password, urls: f.urls, tags: f.tags, notes: f.notes })

export async function removeEntry(e: Row, full?: Full) {
  const name = e.title || "Untitled"
  const inBin = !!state.get().groups.find((g) => g.id === e.group)?.bin
  if (inBin && !(await confirmDialog({ title: `Delete “${name}” for good?`, body: "It's in the recycle bin: deleting it there can't be undone.", confirm: "Delete", danger: true }))) return
  let kept = full
  if (!inBin && !kept) { try { kept = await call("get", e.id) } catch { } }
  const ok = await deleting.remove(e.id, () => call("delete", e.id), "Couldn't delete it")
  if (!ok) return
  if (inBin) return notify(`Deleted “${name}”`)
  notify(`Moved “${name}” to the recycle bin`, kept ? { action: { label: "Undo", run: () => { deleting.back([e.id]); return call("save", changeOf(kept!)) } } } : {})
}


export function useUses() {
  const [uses, setUses] = useState<Use[] | null | undefined>(undefined)
  useEffect(() => { let stop = false; void fetchUses().then((u) => { if (!stop) setUses(u) }); return () => { stop = true } }, [])
  return uses
}

export function UseRow({ u, entry }: { u: Use; entry?: Row }) {
  const title = entry?.title || u.entry.title || "An entry"
  return (
    <div className="flex min-h-12 items-center gap-3 py-1.5" data-passwords-use={u.agent}>
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-foreground/[0.05] text-muted-foreground"><Bot className="size-[18px]" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px] md:text-[14px]">
          {entry ? <button type="button" className="cursor-pointer hover:underline" onClick={() => open(entry)}>{title}</button> : title}
          {u.entry.username && <span className="text-muted-foreground"> · {u.entry.username}</span>}
        </div>
        <div className="truncate text-[13px] text-muted-foreground md:text-[12px]">{[u.agent, u.site, fmtAgo(u.t), approvedText(u)].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  )
}

function AgentLogins({ uses, entries, q }: { uses: Use[]; entries: Row[]; q: string }) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const entryOf = (u: Use) => (u.entry.id ? byId.get(u.entry.id) : entries.find((e) => e.title === u.entry.title && e.username === u.entry.username))
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = uses.filter((u) => words.every((w) => [u.agent, u.site, u.entry.title, u.entry.username, u.task ?? ""].join(" ").toLowerCase().includes(w)))
  if (!shown.length) return <div className="px-1 pt-6"><Empty>{q.trim() ? `No agent login matches "${q.trim()}".` : "No agent has logged in with your passwords yet."}</Empty></div>
  return <div className="flex flex-col" data-passwords-uses>{shown.map((u, i) => <UseRow key={`${u.t}-${i}`} u={u} entry={entryOf(u)} />)}</div>
}
