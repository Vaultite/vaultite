// A file's versions beside a diff with the file now; Restore writes one back as an ordinary edit (with Undo), Copy
// copies it.
import { useCallback, useEffect, useState } from "react"
import { Copy, History, RotateCcw } from "lucide-react"
import { Bar, capitalize, cn, copyText, DiffRows, fmtAgo, fmtStamp, get, Loading, notify, notifyError, openFile, plural, post, put, readFile, textDiff, useKeptCount, useVaultChange, type DiffLine } from "@vaultite"

/** One kept here (`size`), or another plugin's (`source`: Git's commits, with their `id`, `title` and `by`). */
type Version = { t: number; size?: number; source?: string; label?: string; id?: string; title?: string; by?: string }
type Other = { source: string; label: string; versions: { id: string; t: number; title?: string; by?: string }[] }
const keyOf = (v: Version) => (v.source ? `${v.source}:${v.id}` : String(v.t))

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

const option = "flex w-full flex-col rounded-[8px] px-3 py-2 text-left md:rounded-[6px] md:py-1.5"
const when = "text-[15px] font-medium md:text-[13px]"
const what = "truncate text-[13px] text-muted-foreground md:text-[12px]"
const list = "flex max-h-[34vh] shrink-0 flex-col gap-px overflow-y-auto overscroll-contain @2xl:max-h-[calc(100dvh-12rem)] @2xl:w-[210px]"

/** Versions on their way: the list's options with bars for their two lines. */
function Skeleton({ count }: { count: number }) {
  return (
    <ul aria-busy className={cn("loading-in", list)}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={option}>
          <span className={when}><Bar w={i % 2 ? "45%" : "55%"} /></span>
          <span className={what}><Bar w={i % 2 ? "70%" : "80%"} /></span>
        </li>
      ))}
    </ul>
  )
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

  const [lines, setLines] = useState<DiffLine[] | null>(null)
  useEffect(() => {
    if (text === null || now === undefined) { setLines(null); return }
    let live = true
    // (the version's lines are the added ones: what restoring it would bring back)
    textDiff(now ?? "", text).then((l) => { if (live) setLines(l) }, (e) => notifyError(e))
    return () => { live = false }
  }, [text, now])
  const changes = lines ? lines.filter((l) => l.kind !== "same").length : 0
  const kept = useKeptCount(`history:${path}`, versions?.length)

  const [restoring, setRestoring] = useState(false)
  // (the file shows as the version at once, so a second press has nothing to restore; a failure puts it back)
  const restore = async () => {
    if (text === null || !v || restoring) return
    const before = now
    setRestoring(true)
    setNow(text)
    try {
      if (before === null) await post("file", { path, text })  // it was deleted: it comes back
      else await put("file", { path, text, base: before })
      notify(`Restored the version from ${fmtStamp(v.t)}`, {
        action: before === null ? undefined : {
          label: "Undo",
          run: () => { put("file", { path, text: before, base: text }).then(load, (e) => notifyError(e)) },
        },
      })
      load()
    } catch (e) { setNow(before); notifyError(e, "Couldn't restore it") } finally { setRestoring(false) }
  }

  const labels = [...new Set((versions ?? []).flatMap((x) => (x.label ? [x.label] : [])))]
  const name = path.split("/").pop()!.replace(/\.md$/i, "")
  return (
    <div className="@container mt-3" data-history>
      <p className="mb-4 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">
        Earlier versions of <button type="button" className="cursor-pointer font-medium text-foreground hover:underline" onClick={() => openFile(path)}>{name}</button>,
        kept on this machine every few minutes while it changes (for a week, by default)
        {labels.length ? <>, and its versions in {labels.join(" and ")}.</> : "."}
      </p>
      {versions === null && !kept ? <Loading /> : versions !== null && !versions.length ? (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-4 py-3 text-[15px] text-muted-foreground md:text-[13px]">
          <History className="size-4 shrink-0" strokeWidth={2} />No earlier versions yet. They're kept from the first change on.
        </div>
      ) : (
        <div className="flex flex-col gap-4 @2xl:flex-row">
          {versions === null ? <Skeleton count={kept} /> : <ul role="listbox" aria-label="Versions" className={list}>
            {versions.map((x) => (
              <li key={keyOf(x)}>
                <button type="button" role="option" aria-selected={keyOf(x) === sel} onClick={() => setSel(keyOf(x))} data-source={x.source}
                  className={cn(option, "cursor-pointer", keyOf(x) === sel ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]")}>
                  <span className={when}>{capitalize(fmtAgo(x.t))}</span>
                  <span className={what}>
                    {x.source ? `${x.label}: ${x.title || "(no message)"}${x.by ? ` · ${x.by}` : ""}` : `${fmtStamp(x.t)} · ${x.by ?? kb(x.size ?? 0)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>}
          <section className="min-w-0 flex-1" aria-label="Version">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="w-full min-w-0 text-[13px] text-muted-foreground @md:w-auto @md:flex-1">
                {v && <span className="font-medium text-foreground">{fmtStamp(v.t)}{v.source ? ` · ${v.label}` : ""}</span>}
                {lines && <span> · {changes ? `${plural(changes, "line")} differ from the file now` : "the same as the file now"}</span>}
              </div>
              <button type="button" disabled={text === null} onClick={() => text !== null && copyText(text).then(() => notify("Copied the version", { id: "copied" }), (e) => notifyError(e))}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] bg-foreground/[0.06] px-3 text-[15px] font-medium hover:bg-foreground/[0.1] disabled:opacity-40 md:h-7 md:rounded-[6px] md:text-[13px]">
                <Copy className="size-3.5" strokeWidth={2.25} />Copy
              </button>
              <button type="button" disabled={text === null || restoring || (lines !== null && !changes)} onClick={() => void restore()}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[15px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 md:h-7 md:rounded-[6px] md:text-[13px]">
                <RotateCcw className="size-3.5" strokeWidth={2.25} />Restore
              </button>
            </div>
            <div className="overflow-x-auto rounded-[10px] border-[0.5px] border-border bg-card py-2 font-mono text-[12.5px] leading-[19px] md:rounded-[8px]">
              {lines === null ? <Loading className="px-3 font-sans text-[13px] leading-[19px]" /> : <DiffRows lines={lines} />}
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
