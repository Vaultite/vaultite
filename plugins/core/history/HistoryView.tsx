// A file's versions beside a diff with the file now; Restore writes one back as an ordinary edit (with Undo), Copy
// copies it.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, History, RotateCcw } from "lucide-react"
import { cn, copyText, dateText, get, opcodes, openFile, post, put, readFile, notify, notifyError, useVaultChange } from "@vaultite"

/** One kept here (`size`), or another plugin's (`source`: Git's commits, with their `id`, `title` and `by`). */
type Version = { t: number; size?: number; source?: string; label?: string; id?: string; title?: string; by?: string }
type Other = { source: string; label: string; versions: { id: string; t: number; title?: string; by?: string }[] }
const keyOf = (v: Version) => (v.source ? `${v.source}:${v.id}` : String(v.t))

const when = (t: number) => {
  const d = (Date.now() - t) / 1000
  if (d < 60) return "Just now"
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 86400) return `${Math.round(d / 3600)} h ago`
  const days = Math.round(d / 86400)
  return days === 1 ? "Yesterday" : `${days} days ago`
}
const stamp = (t: number) => dateText(new Date(t), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

type Line = { kind: "same" | "add" | "del"; text: string }
/** The version's lines against the file's: kept, only in the version (add), only in the file now (del). */
function diff(now: string, then: string): Line[] {
  const lines = (t: string) => t.replace(/\n$/, "").split("\n")  // a file's last newline isn't a line of its own
  const a = lines(now), b = lines(then)
  if (a.length + b.length > 20000) return b.map((text) => ({ kind: "same", text })) // too big to compare here
  const out: Line[] = []
  for (const [tag, i1, i2, j1, j2] of opcodes(a, b)) {
    if (tag === "equal") { for (let j = j1; j < j2; j++) out.push({ kind: "same", text: b[j] }); continue }
    for (let i = i1; i < i2; i++) out.push({ kind: "del", text: a[i] })
    for (let j = j1; j < j2; j++) out.push({ kind: "add", text: b[j] })
  }
  return out
}

export function HistoryView({ path }: { path: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  // The file as it is now (null: not in the vault any more).
  const [now, setNow] = useState<string | null | undefined>(undefined)
  const q = encodeURIComponent(path)

  const load = useCallback(() => {
    get<{ versions: Version[]; others?: Other[] }>(`history?path=${q}`).then((r) => {
      const all = [...r.versions, ...(r.others ?? []).flatMap((o) => o.versions.map((v) => ({ ...v, source: o.source, label: o.label })))].sort((a, b) => b.t - a.t)
      setVersions(all)
      setSel((s) => (s !== null && all.some((v) => keyOf(v) === s) ? s : all[0] ? keyOf(all[0]) : null))
    }, () => setVersions([]))
    readFile(path).then((f) => setNow(f.text), () => setNow(null))
  }, [path, q])
  useEffect(load, [load])
  useVaultChange(load, [path])
  const v = versions?.find((x) => keyOf(x) === sel) ?? null
  const url = v ? `api/history/version?path=${q}&${v.source ? `source=${encodeURIComponent(v.source)}&id=${encodeURIComponent(v.id!)}` : `t=${v.t}`}` : null
  useEffect(() => {
    if (!url) { setText(null); return }
    let live = true
    fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then((t) => { if (live) setText(t) }, () => { if (live) setText(null) })
    return () => { live = false }
  }, [url])

  const lines = useMemo(() => (text === null || now === undefined ? null : diff(now ?? "", text)), [text, now])
  const changes = lines ? lines.filter((l) => l.kind !== "same").length : 0

  const restore = async () => {
    if (text === null || !v) return
    const before = now
    try {
      if (before === null) await post("file", { path, text })  // it was deleted: it comes back
      else await put("file", { path, text, base: before })
      notify(`Restored the version from ${stamp(v.t)}`, {
        action: before === null ? undefined : {
          label: "Undo",
          run: () => { put("file", { path, text: before, base: text }).then(load, (e) => notifyError(e)) },
        },
      })
      load()
    } catch (e) { notifyError(e) }
  }

  const labels = [...new Set((versions ?? []).flatMap((x) => (x.label ? [x.label] : [])))]
  if (versions === null) return <p className="mt-6 text-[15px] text-muted-foreground">Loading…</p>
  const name = path.split("/").pop()!.replace(/\.md$/i, "")
  return (
    <div className="@container mt-3" data-history>
      <p className="mb-4 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">
        Earlier versions of <button type="button" className="cursor-pointer font-medium text-foreground hover:underline" onClick={() => openFile(path)}>{name}</button>,
        kept on this machine every few minutes while it changes (for a week, by default)
        {labels.length ? <>, and its versions in {labels.join(" and ")}.</> : "."}
      </p>
      {!versions.length ? (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-4 py-3 text-[15px] text-muted-foreground md:text-[13px]">
          <History className="size-4 shrink-0" strokeWidth={2} />No earlier versions yet. They're kept from the first change on.
        </div>
      ) : (
        <div className="flex flex-col gap-4 @2xl:flex-row">
          <ul role="listbox" aria-label="Versions" className="flex max-h-[34vh] shrink-0 flex-col gap-px overflow-y-auto overscroll-contain @2xl:max-h-[calc(100dvh-12rem)] @2xl:w-[210px]">
            {versions.map((x) => (
              <li key={keyOf(x)}>
                <button type="button" role="option" aria-selected={keyOf(x) === sel} onClick={() => setSel(keyOf(x))} data-source={x.source}
                  className={cn("flex w-full cursor-pointer flex-col rounded-[8px] px-3 py-2 text-left md:rounded-[6px] md:py-1.5",
                    keyOf(x) === sel ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]")}>
                  <span className="text-[15px] font-medium md:text-[13px]">{when(x.t)}</span>
                  <span className="truncate text-[13px] text-muted-foreground md:text-[12px]">
                    {x.source ? `${x.label}: ${x.title || "(no message)"}${x.by ? ` · ${x.by}` : ""}` : `${stamp(x.t)} · ${kb(x.size ?? 0)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section className="min-w-0 flex-1" aria-label="Version">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="w-full min-w-0 text-[13px] text-muted-foreground @md:w-auto @md:flex-1">
                {v && <span className="font-medium text-foreground">{stamp(v.t)}{v.source ? ` · ${v.label}` : ""}</span>}
                {lines && <span> · {changes ? `${changes} line${changes === 1 ? "" : "s"} differ from the file now` : "the same as the file now"}</span>}
              </div>
              <button type="button" disabled={text === null} onClick={() => text !== null && copyText(text).then(() => notify("Copied the version", { id: "copied" }), (e) => notifyError(e))}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] bg-foreground/[0.06] px-3 text-[15px] font-medium hover:bg-foreground/[0.1] disabled:opacity-40 md:h-7 md:rounded-[6px] md:text-[13px]">
                <Copy className="size-3.5" strokeWidth={2.25} />Copy
              </button>
              <button type="button" disabled={text === null || (lines !== null && !changes)} onClick={restore}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[15px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 md:h-7 md:rounded-[6px] md:text-[13px]">
                <RotateCcw className="size-3.5" strokeWidth={2.25} />Restore
              </button>
            </div>
            <div className="overflow-x-auto rounded-[10px] border-[0.5px] border-border bg-card py-2 font-mono text-[12.5px] leading-[19px] md:rounded-[8px]">
              {lines === null ? <p className="px-3 font-sans text-[13px] text-muted-foreground">Loading…</p> : lines.map((l, i) => (
                <div key={i} data-diff={l.kind}
                  className={cn("flex min-w-max pr-3 whitespace-pre",
                    l.kind === "add" && "bg-[color-mix(in_srgb,var(--green)_16%,transparent)]",
                    l.kind === "del" && "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-muted-foreground line-through decoration-[color-mix(in_srgb,var(--red)_60%,transparent)]")}>
                  <span aria-hidden className={cn("w-6 shrink-0 text-center select-none", l.kind === "add" ? "text-[var(--green)]" : l.kind === "del" ? "text-[var(--red)]" : "text-tertiary")}>
                    {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
                  </span>
                  <span>{l.text || " "}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              <span className="text-[var(--green)]">+</span> in this version, <span className="text-[var(--red)]">−</span> in the file now. Restore makes the file this version (it can be undone).
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
