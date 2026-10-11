// The Agent context panel: files over or near their token limit, and what each CLAUDE.md or AGENTS.md loads with its
// @imports, biggest first (the server's list: plugin.ts). A sidebar panel, or a tab.
import { FileText, SquareArrowOutUpRight } from "lucide-react"
import { cn, Foldable, HeadingButton, openFile, openView, SidebarHeading, startDrag, type SidebarCtx, type Store } from "@vaultite"
import type { Level, Sized } from "./limits"
import { tokenText } from "./estimate"
import "./types"

/** "12k", "840": a size without its tilde and unit. */
export const short = (n: number) => tokenText(n).replace(/^~| tokens?$/g, "")
export const toneOf = (l: Level) => (l === "over" ? "text-(--red)" : l === "near" ? "text-(--orange)" : "text-muted-foreground")
const name = (p: string) => p.slice(p.lastIndexOf("/") + 1)
const folder = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")))

/** One file: its name, its folder, its size (and limit); opens it, drags like a file in the tree. */
function Row({ path, size, tip, level, depth = 0, big }: { path: string; size: string; tip: string; level: Level; depth?: number; big?: boolean }) {
  const open = (e: { metaKey: boolean; ctrlKey: boolean }) => openFile(path, { newTab: e.metaKey || e.ctrlKey })
  return (
    <div role="button" tabIndex={0} data-keyrow data-context-row={path} data-level={level} data-preview={path.endsWith(".md") ? path : undefined}
      // (a note's whole path is in its preview; another file's, cut off, in the tooltip)
      data-tip={path.endsWith(".md") ? undefined : path} data-tip-trunc
      onPointerDown={(e) => startDrag(e, { from: "row", path, to: `file:${path}`, label: name(path) })}
      onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(e) }}
      className={cn("flex min-w-0 cursor-pointer items-center gap-2 rounded-[5px] pr-1.5 hover:bg-foreground/[0.04]", big ? "h-8 text-[15px]" : "h-7 text-[13px]")}
      style={{ paddingLeft: `calc(var(--spacing) * ${1.5 + depth * 4})` }}>
      <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="min-w-0 shrink truncate">{name(path)}</span>
      <span className={cn("min-w-0 flex-1 truncate text-tertiary", big ? "text-[13px]" : "text-[12px]")}>{folder(path)}</span>
      <span data-tip={tip} className={cn("shrink-0 tabular-nums", big ? "text-[13px]" : "text-[12px]", toneOf(level))}>{size}</span>
    </div>
  )
}

const sizeTip = (s: Sized) => [`About ${short(s.tokens)} tokens` + (s.total !== undefined ? `, ${short(s.total)} with its imports` : ""),
  s.limit ? `Its limit: ${short(s.limit)}` : "No limit"].join("\n")

/** Over, near, and the load chains. */
export function ContextList({ store, big }: { store: Store; big?: boolean }) {
  const files = store.tokenCount?.files ?? []
  const over = files.filter((s) => s.level === "over"), near = files.filter((s) => s.level === "near"), chains = files.filter((s) => s.chain)
  const of = (s: Sized) => `${short(s.total ?? s.tokens)} / ${short(s.limit)}`
  if (!over.length && !near.length && !chains.length) {
    return <p className={cn("pl-1.5 text-tertiary", big ? "text-[15px]" : "h-7 text-[13px] leading-7")} data-context-empty>No file is near its limit.</p>
  }
  return (
    <div className="flex flex-col" data-context-list>
      {!!over.length && (
        <Foldable data-context-group="over" title="Over the limit" count={over.length} big={big}>
          {over.map((s) => <Row key={s.path} path={s.path} size={of(s)} tip={sizeTip(s)} level="over" big={big} />)}
        </Foldable>
      )}
      {!!near.length && (
        <Foldable data-context-group="near" title="Near the limit" count={near.length} big={big}>
          {near.map((s) => <Row key={s.path} path={s.path} size={of(s)} tip={sizeTip(s)} level="near" big={big} />)}
        </Foldable>
      )}
      {!!chains.length && (
        <Foldable data-context-group="chains" title="Loaded at startup" count={chains.length} big={big}>
          {chains.map((s) => (
            <div key={s.path} data-context-chain={s.path}>
              <Row path={s.path} size={short(s.total ?? s.tokens)} tip={`${sizeTip(s)}\nWhat an agent loads with it: it and its @imports`} level={s.level} big={big} />
              {s.chain!.map((c) => (
                <Row key={c.path} path={c.path} size={short(c.tokens)} tip={`About ${short(c.tokens)} tokens, imported by ${c.from}`} level="ok" depth={c.depth} big={big} />
              ))}
            </div>
          ))}
        </Foldable>
      )}
    </div>
  )
}


export function ContextPanel({ store, open }: SidebarCtx) {
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-context-panel>
      <SidebarHeading title="Agent context" open={open}>
        <HeadingButton icon={SquareArrowOutUpRight} label="Open agent context in a tab" tip="Open in a tab" onClick={() => openView("agent-context", { newTab: true })} />
      </SidebarHeading>
      <ContextList store={store} />
    </div>
  )
}

export function ContextView({ store }: { store: Store }) {
  return (
    <div className="pb-10" data-context-view>
      <h1 className="mb-1 truncate text-[22px] leading-[28px] font-bold max-md:hidden">Agent context</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">Files over or near their token limit, and what agents load at startup with each CLAUDE.md or AGENTS.md. Limits are Token count's settings, or a file's own max_tokens.</p>
      <ContextList store={store} big />
    </div>
  )
}
