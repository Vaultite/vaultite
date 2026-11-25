import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { ChevronDown, Columns2, RefreshCw, Rows2 } from "lucide-react"
import { cn, errorText, menuBelow, op, plural, useScopedState, type MenuItem } from "@vaultite"
import type { FileDiff } from "./diffparse"
import { Counts, DiffFile, type DiffMode } from "./DiffFile"
import { GitActions } from "./GitActions"

type Diff = { id: string; source: string; branch: string; dir: string; worktree: boolean; turns: number[]; truncated: boolean; files: FileDiff[] }

const SOURCES = [["all", "All changes"], ["latest", "Latest turn"], ["uncommitted", "Uncommitted"]] as const
const sourceName = (s: string) => SOURCES.find(([k]) => k === s)?.[1] ?? `Turn ${s.slice(5)}`
const EVERY = 10_000

function useDiff(id: string, source: string) {
  const [d, setD] = useState<Diff | null>(null)
  const [error, setError] = useState("")
  const asked = useRef(0)
  const read = useCallback(() => {
    const n = ++asked.current
    void op<Diff>("claude-code.chat-diff", { id, source }).then((r) => { if (n === asked.current) { setD(r); setError("") } },
      (e) => { if (n === asked.current) setError(errorText(e, "Couldn't read the changes")) })
  }, [id, source])
  useEffect(() => {
    read()
    const t = setInterval(() => { if (document.visibilityState === "visible") read() }, EVERY)
    return () => clearInterval(t)
  }, [read])
  return { d: d && d.source === source ? d : null, error, read }
}

export function DiffView({ id }: { id: string }) {
  const [source, setSource] = useState("all")
  const [mode, setMode] = useScopedState<DiffMode>("claude-code:diff-mode", "stacked", "workspace")
  const { d, error, read } = useDiff(id, source)
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-diff-view={id} data-source={source}>
      <DiffBar d={d} source={source} setSource={setSource} mode={mode} setMode={setMode} read={read} id={id} />
      <div className="isolate min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error ? <p className="p-6 text-center text-[14px] text-muted-foreground" data-diff-error>{error}</p>
          : !d ? <div aria-hidden className="m-4 h-4 w-48 rounded-chip bg-muted" />
          : !d.files.length ? <p className="p-6 text-center text-[14px] text-muted-foreground" data-diff-empty>No changes</p>
          : <Files d={d} mode={mode} id={id} />}
      </div>
    </div>
  )
}

function Files({ d, mode, id }: { d: Diff; mode: DiffMode; id: string }) {
  const go = (path: string) => document.querySelector(`[data-diff-view="${CSS.escape(id)}"] [data-diff-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "start" })
  return (
    <>
      <ul data-diff-files className="border-b-[0.5px] border-border py-1">
        {d.files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => go(f.path)} className="flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] hover:bg-foreground/[0.04]">
              <span className="min-w-0 truncate">{f.path}</span><Counts f={f} />
            </button>
          </li>
        ))}
      </ul>
      {d.files.map((f) => <DiffFile key={`${d.source}:${f.path}`} f={f} mode={mode} chat={id} />)}
      {d.truncated && <p className="p-4 text-center text-[13px] text-muted-foreground">The rest is too long to show here</p>}
    </>
  )
}

type BarProps = { d: Diff | null; source: string; setSource: (s: string) => void; mode: DiffMode; setMode: (m: DiffMode) => void; read: () => void; id: string }

function DiffBar({ d, source: at, setSource, mode, setMode, read, id }: BarProps) {
  const pick = (e: MouseEvent) => menuBelow(e, sourceItems(d?.turns ?? [], at, setSource))
  const total = d?.files.reduce((n, f) => ({ added: n.added + f.added, removed: n.removed + f.removed }), { added: 0, removed: 0 })
  return (
    <header data-diff-bar className="flex h-11 shrink-0 items-center gap-1.5 border-b-[0.5px] border-border px-3">
      <button type="button" onClick={pick} aria-haspopup="menu" aria-label="Changes to show" data-diff-source
        className="flex h-7 cursor-pointer items-center gap-1 rounded-control px-2 text-[13px] font-medium hover:bg-foreground/[0.06]">
        {sourceName(at)}<ChevronDown className="size-3 opacity-70" />
      </button>
      <ModeSwitch mode={mode} setMode={setMode} />
      {d && total && <span className="min-w-0 truncate text-[12px] text-muted-foreground">{plural(d.files.length, "file")} · <span className="text-ink-(--green)">+{total.added}</span> <span className="text-ink-(--red)">−{total.removed}</span></span>}
      <span className="ml-auto" />
      <button type="button" onClick={read} aria-label="Refresh" data-tip="Refresh" className={ICON}><RefreshCw className="size-3.5" strokeWidth={2} /></button>
      {d && <GitActions id={id} branch={d.branch} after={read} />}
    </header>
  )
}

const ICON = "grid size-7 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"

function ModeSwitch({ mode, setMode }: { mode: DiffMode; setMode: (m: DiffMode) => void }) {
  const one = (m: DiffMode, label: string, Icon: typeof Rows2) => (
    <button type="button" aria-label={label} aria-pressed={mode === m} data-tip={label} onClick={() => setMode(m)} data-diff-mode={m}
      className={cn(ICON, mode === m && "bg-foreground/[0.07] text-foreground")}><Icon className="size-3.5" strokeWidth={2} /></button>
  )
  return <div className="flex items-center">{one("stacked", "Stacked", Rows2)}{one("split", "Side by side", Columns2)}</div>
}

function sourceItems(turns: number[], at: string, pick: (s: string) => void): MenuItem[] {
  const fixed = SOURCES.map(([s, label]) => ({ label, checked: s === at, run: () => pick(s) }))
  const each = [...turns].reverse().map((n, k) => ({ label: `Turn ${n}`, sep: k === 0, checked: at === `turn:${n}`, run: () => pick(`turn:${n}`) }))
  return [...fixed, ...each]
}
