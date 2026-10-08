// The vault's tags: nested ones under their parents, each with its file count; a tag opens
// its sheet, where it's renamed (right-click: Rename).
import { useMemo, useState } from "react"
import { ChevronRight, FileText, Hash, Pencil } from "lucide-react"
import { cn, Empty, hasTag, List, notify, notifyError, op, openDetail, openFile, openMenu, Row, SheetHead, SidebarHeading, snippet, detailPath, type SidebarCtx, type Store } from "@vaultite"

export const TINT = "var(--primary)"

type Node = { name: string; full: string; count: number; kids: Node[] }

/** Every tag as a tree: counts are files with the tag or one nested under it; case-insensitive, first spelling kept. */
export function tagTree(store: Store): Node[] {
  const roots: Node[] = []
  const byKey = new Map<string, Node>()
  const counted = new Map<string, Set<string>>()
  for (const f of store.files.files) {
    for (const tag of f.tags ?? []) {
      const parts = tag.split("/").filter(Boolean)
      let level = roots
      for (let i = 0; i < parts.length; i++) {
        const full = parts.slice(0, i + 1).join("/")
        const key = full.toLowerCase()
        let n = byKey.get(key)
        if (!n) { n = { name: parts[i], full, count: 0, kids: [] }; byKey.set(key, n); level.push(n) }
        const seen = counted.get(key) ?? new Set<string>()
        if (!seen.has(f.path)) { seen.add(f.path); n.count++ }
        counted.set(key, seen)
        level = n.kids
      }
    }
  }
  const sort = (ns: Node[]) => { ns.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); ns.forEach((n) => sort(n.kids)) }
  sort(roots)
  return roots
}

/** Files with a tag (or one nested under it), newest first. */
export const filesWith = (store: Store, tag: string) =>
  store.files.files.filter((f) => hasTag(f.tags ?? [], tag)).sort((a, b) => b.mtime - a.mtime)

const OPEN_KEY = "vaultite.tags.open"
function useOpened(): [Set<string>, (k: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]")) } catch { return new Set() } })
  const toggle = (k: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(k)) n.delete(k); else n.add(k)
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])) } catch { /* private mode */ }
    return n
  })
  return [open, toggle]
}

function TagRow({ node, depth, open, toggle }: { node: Node; depth: number; open: Set<string>; toggle: (k: string) => void }) {
  const key = node.full.toLowerCase()
  const shown = open.has(key)
  return (
    <>
      <div className="group/row flex h-7 min-w-0 items-center gap-1 rounded-[5px] pr-1 text-[13px] hover:bg-foreground/[0.04]" style={{ paddingLeft: `calc(${depth} * 14px + 4px)` }}
        data-tag-row={node.full} onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openMenu({ x: e.clientX, y: e.clientY }, [{ label: `Rename #${node.full}…`, icon: Pencil, run: () => { renaming = node.full; openDetail(detailPath("tag", node.full)) } }])
        }}>
        {node.kids.length ? (
          <button type="button" aria-label={shown ? `Fold ${node.name}` : `Show tags under ${node.name}`} aria-expanded={shown} onClick={() => toggle(key)}
            className="grid size-4 shrink-0 cursor-pointer place-items-center text-muted-foreground">
            <ChevronRight className={cn("size-3.5 transition-transform", shown && "rotate-90")} strokeWidth={2.5} />
          </button>
        ) : <span className="size-4 shrink-0" />}
        <button type="button" data-keyrow className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left" onClick={() => openDetail(detailPath("tag", node.full))}
          data-tip={`Files tagged #${node.full}`}>
          <Hash className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[12px] text-tertiary tabular-nums">{node.count}</span>
        </button>
      </div>
      {shown && node.kids.map((k) => <TagRow key={k.full} node={k} depth={depth + 1} open={open} toggle={toggle} />)}
    </>
  )
}

/** The sidebar's Tags panel (desktop). Nothing in the icon rail. */
export function TagsPanel({ store, open }: SidebarCtx) {
  const tree = useMemo(() => tagTree(store), [store])
  const [opened, toggle] = useOpened()
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-tags-panel>
      <SidebarHeading title="Tags" open={open} />
      {tree.length ? (
        <div>{tree.map((n) => <TagRow key={n.full} node={n} depth={0} open={opened} toggle={toggle} />)}</div>
      ) : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">No tags yet. Write #tag in a note.</p>}
    </div>
  )
}

/** The tab (view:tags): the same tree, a size up (`data-size-up`). */
export function TagsView({ store }: { store: Store }) {
  const tree = useMemo(() => tagTree(store), [store])
  const [opened, toggle] = useOpened()
  return (
    <div className="pb-10" data-tags-view>
      <h1 className="mb-1 text-[22px] leading-[28px] font-bold max-md:hidden">Tags</h1>
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">Every tag in the vault, from frontmatter tags and #tags in the text. Click one for its files.</p>
      {tree.length
        ? <div className="size-up-bleed"><div data-size-up>{tree.map((n) => <TagRow key={n.full} node={n} depth={0} open={opened} toggle={toggle} />)}</div></div>
        : <Empty>No tags yet. Write #tag in a note.</Empty>}
    </div>
  )
}

/** The tag whose sheet opens with its rename field (right-click, Rename). */
let renaming: string | null = null

function Rename({ tag, done }: { tag: string; done: () => void }) {
  const [to, setTo] = useState(tag)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const name = to.trim().replace(/^#/, "")
    if (!name || name === tag) return done()
    setBusy(true)
    try {
      const r = await op<{ changed: string[]; skipped: unknown[] }>("tag.rename", { from: tag, to: name })
      notify(`Renamed #${tag} to #${name} in ${r.changed.length} file${r.changed.length === 1 ? "" : "s"}` + (r.skipped.length ? `; ${r.skipped.length} left alone` : ""))
      openDetail(detailPath("tag", name))
    } catch (e) { notifyError(e, `Couldn't rename #${tag}`) } finally { setBusy(false); done() }
  }
  return (
    <form className="mb-4 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void go() }} data-tag-rename>
      <span className="text-muted-foreground">#</span>
      <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") done() }} aria-label="New name"
        className="h-8 min-w-0 flex-1 rounded-[8px] bg-foreground/[0.05] px-2 text-[15px] outline-none focus:ring-2 focus:ring-primary/40 md:text-[14px]" />
      <button type="submit" disabled={busy} className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {busy ? "Renaming…" : "Rename"}
      </button>
    </form>
  )
}

/** A tag's sheet: the files that have it (or a tag nested under it), the tags under it, and Rename. */
export function TagDetail({ store, tag }: { store: Store; tag: string }) {
  const [editing, setEditing] = useState(() => { const now = renaming === tag; renaming = null; return now })
  const files = filesWith(store, tag)
  const low = tag.toLowerCase()
  const under = [...new Set(store.files.files.flatMap((f) => (f.tags ?? []).filter((t) => t.toLowerCase().startsWith(`${low}/`))))].sort()
  return (
    <>
      <SheetHead icon={Hash} tint={TINT} kicker="Tag" title={`#${tag}`} sub={`${files.length} file${files.length === 1 ? "" : "s"}`} />
      {editing ? <Rename key={tag} tag={tag} done={() => setEditing(false)} /> : files.length > 0 && (
        <button type="button" onClick={() => setEditing(true)} data-tag-rename-open
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground md:text-[13px]">
          <Pencil className="size-3.5" strokeWidth={2} />Rename
        </button>
      )}
      {under.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {under.map((t) => (
            <button key={t} type="button" onClick={() => openDetail(detailPath("tag", t))}
              className="cursor-pointer rounded-md bg-primary/10 px-1.5 text-[14px] leading-6 text-primary hover:bg-primary/20">#{t}</button>
          ))}
        </div>
      )}
      {files.length ? (
        <List>
          {files.map((f) => (
            <Row key={f.path} title={<span className="flex items-center gap-1.5"><FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />{f.path.split("/").pop()!.replace(/\.md$/i, "")}</span>}
              meta={f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : snippet(f.title)} onOpen={() => openFile(f.path)} />
          ))}
        </List>
      ) : <Empty>No file has #{tag} yet.</Empty>}
    </>
  )
}
