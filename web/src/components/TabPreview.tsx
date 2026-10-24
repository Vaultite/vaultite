// A tab's small picture on its card: the iPhone app's real snapshot while still current, else a cheap static stand-in
// (only the tab on screen is mounted, so there's nothing else to picture).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { Store } from "@/core/data"
import { get } from "@/core/http"
import { kindOf } from "@/core/filekinds"
import { fileOf, splitFm, stem, type FileText } from "@/core/files"
import { vaultPath, type Tab } from "@/core/layout"
import { tabMeta } from "@/core/phoneTabs"
import { useTabShot } from "@/core/tabShots"
import { fileAt, pageView } from "@/core/pages"
import { Markdown } from "@/components/Markdown"
import { NewTab, useNewTabPage } from "@/components/NewTab"
import { rawUrl } from "@/components/FileViewers"
import type { TabInfo } from "@/components/Tabs"
import { cn } from "@/lib/utils"
import { blockName } from "../../../core/sections.ts"
import { fenceLayout } from "../../../core/blocks.ts"

// ---------- the text, read lazily ----------

/** The start of each file read so far, by path, with the store's mtime it was read at. */
const texts = new Map<string, { mtime: number; text: string }>()
/** At most this many reads at once: a list of twenty notes doesn't ask for twenty files together. */
const LIMIT = 3
let running = 0
const waiting: (() => void)[] = []
function limited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++
      fn().then(resolve, reject).finally(() => { running--; waiting.shift()?.() })
    }
    if (running < LIMIT) run(); else waiting.push(run)
  })
}

/** A file's text (its first few KB), or null until it's read. Read again when the file changes. */
function useText(path: string, mtime: number) {
  const [, redraw] = useState(0)
  const hit = texts.get(path)
  const fresh = !!hit && hit.mtime === mtime
  useEffect(() => {
    if (fresh) return
    let on = true
    limited(() => get<FileText>(`file?path=${encodeURIComponent(path)}`))
      .then((f) => {
        texts.delete(path); texts.set(path, { mtime, text: f.text.slice(0, 6000) })
        if (texts.size > 200) texts.delete(texts.keys().next().value!) // (the most recent ones, not every file previewed all day)
        if (on) redraw((n) => n + 1)
      })
      .catch(() => { /* gone or unreadable: the card keeps its placeholder */ })
    return () => { on = false }
  }, [path, mtime, fresh])
  return hit?.text ?? null
}

// ---------- a note's first lines ----------

/** A piece of the excerpt: Markdown, or something drawn in the file (a block, an embed, a diagram) as a placeholder. */
type Part = { md: string } | { block: string; wide: boolean }

/** The body's first `max` lines, in parts. A fence counts as one line; frontmatter is already gone. */
function excerpt(body: string, max: number): Part[] {
  const out: Part[] = []
  const lines = body.split("\n")
  let md: string[] = [], n = 0
  const flush = () => { if (md.some((l) => l.trim())) out.push({ md: md.join("\n") }); md = [] }
  for (let i = 0; i < lines.length && n < max; i++) {
    const line = lines[i]
    const fence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line)
    const embed = /^\s*!\[\[([^\]|#]+)/.exec(line)
    if (fence) {
      const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]))
      const end = close < 0 ? lines.length - 1 : close
      const name = blockName(fence[2]) ?? (fence[2].split(/\s/)[0] === "mermaid" ? "diagram" : null)
      if (name) {
        // Blocks and diagrams draw themselves in the app: here, a bar (a wide block takes the whole row).
        flush()
        out.push({ block: name, wide: fenceLayout(fence[2], lines.slice(i + 1, end).join("\n")).wide })
      } else md.push(...lines.slice(i, end + 1).slice(0, 8), ...(end - i > 7 ? [fence[1]] : []))
      i = end
      n++
    } else if (embed) {
      // An embed would load the file it shows (an artifact, a note): a bar named after it.
      flush()
      out.push({ block: stem(embed[1].trim()), wide: true })
      n++
    } else {
      md.push(line)
      if (line.trim()) n++
    }
  }
  flush()
  return out
}

/** A placeholder for what the app draws (a block on a dashboard, a block or embed in a note), named faintly. */
function Placeholder({ name, dashboard, wide }: { name: string; dashboard: boolean; wide: boolean }) {
  return (
    <div className={cn("mb-3 rounded-[14px] p-3 text-[15px] text-muted-foreground", dashboard ? "h-[104px] bg-card" : "h-[64px] bg-muted", wide && "col-span-2")}>
      {name.replace(/[-_]/g, " ")}
    </div>
  )
}

/** A Markdown file: its name, then (a note) its first lines or (a dashboard) its blocks as cards. Drawn at twice its
 *  size, then scaled to half: the card's text is a picture of the page, too small to read in full but shaped like it. */
function DocPreview({ store, path }: { store: Store; path: string }) {
  const f = fileOf(store, path)
  const text = useText(path, f?.mtime ?? 0)
  // A page a plugin draws (a dashboard): its title and blocks as cards, like the page.
  const dashboard = !!pageView(path, store)
  const { body } = splitFm(text ?? "")
  const parts = text === null ? [] : excerpt(body, dashboard ? 10 : 12)
  // Runs of blocks in a dashboard sit in a grid of two, like its cards; everywhere else one under another.
  const runs: Part[][] = []
  for (const p of parts) {
    const last = runs.at(-1)
    if (dashboard && "block" in p && last && "block" in last[0]) last.push(p)
    else runs.push([p])
  }
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-0 w-[200%] origin-top-left scale-50 px-5 pt-4">
      <div className="mb-2 text-[26px] leading-[32px] font-bold">{stem(path)}</div>
      {runs.map((run, i) => "md" in run[0]
        ? <Markdown key={i} text={run[0].md} store={store} from={path} />
        : (
          <div key={i} className={cn(dashboard && "grid grid-cols-2 gap-x-3")}>
            {run.map((p, j) => "block" in p && <Placeholder key={j} name={p.block} dashboard={dashboard} wide={!dashboard || p.wide} />)}
          </div>
        ))}
    </div>
  )
}

/** The tab's icon, large, on a muted ground, with its name and what it is: views, the app's pages, other files. */
// An icon and its words, near the top: a card shows only the top of its page-shaped box (padding follows its width).
const PLACED = "absolute inset-0 flex flex-col items-center gap-2 pt-[32%]"

function IconPreview({ info, meta }: { info: TabInfo; meta: string }) {
  const Icon = info.icon
  return (
    <div className={cn(PLACED, "bg-muted px-3 text-center")}>
      <Icon className={cn("size-10", !info.tint && "text-muted-foreground", info.iconClassName)} strokeWidth={1.5} style={info.tint ? { color: info.tint } : undefined} />
      <span className="max-w-full truncate text-[13px] text-muted-foreground">{meta}</span>
    </div>
  )
}

/** `children` drawn as the page draws them, at its width, shrunk to the card's (a picture of it, nothing in it to tap). */
function AtPageSize({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0)
  useLayoutEffect(() => {
    const card = box.current?.parentElement
    if (!card) return
    const fit = () => setK(card.offsetWidth / innerWidth)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} inert aria-hidden className="pointer-events-none absolute top-0 left-0 origin-top-left px-4"
      style={{ width: innerWidth, transform: `scale(${k})`, visibility: k ? undefined : "hidden" }}>
      {children}
    </div>
  )
}

/** A new tab: what it opens to (the page chosen for new tabs, or the new tab page's sections), like any other tab. */
function NewTabPreview({ store }: { store: Store }) {
  const page = useNewTabPage(store)
  return page ? <DocPreview store={store} path={page} /> : <AtPageSize><NewTab store={store} phone /></AtPageSize>
}

/** The preview inside a tab's card (it fills a positioned box). */
export function TabPreview({ store, tab, info }: { store: Store; tab: Tab; info: TabInfo }) {
  const to = tab.to
  const shot = useTabShot(tab.id, to)
  if (shot) return <img data-tab-picture src={shot} alt="" decoding="async" draggable={false} className="absolute inset-0 size-full object-cover object-top" />
  if (to === "new") return <NewTabPreview store={store} />
  const path = vaultPath(to)
  if (path !== null) {
    const kind = kindOf(path)
    if (kind === "markdown") return <DocPreview store={store} path={path} />
    if (kind === "image") {
      const v = fileAt(store.files.others, path)?.mtime
      return <img src={rawUrl(path, { v })} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full object-cover" />
    }
  }
  return <IconPreview info={info} meta={to.startsWith("view:") ? info.label : tabMeta(to)} />
}
