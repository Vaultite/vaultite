import { useState, type ReactNode } from "react"
import { EyeOff, ShieldAlert, ShieldCheck } from "lucide-react"
import { Button, cn, confirmDialog, Empty, Foldable, notify, notifyError, plural, useBusy, type MenuItem } from "@vaultite"
import { attempt } from "./actions"
import { EntryRow } from "./List"
import { LIST } from "./menus"
import type { Issue, Report } from "./report"
import { call, lockedNow, state } from "./store"
import type { Row } from "./types"

const ISSUES: { id: Issue; label: string; color: string }[] = [
  { id: "leaked", label: "In breaches", color: "var(--red)" },
  { id: "expired", label: "Expired", color: "var(--red)" },
  { id: "weak", label: "Weak", color: "var(--orange)" },
  { id: "reused", label: "Reused", color: "var(--orange)" },
  { id: "old", label: "Old", color: "var(--yellow)" },
]

const exclude = (e: Row, on: boolean) => attempt(() => call("exclude", { id: e.id, on }), "Couldn't change it")
const leaveOut = (e: Row): MenuItem[] => [{ label: "Leave out of the report", icon: EyeOff, sep: true, run: () => exclude(e, true) }]
const putBack = (e: Row): MenuItem[] => [{ label: "Put back in the report", icon: ShieldCheck, sep: true, run: () => exclude(e, false) }]

export function HealthReport({ report }: { report: Report }) {
  const [only, setOnly] = useState<Issue | null>(null)
  const { health, leaks } = state.use()
  const tiles = ISSUES.filter((i) => i.id !== "leaked" || leaks), shown = ISSUES.filter((i) => (!only || i.id === only) && report.issues[i.id].length)
  return (
    <div className="flex flex-col gap-4 pt-1" data-passwords-health>
      <div className="grid grid-cols-2 gap-2 @sm:grid-cols-4" role="group" aria-label="What to show">
        {tiles.map((i) => <Tile key={i.id} {...i} n={report.issues[i.id].length} on={only === i.id} pick={() => setOnly(only === i.id ? null : i.id)} />)}
      </div>
      <Breaches found={leaks ? report.issues.leaked.length : null} />
      {!shown.length && <div className="px-1"><Empty>{only ? "None." : health.size ? "Nothing to fix." : "Reading…"}</Empty></div>}
      <div className="flex flex-col gap-4" data-keylist data-select-list={LIST}>
        {shown.map((i) => (
          <section key={i.id} data-passwords-issue={i.id}>
            <h3 className="px-2 pb-0.5 text-[13px] font-semibold text-muted-foreground md:text-[12px]">{i.label}</h3>
            {report.issues[i.id].map(({ row, why }) => <EntryRow key={row.id} e={row} meta={[why, row.username].filter(Boolean).join(" · ")} bits={health.get(row.id)?.bits} more={leaveOut} />)}
          </section>
        ))}
      </div>
      {!!report.left.length && (
        <Foldable title="Left out" count={report.left.length} dflt={false} data-passwords-left>
          {report.left.map((row) => <EntryRow key={row.id} e={row} meta={row.username} bits={health.get(row.id)?.bits} more={putBack} />)}
        </Foldable>
      )}
    </div>
  )
}

function Tile({ id, label, color, n, on, pick }: { id: Issue; label: string; color: string; n: number; on: boolean; pick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={pick} data-passwords-tile={id}
      className={cn("flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-card px-3 py-2 text-left", on ? "bg-foreground/[0.1]" : "bg-foreground/[0.04] hover:bg-foreground/[0.07]")}>
      <span className="text-[20px] leading-[24px] font-semibold tabular-nums" style={n ? { color: `oklch(from ${color} var(--ink-l) c h)` } : undefined}>{n}</span>
      <span className="text-[13px] text-muted-foreground md:text-[12px]">{label}</span>
    </button>
  )
}

const ASK = "Have I Been Pwned hears the first 5 characters of each password's SHA-1 hash, which thousands of other passwords share. No password, username or website leaves this computer."

function Breaches({ found }: { found: number | null }) {
  const [busy, run] = useBusy()
  const check = async () => {
    if (!(await confirmDialog({ title: "Check your passwords against known breaches?", body: ASK, confirm: "Check" }))) return
    await run(async () => {
      try {
        const hits = await call("breaches")
        state.update((s) => (s.entries ? { ...s, leaks: new Map(hits.map((h) => [h.id, h.times])) } : s))
        notify(hits.length ? `${plural(hits.length, "password")} found in known breaches` : "None of your passwords is in a known breach")
      } catch (e) { if (!lockedNow(e)) notifyError(e, "Couldn't check for breaches") }
    })
  }
  return (
    <div className="flex items-center gap-3 rounded-card bg-foreground/[0.04] px-3 py-2.5" data-passwords-breaches={found ?? "unchecked"}>
      {found ? <ShieldAlert className="size-5 shrink-0 text-ink-(--red)" strokeWidth={2} /> : <ShieldCheck className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />}
      <Says title="Known breaches">{found === null ? "Not checked" : found ? `${plural(found, "password")} to change` : "None found"}</Says>
      <Button size="small" busy={busy} onClick={() => void check()} data-passwords-check>{found === null ? "Check…" : "Check again…"}</Button>
    </div>
  )
}
const Says = ({ title, children }: { title: string; children: ReactNode }) => (
  <span className="min-w-0 flex-1">
    <span className="block truncate text-[15px] leading-[20px] md:text-[13px]">{title}</span>
    <span className="block truncate text-[13px] text-muted-foreground md:text-[12px]">{children}</span>
  </span>
)
