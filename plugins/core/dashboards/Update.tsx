// A plugin's newer version of a page (core/coreops/pages.ts): the app never changes a page by itself, so the page offers
// it in a bar under its title, and See changes opens the difference in a tab, with the same Update and Dismiss.
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowUpCircle } from "lucide-react"
import { cn, notify, notifyError, op, opcodes, openView, useVaultChange } from "@vaultite"

type Update = { path: string; template: string; plugin: string; edited: boolean }
type Diff = Update & { mine: string; text: string }

const EDITED = "You changed this page: updating replaces your changes (its file history keeps them)."

/** This page's update, if it has one, asked again when the page or pages.json (a dismissal) changes. */
function useUpdate(path: string) {
  const [u, setU] = useState<Update | null>(null)
  const load = useCallback(() => {
    op<{ updates: Update[] }>("dashboard.updates", { path }).then((r) => setU(r.updates[0] ?? null), () => setU(null))
  }, [path])
  useEffect(load, [load])
  useVaultChange(load, [path, ".vaultite/pages.json"])
  return u
}

const act = (id: "dashboard.update" | "dashboard.dismiss", path: string) =>
  op(id, { path }).then(() => notify(id === "dashboard.update" ? "Page updated" : "Update dismissed", { id: "page-update" }), notifyError)

const btn = "h-7 cursor-pointer rounded-[6px] px-2.5 text-[13px] font-medium hover:bg-foreground/[0.08]"

export function UpdateBar({ path }: { path: string }) {
  const u = useUpdate(path)
  if (!u) return null
  return (
    <div data-page-update={u.edited ? "edited" : "clean"} className="mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border-[0.5px] border-border bg-card px-3 py-2">
      <ArrowUpCircle className="size-4 shrink-0 text-primary" strokeWidth={2.25} />
      <div className="min-w-0 flex-1 text-[13px]">
        <span className="font-medium">Update available</span>
        <span className="text-muted-foreground"> · {u.edited ? EDITED : `A newer version of this page came with ${u.plugin}.`}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className={btn} onClick={() => openView(`page-update/${path}`)}>See changes</button>
        <button type="button" className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")} onClick={() => act("dashboard.update", path)}>Update</button>
        <button type="button" className={btn} onClick={() => act("dashboard.dismiss", path)}>Dismiss</button>
      </div>
    </div>
  )
}

/** The page against the new version, line by line, with the same two choices. */
export function UpdateView({ path }: { path: string }) {
  const u = useUpdate(path)
  const [d, setD] = useState<Diff | null>(null)
  useEffect(() => { if (u) op<Diff>("dashboard.diff", { path }).then(setD, () => setD(null)); else setD(null) }, [u, path])
  const rows = useMemo(() => {
    if (!d) return []
    const a = d.mine.replace(/\n$/, "").split("\n"), b = d.text.replace(/\n$/, "").split("\n")
    return opcodes(a, b).flatMap(([tag, i1, i2, j1, j2]) => tag === "equal" ? a.slice(i1, i2).map((t) => ({ kind: "same", t }))
      : [...a.slice(i1, i2).map((t) => ({ kind: "del", t })), ...b.slice(j1, j2).map((t) => ({ kind: "add", t }))])
  }, [d])
  if (!u) return <p className="p-6 text-[15px] text-muted-foreground">{path} has no update.</p>
  return (
    <div className="mx-auto max-w-[760px] p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{path}</div>
          <div className="text-[13px] text-muted-foreground">{u.edited ? EDITED : `${u.plugin}'s newer version of it.`}</div>
        </div>
        <button type="button" className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")} onClick={() => act("dashboard.update", path)}>Update</button>
        <button type="button" className={btn} onClick={() => act("dashboard.dismiss", path)}>Dismiss</button>
      </div>
      <div data-page-diff className="overflow-x-auto rounded-[8px] border-[0.5px] border-border bg-card py-2 font-mono text-[12.5px] leading-[19px]">
        {rows.map((l, i) => (
          <div key={i} data-diff={l.kind} className={cn("flex min-w-max pr-3 whitespace-pre",
            l.kind === "add" && "bg-[color-mix(in_srgb,var(--green)_16%,transparent)]",
            l.kind === "del" && "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-muted-foreground")}>
            <span aria-hidden className="w-6 shrink-0 text-center select-none">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
            <span>{l.t || " "}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        <span className="text-[var(--red)]">−</span> in your page now, <span className="text-[var(--green)]">+</span> in the new version.
      </p>
    </div>
  )
}
