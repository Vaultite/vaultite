// Vim's bars at the bottom of the focused pane outside the editor: find (/: n and N go on) and the command line (:, run
// by ex.ts, Tab completes, ↑ ↓ go through history). Escape closes either; the keyboard goes back (useHeldFocus).
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { cn, getStore, stem, useHeldFocus } from "@vaultite"
import { EX, runEx } from "./ex"
import { go, search } from "./find"
import { setLayer } from "./layer"
import { focusedRoot } from "./scroll"

/** Where a bar goes: along the bottom of the focused pane (or an open sheet), else of the window. */
function useSpot() {
  const [spot, setSpot] = useState<{ left: number; width: number; bottom: number }>({ left: 0, width: innerWidth, bottom: 0 })
  useLayoutEffect(() => {
    const el = focusedRoot()
    const box = (el?.closest("[data-pane-body]") ?? el)?.getBoundingClientRect()
    if (box) setSpot({ left: box.left, width: box.width, bottom: Math.max(0, innerHeight - box.bottom) })
  }, [])
  return spot
}

function Bar({ prompt, children, below }: { prompt: string; children: ReactNode; below?: ReactNode }) {
  const spot = useSpot()
  return (
    <div data-vim-find className="fixed z-[150] px-3 pb-2" style={{ left: spot.left, width: spot.width, bottom: spot.bottom }}>
      {below}
      <div className="flex h-8 items-center gap-1 rounded-[8px] border-[0.5px] border-border bg-popover px-2.5 font-mono text-[13px] text-popover-foreground shadow-lg">
        <span className="text-primary">{prompt}</span>
        {children}
      </div>
    </div>
  )
}

const field = "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"

export function FindBar() {
  useHeldFocus()
  const [q, setQ] = useState("")
  const [count, setCount] = useState(0)
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === "Escape") { e.preventDefault(); search(""); setLayer(null) }
    else if (e.key === "Enter") { e.preventDefault(); setLayer(null); if (q) setTimeout(() => go(1)) }
  }
  return (
    <Bar prompt="/">
      <input autoFocus aria-label="Find in the page" spellCheck={false} value={q} className={field}
        onChange={(e) => { setQ(e.target.value); setCount(search(e.target.value)) }} onKeyDown={key} />
      {q && <span className="shrink-0 font-sans text-[12px] text-muted-foreground">{count ? `${count} match${count === 1 ? "" : "es"}` : "No matches"}</span>}
    </Bar>
  )
}

const history: string[] = []
/** What :e, :sp, :vs and :tabnew take: a file. */
const TAKES_FILE = /^(e|edit|sp|split|vs|vsplit|tabe|tabedit|tabnew)\s+/

/** What can complete the line as typed: command names, or file names after a command that opens one. */
function completions(line: string): string[] {
  const m = TAKES_FILE.exec(line)
  if (m) {
    const want = line.slice(m[0].length).toLowerCase()
    const s = getStore()
    const names = [...(s?.files.files ?? []).map((f) => stem(f.path)), ...(s?.files.others ?? []).map((f) => f.path.split("/").pop()!)]
    const starts = names.filter((n) => n.toLowerCase().startsWith(want))
    const inside = names.filter((n) => !n.toLowerCase().startsWith(want) && n.toLowerCase().includes(want))
    return [...new Set([...starts, ...inside])].slice(0, 50).map((n) => m[0] + n)
  }
  if (/\s/.test(line)) return []
  const want = line.trim()
  return EX.filter((x) => x.name.startsWith(want) || x.short.startsWith(want)).map((x) => x.name)
}

export function ExLine() {
  useHeldFocus()
  const [line, setLine] = useState("")
  // Tab's candidates for what was typed, and which is shown.
  const [tab, setTab] = useState<{ base: string; list: string[]; i: number } | null>(null)
  const back = useRef(history.length)
  const list = useMemo(() => (tab ? tab.list : []), [tab])
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === "Escape") { e.preventDefault(); setLayer(null); return }
    if (e.key === "Enter") {
      e.preventDefault()
      const run = line.trim()
      setLayer(null)
      if (!run) return
      if (history[history.length - 1] !== run) history.push(run)
      // After the bar is gone and the keyboard is back where it was (a tab closed by :q is the one in focus).
      setTimeout(() => runEx(run), 30)
      return
    }
    if (e.key === "Tab") {
      e.preventDefault()
      const t = tab ?? { base: line, list: completions(line), i: -1 }
      if (!t.list.length) return
      const i = (t.i + (e.shiftKey ? -1 : 1) + t.list.length) % t.list.length
      setTab({ ...t, i })
      setLine(t.list[i])
      return
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      back.current = Math.min(history.length, Math.max(0, back.current + (e.key === "ArrowUp" ? -1 : 1)))
      setLine(history[back.current] ?? "")
      setTab(null)
    }
  }
  const below = list.length > 1 && (
    <div className="mb-1 max-h-48 overflow-y-auto rounded-[8px] border-[0.5px] border-border bg-popover py-1 font-mono text-[13px] shadow-lg">
      {list.slice(0, 50).map((c, i) => (
        <div key={c} className={cn("truncate px-2.5 py-0.5 text-muted-foreground", i === tab?.i && "bg-foreground/[0.07] text-foreground")}>{c}</div>
      ))}
    </div>
  )
  return (
    <Bar prompt=":" below={below}>
      <input autoFocus aria-label="Command" spellCheck={false} autoComplete="off" value={line} className={field}
        placeholder="e Note, sp, vs, q, cmd <command>, help" onChange={(e) => { setLine(e.target.value); setTab(null) }} onKeyDown={key} />
    </Bar>
  )
}
