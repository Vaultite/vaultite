import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"
import { Check, ChevronDown, Eye, EyeOff, KeyRound, Plus, Wand2, X } from "lucide-react"
import { backDetail, Button, cn, detailPath, Empty, iso, Loading, menuBelow, notifyError, replaceDetail, SheetHead, Switch, useBusy, useSheetGuard } from "@vaultite"
import { generatorOptions, type Options } from "./genoptions"
import { Generator } from "./Generator"
import { field } from "./look"
import { Act, Unlocked } from "./parts"
import { StrengthBar } from "./Strength"
import { useBits } from "./bits"
import { call, ENTRY_DETAIL, FREE_TAG, lockedNow, selected, showsBeside, state } from "./store"
import { groupChoices, sharedGroups } from "./tree"
import type { Change, Full, Group } from "./types"

type Editing = { full: Full; password: string }
export function EditSheet({ id, group }: { id?: string; group?: string }) {
  return <Unlocked>{id ? <Edit id={id} /> : <Form group={group} />}</Unlocked>
}

function Edit({ id }: { id: string }) {
  const [e, setE] = useState<Editing | null | undefined>(undefined)
  useEffect(() => {
    let stop = false
    Promise.all([call("get", id), call("password", id)]).then(([full, password]) => { if (!stop) setE({ full, password }) }, (err) => { if (!stop && !lockedNow(err)) setE(null) })
    return () => { stop = true }
  }, [id])
  if (e === undefined) return <Loading />
  if (!e) return <Empty>This password is gone from the file.</Empty>
  return <Form editing={e} />
}

type Values = { title: string; username: string; password: string; urls: string[]; tags: string; notes: string; free: boolean; group: string; expires: string }
type Set = <K extends keyof Values>(k: K, x: Values[K]) => void
const BLANK: Values = { title: "", username: "", password: "", urls: [""], tags: "", notes: "", free: false, group: "", expires: "" }
function valuesOf({ full: f, password }: Editing): Values {
  return {
    title: f.title, username: f.username, password, urls: f.urls.length ? f.urls : [""], tags: f.tags.filter((t) => t !== FREE_TAG).join(", "),
    notes: f.notes, free: f.free, group: f.group, expires: f.expires === null ? "" : iso(new Date(f.expires)),
  }
}
function expiryOf(day: string, was: number | null): number | null {
  if (!day) return null
  return was !== null && iso(new Date(was)) === day ? was : new Date(`${day}T00:00:00`).getTime()
}
function changeOf(v: Values, start: Values, full: Full | undefined, canFree: boolean): Change {
  const tags = v.tags.split(",").map((t) => t.trim()).filter((t) => t && t !== FREE_TAG)
  if (canFree ? v.free : start.free) tags.push(FREE_TAG)
  return { ...(full ? { id: full.id } : {}), group: v.group || undefined, title: v.title.trim(), username: v.username.trim(), password: v.password,
    urls: v.urls.map((u) => u.trim()).filter(Boolean), tags, notes: v.notes, expires: expiryOf(v.expires, full?.expires ?? null) }
}
const placeFor = (group: string | undefined, groups: Group[]) =>
  (group && groups.some((g) => g.id === group && !g.bin) ? group : groups.find((g) => g.parent === null)?.id ?? "")

function Form({ editing, group }: { editing?: Editing; group?: string }) {
  const { groups, entries } = state.use(), full = editing?.full
  const [start] = useState(() => (editing ? valuesOf(editing) : { ...BLANK, group: placeFor(group, groups) }))
  const [v, setV] = useState(start)
  const set: Set = (k, x) => setV((o) => ({ ...o, [k]: x }))
  const [busy, run] = useBusy()
  const saved = useRef(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(start)
  useSheetGuard(() => (dirty && !saved.current ? [full ? `Your changes to ${full.title || "this password"}` : `The new password${v.title ? ` ${v.title}` : ""}`] : []))
  const canFree = useMemo(() => sharedGroups(groups, entries ?? []), [groups, entries]).has(v.group)
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    void run(async () => {
      try {
        const r = await call("save", changeOf(v, start, full, canFree))
        saved.current = true
        selected.set(r.id)
        if (full || showsBeside.get()) backDetail()
        else replaceDetail(detailPath(ENTRY_DETAIL, r.id))
      } catch (err) { if (!lockedNow(err)) notifyError(err, full ? "Couldn't save it" : "Couldn't add it") }
    })
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4" data-password-form={full ? "edit" : "new"}>
      <SheetHead icon={KeyRound} tint="var(--foreground)" kicker="Passwords" title={full ? `Edit ${full.title || "password"}` : "New password"} />
      <Labelled label="Title">
        <input value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus={!full} placeholder="Lighthouse" className={field} aria-label="Title" data-password-field="title" />
      </Labelled>
      <Labelled label="Username">
        <input value={v.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" spellCheck={false} className={field} aria-label="Username" data-password-field="username" />
      </Labelled>
      <PasswordField value={v.password} set={(p) => set("password", p)} fresh={!full} />
      <Websites urls={v.urls} set={(urls) => set("urls", urls)} />
      <GroupField group={v.group} set={(id) => set("group", id)} />
      <Labelled label="Expires">
        <div className="flex gap-1">
          <input type="date" value={v.expires} onChange={(e) => set("expires", e.target.value)} className={cn(field, "md:w-44")} aria-label="Expires" data-password-field="expires" />
          {v.expires && <Act icon={X} label="Never expires" run={() => set("expires", "")} />}
        </div>
      </Labelled>
      <Labelled label="Tags">
        <input value={v.tags} onChange={(e) => set("tags", e.target.value)} placeholder="Separated by commas" autoComplete="off" className={field} aria-label="Tags" data-password-field="tags" />
      </Labelled>
      <Labelled label="Notes">
        <textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={4} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }}
          className={cn(field, "h-auto py-2 leading-[20px] md:h-auto")} aria-label="Notes" data-password-field="notes" />
      </Labelled>
      <AgentFree can={canFree} on={v.free} set={(on) => set("free", on)} />
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

function PasswordField({ value, set, fresh }: { value: string; set: (p: string) => void; fresh: boolean }) {
  const [shown, setShown] = useState(fresh), [gen, setGen] = useState(false)
  const bits = useBits(value), asked = useRef(0)
  const make = (o: Options = generatorOptions()) => {
    const mine = ++asked.current
    call("generate", o).then((r) => { if (mine === asked.current) { set(r.password); setShown(true) } }, (e) => { if (!lockedNow(e)) notifyError(e, "Couldn't make a password") })
  }
  const label = shown ? "Hide password" : "Show password"
  return (
    <Labelled label="Password">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input type={shown ? "text" : "password"} value={value} onChange={(e) => { asked.current++; set(e.target.value) }} autoComplete="new-password" spellCheck={false}
            className={cn(field, "pr-10 font-mono")} aria-label="Password" data-password-field="password" />
          <button type="button" aria-label={label} data-tip={label} onClick={(e) => { if (e.nativeEvent.isTrusted) setShown(!shown) }}
            className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-muted-foreground hover:text-foreground md:size-6">
            {shown ? <EyeOff className="size-4" strokeWidth={2} /> : <Eye className="size-4" strokeWidth={2} />}
          </button>
        </div>
        <Button className="h-11 md:h-8" onClick={() => { setGen(true); make() }} data-password-generate><Wand2 className="size-4" />Generate</Button>
      </div>
      {value && <StrengthBar bits={bits} />}
      {gen && <Generator make={make} close={() => setGen(false)} />}
    </Labelled>
  )
}

function Websites({ urls, set }: { urls: string[]; set: (urls: string[]) => void }) {
  return (
    <Labelled label="Websites">
      <div className="flex flex-col gap-2">
        {urls.map((u, i) => (
          <div key={i} className="flex gap-1">
            <input value={u} onChange={(e) => set(urls.map((x, j) => (j === i ? e.target.value : x)))} placeholder="https://lighthouse.example.com" autoComplete="off" spellCheck={false}
              aria-label={`Website ${i + 1}`} className={field} data-password-field="url" />
            {urls.length > 1 && <Act icon={X} label="Remove website" run={() => set(urls.filter((_, j) => j !== i))} />}
          </div>
        ))}
        <button type="button" onClick={() => set([...urls, ""])} data-password-add-url
          className="-ml-2 flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-control px-2 text-[15px] text-primary hover:bg-foreground/[0.06] md:min-h-7 md:text-[13px]">
          <Plus className="size-4" strokeWidth={2.25} />Add website
        </button>
      </div>
    </Labelled>
  )
}

function GroupField({ group, set }: { group: string; set: (id: string) => void }) {
  const groups = state.use((s) => s.groups), choices = useMemo(() => groupChoices(groups), [groups])
  const pick = (e: MouseEvent) => menuBelow(e, choices.map((c) => ({ label: c.label, checked: c.id === group, run: () => set(c.id) })))
  return (
    <Labelled label="Group">
      <Button look="outline" className="h-11 w-full justify-between md:h-8" onClick={pick} data-password-group>
        <span className="truncate">{choices.find((c) => c.id === group)?.label ?? "Top level"}</span><ChevronDown className="size-4 shrink-0" strokeWidth={2} />
      </Button>
    </Labelled>
  )
}

function AgentFree({ can, on, set }: { can: boolean; on: boolean; set: (on: boolean) => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3" data-password-free={can ? "can" : "cannot"}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-[20px] md:text-[14px]">Agents can use it without asking</div>
        {!can && <div className="text-[13px] text-muted-foreground md:text-[12px]">Only for passwords in a group shared with agents</div>}
      </div>
      <Switch on={can && on} disabled={!can} onChange={set} label="Agents can use it without asking" />
    </div>
  )
}
