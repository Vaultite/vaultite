// Review: the files AIs changed that the user hasn't looked at (plugin.ts), each a card that unfolds to its diff with
// Keep and Revert, like a pull request's files; the count in the status bar and the line in a changed file's header.
import { useEffect, useState } from "react"
import { Archive, Check, CheckCheck, ChevronDown, ChevronRight, GitCompareArrows, RotateCcw } from "lucide-react"
import {
  AmbientButton, Button, capitalize, cn, DiffRows, fmtAgo, fmtStamp, folderOf, Loading, notify, notifyError, op, openFile, openView, plural, post, put,
  readFile, stem, textDiff, useLive, type DiffLine, type FileHead,
} from "@vaultite"
import { argOf, reviewFileView, reviewView, useReview, type Pending } from "./open"

type Detail = (Pending & { pending: true; base: { t: number; text: string } | null; exact: boolean; yours: boolean }) | { path: string; pending: false }
type Undo = { was: Record<string, number | null>; relabeled?: { path: string; was: string }[] }

const names = (by: string[]) => (by.length <= 2 ? by.join(" and ") : `${by.slice(0, -1).join(", ")} and ${by.at(-1)}`)
/** "ChatGPT edited", "Claude and Codex created". */
const whoDid = (f: Pending) => `${names(f.by)} ${f.created ? "created" : "edited"}`

/** What undoes a keep: the marks as they were, and the labels put back. */
async function unkeep(u: Undo) {
  await post("review/marks", { was: u.was })
  for (const r of u.relabeled ?? []) await op("provenance.set", { path: r.path, origin: r.was })
}

async function keepFile(path: string) {
  try {
    const r = await op<Undo & { kept: string[] }>("review.keep", { path })
    notify(`Kept ${stem(path)}`, { action: { label: "Undo", run: () => void unkeep(r).catch((e) => notifyError(e, "Couldn't undo it")) } })
  } catch (e) { notifyError(e, "Couldn't keep it") }
}

async function keepAll(by: string | undefined, n: number) {
  try {
    const r = await op<Undo & { kept: string[] }>("review.keep", { all: true, ...(by ? { by } : {}) })
    notify(`Kept ${plural(r.kept.length || n, "file")}`, { action: { label: "Undo", run: () => void unkeep(r).catch((e) => notifyError(e, "Couldn't undo it")) } })
  } catch (e) { notifyError(e, "Couldn't keep them") }
}

type Reverted = { reverted: { path: string; archived?: string; text?: string; was?: string }[]; was: Record<string, number | null> }
async function revertFile(path: string) {
  try {
    const r = await op<Reverted>("review.revert", { path })
    const f = r.reverted[0]
    if (!f) return
    const undo = async () => {
      if (f.archived) await op("archive.restore", { path: f.archived })
      else await put("file", { path, text: f.was, base: f.text })
      await post("review/marks", { was: r.was })
    }
    notify(`${f.archived ? "Archived" : "Reverted"} ${stem(path)}`, { action: { label: "Undo", run: () => void undo().catch((e) => notifyError(e, "Couldn't undo it")) } })
  } catch (e) { notifyError(e, "Couldn't revert it") }
}

/** One file's change: before the AI's first unreviewed change against now, a few lines around each change. */
function FileDiff({ path, onDone }: { path: string; onDone?: () => void }) {
  const { data: d } = useLive<Detail>(`review/file?path=${encodeURIComponent(path)}`, undefined, (p) => p === path)
  const [now, setNow] = useState<string | null>(null)
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    readFile(path).then((f) => { if (live) setNow(f.text) }, () => { if (live) setNow("") })
    return () => { live = false }
  }, [path, d])
  const base = d?.pending ? d.base : null
  useEffect(() => {
    if (!base || now === null) { setLines(null); return }
    let live = true
    textDiff(base.text, now, 3).then((l) => { if (live) setLines(l) }, (e) => notifyError(e))
    return () => { live = false }
  }, [base, now])
  if (!d) return <Loading className="px-4 py-3" />
  if (!d.pending) return <p className="px-4 py-3 text-[15px] text-muted-foreground md:text-[13px]">Nothing left to review here.</p>
  const act = (fn: () => Promise<void>) => async () => { setBusy(true); await fn(); setBusy(false); onDone?.() }
  const note = "px-4 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]"
  return (
    <div className="border-t-[0.5px] border-border pt-3 pb-3" data-review-diff>
      {!d.base ? (
        <p className={note}>
          No version from just before this change is kept (File history keeps them for a week, at most one every few minutes), so it
          can only be kept. <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => openView(`history/${path}`)}>Open version history</button>
        </p>
      ) : (
        <>
          <p className={cn(note, "mb-2")}>
            {d.created ? "A new file. Archive moves it out of the way (it can be undone)." : <>Compared with the version from {fmtStamp(d.base.t)}, just before {names(d.by)}'s first change.</>}
            {d.yours && " Your own edits since are in it too: Revert undoes them as well."}
          </p>
          <div className="mx-3 overflow-x-auto rounded-[8px] border-[0.5px] border-border bg-background py-1.5 font-mono text-[12.5px] leading-[19px] md:mx-4 md:rounded-[6px]">
            {lines === null ? <Loading className="px-3 font-sans text-[13px] leading-[19px]" /> : <DiffRows lines={lines} />}
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 px-3 md:px-4">
        <Button look="primary" disabled={busy} onClick={act(() => keepFile(path))} data-review-keep className="max-md:h-11">
          <Check className="size-4" strokeWidth={2.25} />Keep
        </Button>
        {d.base && (
          <Button disabled={busy} onClick={act(() => revertFile(path))} data-review-revert className="max-md:h-11">
            {d.created ? <Archive className="size-4" strokeWidth={2.25} /> : <RotateCcw className="size-4" strokeWidth={2.25} />}{d.created ? "Archive" : "Revert"}
          </Button>
        )}
        <Button look="quiet" onClick={() => openFile(path)} className="max-md:h-11">Open</Button>
      </div>
    </div>
  )
}

/** The lines a change added and removed, coloured; or what it is when they can't be counted. */
function Size({ f }: { f: Pending }) {
  if (f.created) return <span>new file</span>
  if (f.added === undefined) return <span>no earlier version</span>
  return <span className="tabular-nums"><span className={f.added ? "text-[var(--green)]" : undefined}>+{f.added}</span> <span className={f.removed ? "text-[var(--red)]" : undefined}>−{f.removed}</span></span>
}

/** A file to review: its name and who changed it, unfolding to its diff. */
function FileCard({ f, open, toggle }: { f: Pending; open: boolean; toggle: () => void }) {
  const folder = folderOf(f.path)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section data-review-file={f.path} className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card md:rounded-[8px]">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-foreground/[0.03] md:min-h-12 md:px-4">
        <Chevron className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-[22px] font-medium md:text-[15px] md:leading-[20px]">{stem(f.path)}</span>
          <span className="block truncate text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">
            {whoDid(f)} · <Size f={f} /> · {fmtAgo(f.last)}{folder && <> · {folder}</>}
          </span>
        </span>
      </button>
      {open && <FileDiff path={f.path} />}
    </section>
  )
}

/** view:review (every writer's) and view:review/<writer>: the files to review, newest first. */
export function ReviewView({ arg }: { arg: string }) {
  const by = arg ? argOf(arg) : undefined
  const { data, error } = useLive<{ files: Pending[] }>(`review${by ? `?by=${encodeURIComponent(by)}` : ""}`, undefined, true, 60_000)
  const files = data?.files ?? null
  // The first one unfolded, as a PR's first file is in sight.
  const [open, setOpen] = useState<Set<string> | null>(null)
  if (open === null && files?.length) setOpen(new Set([files[0].path]))
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  return (
    <div className="pb-10" data-review-view>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="flex-1 text-[22px] leading-[28px] font-bold max-md:hidden">{by ? `${capitalize(by)}'s changes` : "Review AI changes"}</h1>
        {!!files?.length && (
          <Button size="small" onClick={() => void keepAll(by, files.length)} data-review-keep-all className="max-md:ml-auto max-md:h-9">
            <CheckCheck className="size-3.5" strokeWidth={2.25} />Keep all
          </Button>
        )}
      </div>
      <p className="mb-4 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">
        {by ? <>What {by} changed in your vault that you haven't reviewed. </> : <>What AI apps and coding agents changed in your vault that you haven't reviewed. </>}
        Keep what's right, revert what isn't; a later change shows a file again.
        {by && <> <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => reviewView()}>Every writer's</button></>}
      </p>
      {files === null ? <Loading error={error ? "Couldn't load the changes." : undefined} /> : !files.length ? (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-4 py-3 text-[15px] text-muted-foreground md:text-[13px]" data-review-empty>
          <Check className="size-4 shrink-0" strokeWidth={2} />Nothing to review. When an AI changes your vault, it shows here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {files.map((f) => <FileCard key={f.path} f={f} open={!!open?.has(f.path)} toggle={() => toggle(f.path)} />)}
        </div>
      )}
    </div>
  )
}

/** view:review-file/<path>: one file's changes, from its header. */
export function ReviewFileView({ path }: { path: string }) {
  const { data } = useReview()
  const f = data?.files.find((x) => x.path === path)
  const others = (data?.files.length ?? 0) - (f ? 1 : 0)
  return (
    <div className="pb-10" data-review-view={path}>
      <p className="mt-3 mb-4 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">
        {f ? <>{whoDid(f)} <button type="button" className="cursor-pointer font-medium text-foreground hover:underline" onClick={() => openFile(path)}>{stem(path)}</button> {fmtAgo(f.last)}: keep it, or revert to the text before.</>
          : data ? <>Nothing left to review in <button type="button" className="cursor-pointer font-medium text-foreground hover:underline" onClick={() => openFile(path)}>{stem(path)}</button>.</> : null}
        {others > 0 && <> <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => reviewView()}>{plural(others, "other file")} to review</button></>}
      </p>
      {f && (
        <section className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card md:rounded-[8px]" data-review-file={path}>
          <div className="flex min-h-12 items-center gap-2.5 px-3 py-2 md:px-4">
            <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground md:text-[13px]">{path} · <Size f={f} /></span>
          </div>
          <FileDiff path={path} />
        </section>
      )}
    </div>
  )
}

/** The status bar's count of files to review, when there are any. */
export function ReviewCount() {
  const n = useReview().data?.files.length ?? 0
  return n ? <AmbientButton icon={GitCompareArrows} text={n} tip={`AI changes to review, ${plural(n, "file")}`} tint="var(--review)" onClick={() => reviewView()} /> : null
}

/** In a changed file's header: who changed it, a click from its review. */
export function ReviewChip({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const f = useReview().data?.files.find((x) => x.path === file.path)
  if (!f) return null
  const bar = file.place === "bar"
  const who = f.by.length > 1 ? "AIs" : f.by[0]
  return (
    <button type="button" onClick={() => reviewFileView(file.path)} data-review-chip
      data-tip={`${whoDid(f)} this ${fmtAgo(f.last)}: review the change`}
      className={cn("flex min-w-0 cursor-pointer items-center gap-1 text-[var(--review)]",
        bar ? "h-7 max-w-64 rounded-[5px] px-1.5 text-[12px] hover:bg-foreground/[0.06]"
          // (a phone's 44px target, laid out in the line's 32px)
          : "-my-1.5 h-11 px-1 text-[13px] active:opacity-50 md:my-0 md:h-8 md:rounded-[6px] md:px-1.5 md:hover:bg-foreground/[0.06]")}>
      <GitCompareArrows className={cn("shrink-0", bar ? "size-3.5" : "size-4")} strokeWidth={2.25} />
      <span className="truncate">{who} changed this</span>
      <span className="shrink-0 font-medium">· Review</span>
    </button>
  )
}
