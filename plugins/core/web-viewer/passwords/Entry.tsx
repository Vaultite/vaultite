import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Copy, Ellipsis, ExternalLink, Eye, EyeOff, KeyRound, Pencil, TriangleAlert, Trash2 } from "lucide-react"
import { backDetail, Button, cn, dateText, Empty, Group, Loading, menuBelow, Section, SheetHead } from "@vaultite"
import { siteIcon } from "../icons"
import { openSite } from "./acting"
import { attempt, isBinned, remove } from "./actions"
import { UseRow, useUses } from "./Agents"
import { History } from "./History"
import { useFull } from "./full"
import { EntryIcon, Marks } from "./List"
import { DAY } from "./look"
import { entryMenu } from "./menus"
import { Act, ColoredPassword, Field, Unlocked } from "./parts"
import { StrengthBar } from "./Strength"
import { call, copyCode, copyPassword, copyText, editEntry, lockedNow, openEntry, state, usesOf, webUrl } from "./store"
import { groupPath } from "./tree"
import type { Full, Row } from "./types"

const useRow = (id: string) => state.use((s) => s.entries?.find((e) => e.id === id))

export function EntrySheet({ id }: { id: string }) {
  return <Unlocked><InSheet id={id} /></Unlocked>
}

function InSheet({ id }: { id: string }) {
  const row = useRow(id), where = useWhere(row)
  if (!row) return <Empty>This password is gone from the file.</Empty>
  return (
    <div className="flex flex-col gap-5" data-password-sheet={row.title} data-password-id={row.id}>
      <SheetHead icon={row.urls[0] ? siteIcon(webUrl(row.urls[0])) : KeyRound} tint="var(--foreground)" kicker={where || "Passwords"} title={row.title || "Untitled"}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button className="h-11 px-3 md:h-8" onClick={() => editEntry(row.id)} data-password-edit><Pencil className="size-4" />Edit</Button>
          <Button look="quiet" className="h-11 px-3 md:h-8" onClick={() => { backDetail(); void remove([row]) }} data-password-delete><Trash2 className="size-4" />Delete</Button>
          <span className="ml-auto flex gap-1.5"><Marks e={row} /></span>
        </div>
      </SheetHead>
      <Details key={row.id} row={row} />
    </div>
  )
}

export function Beside({ row }: { row: Row }) {
  const where = useWhere(row)
  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-5 px-5 pt-4 pb-10" data-password-sheet={row.title} data-password-id={row.id} data-password-beside>
      <header className="flex items-center gap-3">
        <EntryIcon e={row} big />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] leading-[25px] font-bold select-text">{row.title || "Untitled"}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"><span className="truncate">{where || "Top level"}</span><Marks e={row} /></p>
        </div>
        <Button size="small" onClick={() => editEntry(row.id)} data-password-edit><Pencil className="size-3.5" />Edit</Button>
        <Act icon={Ellipsis} label="More" run={(e) => menuBelow(e, entryMenu(row))} />
      </header>
      <Details key={row.id} row={row} />
    </div>
  )
}

function useWhere(row: Row | undefined) {
  const groups = state.use((s) => s.groups)
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  return row ? groupPath(byId, row.group) : ""
}

function Details({ row }: { row: Row }) {
  const full = useFull(row)
  if (full === null) return <Empty>This password is gone from the file.</Empty>
  return (
    <>
      <Group>
        {row.username && <Field label="Username" value={row.username} actions={<Act icon={Copy} label="Copy username" run={() => void copyText(row.username, "username")} />} />}
        <Password key={row.modified} row={row} has={full?.password !== false} />
        {row.otp && <Code id={row.id} />}
        {row.urls.map((u, i) => (
          <Field key={i} label={row.urls.length > 1 ? `Website ${i + 1}` : "Website"} value={u} actions={<Act icon={ExternalLink} label="Open website" run={() => openSite(u)} />} />
        ))}
      </Group>
      {full === undefined ? <Loading /> : <Rest full={full} />}
    </>
  )
}

function Password({ row, has }: { row: Row; has: boolean }) {
  const [shown, setShown] = useState<string | null>(null)
  const health = state.use((s) => s.health.get(row.id))
  const toggle = () => (shown === null ? void attempt(async () => setShown(await call("password", row.id)), "Couldn't read the password") : setShown(null))
  if (!has) return <Field label="Password" value="" data-password-value="none" />
  return (
    <Field label="Password" mono={shown !== null} value={shown === null ? "•".repeat(12) : <ColoredPassword text={shown} />} data-password-value={shown === null ? "hidden" : "shown"}
      actions={<>
        <Act icon={shown === null ? Eye : EyeOff} label={shown === null ? "Show password" : "Hide password"} run={toggle} />
        <Act icon={Copy} label="Copy password" run={() => void copyPassword(row.id)} />
      </>}
      below={health?.bits != null && <><StrengthBar bits={health.bits} className="mt-1.5" /><Warnings row={row} /></>} />
  )
}

function Warnings({ row }: { row: Row }) {
  const { health, entries, leaks } = state.use()
  const mine = health.get(row.id), times = leaks?.get(row.id) ?? 0
  const same = mine?.same ? (entries ?? []).filter((e) => e.id !== row.id && health.get(e.id)?.same === mine.same) : []
  if (!same.length && !times) return null
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 text-[13px] md:text-[12px]" data-password-warnings>
      {times > 0 && <Warning color="text-ink-(--red)">In a known breach: change it</Warning>}
      {same.length > 0 && <Warning color="text-ink-(--orange)">Same as {same.map((e, i) => (
        <span key={e.id}>{i > 0 && ", "}<button type="button" className="cursor-pointer underline decoration-current/40 hover:decoration-current" onClick={() => openEntry(e.id)}>{e.title || "Untitled"}</button></span>
      ))}</Warning>}
    </div>
  )
}
const Warning = ({ color, children }: { color: string; children: ReactNode }) => (
  <p className={cn("flex items-start gap-1.5", color)}><TriangleAlert className="mt-[3px] size-3 shrink-0" strokeWidth={2.25} /><span className="min-w-0">{children}</span></p>
)

function Rest({ full }: { full: Full }) {
  return (
    <>
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
      {!isBinned(full) && <History e={full} />}
      <p className="text-[13px] text-tertiary md:text-[12px]">
        {[`Changed ${dateText(full.modified, DAY)}`, full.expires !== null && `${full.expired ? "Expired" : "Expires"} ${dateText(full.expires, DAY)}`].filter(Boolean).join(" · ")}
      </p>
    </>
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

const leftOf = (period: number) => period - (Math.floor(Date.now() / 1000) % period)
const RADIUS = 7, ROUND = 2 * Math.PI * RADIUS
const spaced = (code: string) => (code.length % 2 || code.length < 6 ? code : `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`)

function Code({ id }: { id: string }) {
  const [now, setNow] = useState<{ code: string; period: number } | null>(null)
  const [left, setLeft] = useState(0)
  const ask = useRef(() => {})
  useEffect(() => {
    let stop = false
    ask.current = () => { call("code", id).then((c) => { if (!stop && c) { setNow(c); setLeft(leftOf(c.period)) } }, lockedNow) }
    ask.current()
    return () => { stop = true }
  }, [id])
  const period = now?.period
  useEffect(() => {
    if (!period) return
    const t = setInterval(() => { const n = leftOf(period); setLeft(n); if (n === period) ask.current() }, 1000)
    return () => clearInterval(t)
  }, [period])
  if (!now) return null
  return (
    <Field label="One-time code" mono value={<span className={cn(left <= 5 && "text-ink-(--red)")}>{spaced(now.code)}</span>} data-password-code
      actions={<>
        <span className="grid size-11 place-items-center md:size-8" data-tip={`${left} seconds left`} aria-label={`${left} seconds left`}>
          <span className={cn("relative grid size-[26px] place-items-center", left <= 5 ? "text-[var(--red)]" : "text-primary")}>
            <svg viewBox="0 0 18 18" className="absolute inset-0 -rotate-90">
              <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.75} />
              <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeDasharray={ROUND} strokeDashoffset={ROUND * (1 - left / now.period)} />
            </svg>
            <span className="text-[10px] font-medium tabular-nums">{left}</span>
          </span>
        </span>
        <Act icon={Copy} label="Copy one-time code" run={() => void copyCode(id)} />
      </>} />
  )
}
