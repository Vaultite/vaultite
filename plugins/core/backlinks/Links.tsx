// One file's links, backlinks and outgoing links in one: linked and unlinked mentions ("Link" makes
// one a [[link]]) and outgoing links. A sidebar panel, or a tab following the other panes' file.
import { useMemo, useState, type ReactNode } from "react"
import { ChevronRight, FileQuestion, FileText, SquareArrowOutUpRight } from "lucide-react"
import {
  backlinks, cn, openDetail, openFile, openView, post, resolver, SidebarHeading, snippet, startDrag, stem, useFocusedFile,
  useLive, useVaultChange, type SidebarCtx, type Store,
} from "@vaultite"

type Mention = { path: string; line: string; nth: number; col: number; len: number; text: string }
type Out = { key: string; title: string; context: string; file?: string; detail?: string }

const isMd = (p: string) => /\.md$/i.test(p)

/** Everything the panel shows for `path`. */
function useLinks(store: Store, path: string) {
  const linked = useMemo(() => (path ? backlinks(store, path) : []), [store, path])
  const outgoing = useMemo(() => {
    const f = store.files.files.find((x) => x.path === path)
    if (!f) return []
    const resolve = resolver(store)
    const seen = new Map<string, Out>()
    for (const [t, context] of f.links) {
      const r = resolve(t)
      const key = r ? r.file || r.detail || r.id : `?${t.split("#")[0].trim().toLowerCase()}`
      if (r?.file === path || seen.has(key)) continue
      seen.set(key, { key, title: r ? (r.file ? stem(r.file) : r.title) : t.split("#")[0].trim(), context: snippet(context), file: r?.file, detail: r?.detail || undefined })
    }
    // Resolved first, then the ones that go nowhere yet.
    return [...seen.values()].sort((a, b) => Number(!a.file && !a.detail) - Number(!b.file && !b.detail))
  }, [store, path])
  // Unlinked mentions read the notes' text: asked again whenever a note changes (not a hidden file; a time, not a
  // counter: useLive shares one answer between the same addresses for a few seconds, and two panels' counters would collide).
  const [v, setV] = useState(() => Date.now())
  useVaultChange(() => setV(Date.now()), (p) => !p.startsWith("."))
  const { data } = useLive<Mention[]>(path && isMd(path) ? `backlinks/unlinked?path=${encodeURIComponent(path)}` : null, v)
  const unlinked = path && isMd(path) ? data?.filter((m) => m.path !== path) ?? null : []
  return { linked, outgoing, unlinked, refresh: () => setV(Date.now()) }
}

/** A group's open or closed state, per device (like the sidebar's own). */
function useOpen(key: string, dflt: boolean): [boolean, (v: boolean) => void] {
  const k = `vaultite.links.${key}`
  const [open, set] = useState(() => { try { const v = localStorage.getItem(k); return v === null ? dflt : v === "1" } catch { return dflt } })
  return [open, (v) => { set(v); try { localStorage.setItem(k, v ? "1" : "0") } catch { /* private mode */ } }]
}

function Group({ id, title, count, dflt = true, children }: { id: string; title: string; count: number | null; dflt?: boolean; children: ReactNode }) {
  const [open, setOpen] = useOpen(id, dflt)
  return (
    <div data-links-group={id}>
      <button type="button" data-keyrow onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-[5px] pr-1 pl-1.5 text-left text-[12px] font-medium text-muted-foreground hover:bg-foreground/[0.04]">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        <span className="flex-1 truncate">{title}</span>
        {count !== null && <span className="text-tertiary tabular-nums" data-count>{count}</span>}
      </button>
      {open && <div className="flex flex-col gap-px pb-1">{children}</div>}
    </div>
  )
}

function Item({ icon: Icon, title, context, faint, onOpen, action, tip, path }: {
  icon: typeof FileText; title: string; context?: ReactNode; faint?: boolean; onOpen?: () => void; action?: ReactNode; tip?: string
  /** The file it is: it drags like a file in the tree (onto a pane or a tab bar to open it there, onto Pinned). */
  path?: string
}) {
  return (
    <div className={cn("group/item relative flex min-w-0 flex-col rounded-[5px] py-1 pr-1 pl-1.5", onOpen && "cursor-pointer hover:bg-foreground/[0.04]", faint && "opacity-60")}
      onPointerDown={path ? (e) => { if (!(e.target as HTMLElement).closest("button")) startDrag(e, { from: "row", path, to: `file:${path}`, label: title }) } : undefined}
      onClick={onOpen} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} data-keyrow={onOpen ? "" : undefined} data-tip={tip} data-link-item={title} data-preview={path}
      onKeyDown={(e) => { if (onOpen && e.key === "Enter" && e.target === e.currentTarget) onOpen() }}>
      <div className="flex h-5 min-w-0 items-center gap-2 text-[13px]">
        <Icon className={cn("size-4 shrink-0", faint ? "text-tertiary" : "text-muted-foreground")} strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {action}
      </div>
      {context && <div className="line-clamp-2 pl-6 text-[12px] leading-[16px] text-muted-foreground">{context}</div>}
    </div>
  )
}

/** The line around a mention, the mention in bold. */
function around(m: Mention) {
  const a = Math.max(0, m.col - 60), b = Math.min(m.line.length, m.col + m.len + 80)
  const before = m.line.slice(a, m.col), after = m.line.slice(m.col + m.len, b)
  // As plain text (no Markdown marks), keeping the spaces around the name only where the line has them.
  const pre = snippet(before) + (/\s$/.test(before) ? " " : ""), post = (/^\s/.test(after) ? " " : "") + snippet(after)
  return (
    <>{a > 0 && "…"}{pre}<strong className="font-semibold text-foreground">{m.text}</strong>{post}{b < m.line.length && "…"}</>
  )
}

const empty = (text: string) => <p className="py-1 pl-6 text-[12px] text-tertiary">{text}</p>

/** The three groups for `path`. `pane`: open files in that pane (the tab view opens them beside itself). */
export function LinksList({ store, path, pane }: { store: Store; path: string; pane?: string }) {
  const { linked, outgoing, unlinked, refresh } = useLinks(store, path)
  const [busy, setBusy] = useState("")
  const open = (p: string, e?: { metaKey: boolean; ctrlKey: boolean }) => openFile(p, { newTab: !!(e?.metaKey || e?.ctrlKey), pane })
  const link = async (m: Mention) => {
    const key = `${m.path}:${m.line}:${m.nth}:${m.col}`
    setBusy(key)
    try { await post("backlinks/link", { ...m, target: path }) } catch { /* it changed: the list is read again */ }
    setBusy("")
    refresh()
  }
  return (
    <div className="flex flex-col" data-links-for={path}>
      <Group id="linked" title="Linked mentions" count={linked.length}>
        {linked.length ? linked.map(({ file, title, context }) => (
          <Item key={file.path} icon={FileText} title={title} context={context} onOpen={() => open(file.path)} path={file.path} />
        )) : empty("Nothing links here yet.")}
      </Group>
      <Group id="unlinked" title="Unlinked mentions" count={unlinked ? unlinked.length : null}>
        {!unlinked ? empty("Looking…") : unlinked.length ? unlinked.map((m) => {
          const key = `${m.path}:${m.line}:${m.nth}:${m.col}`
          return (
            <Item key={key} icon={FileText} title={stem(m.path)} context={around(m)} onOpen={() => open(m.path)} path={m.path}
              action={
                <button type="button" disabled={busy === key} data-link-action
                  onClick={(e) => { e.stopPropagation(); link(m) }} data-tip={`Make it [[${stem(path)}]]`}
                  className="h-5 shrink-0 cursor-pointer rounded-[4px] px-1.5 text-[12px] font-medium text-primary opacity-0 group-hover/item:opacity-100 hover:bg-primary/10 focus-visible:opacity-100 disabled:opacity-50">
                  Link
                </button>
              } />
          )
        }) : empty(isMd(path) ? "Its name isn't written anywhere else." : "Only notes have mentions.")}
      </Group>
      <Group id="outgoing" title="Outgoing links" count={outgoing.length}>
        {outgoing.length ? outgoing.map((o) => {
          const to = o.file, detail = o.detail
          return (
            <Item key={o.key} icon={to || detail ? FileText : FileQuestion} title={o.title} faint={!to && !detail}
              tip={!to && !detail ? "No file has this name yet" : undefined}
              onOpen={to ? () => open(to) : detail ? () => openDetail(detail) : undefined} path={to || undefined} />
          )
        }) : empty("It doesn't link anywhere.")}
      </Group>
    </div>
  )
}

const button = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

/** The sidebar's Links panel, for the focused tab's file, as tall as its links (the sidebar scrolls). In the icon rail
 *  it's the flyout's (index.tsx: `flyout`), which scrolls it. */
export function LinksPanel({ store, open, file: focused }: SidebarCtx) {
  // A tab that isn't a file (this panel's own tab, a terminal): the file focused last.
  const last = useFocusedFile()
  const file = focused || last.path
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-links-panel>
      <SidebarHeading title="Links" open={open}>
        <button type="button" className={button} aria-label="Open links in a tab" data-tip="Open in a tab"
          onClick={() => openView("links", { newTab: true })}><SquareArrowOutUpRight className="size-3.5" strokeWidth={2.25} /></button>
      </SidebarHeading>
      {file ? (
        <LinksList store={store} path={file} />
      ) : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Open a file to see its links.</p>}
    </div>
  )
}

/** The tab (view:links): the same, for the file of the pane focused last, following it as a linked pane;
 *  what it opens goes to that pane. */
export function LinksView({ store }: { store: Store }) {
  const { path, group } = useFocusedFile()
  return (
    <div className="pb-10" data-links-view>
      <h1 className="mb-1 truncate text-[22px] leading-[28px] font-bold max-md:hidden">{path ? stem(path) : "Links"}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">{path ? "What links here, where it's mentioned, and what it links to. Follows the file you're on." : "Open a file in another pane to see its links here."}</p>
      {/* The panel's list, a size up (`data-size-up`). */}
      {path && <div className="size-up-bleed"><div data-size-up><LinksList store={store} path={path} pane={group} /></div></div>}
    </div>
  )
}
