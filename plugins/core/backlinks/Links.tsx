import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { FileQuestion, FileText, Globe, NotebookPen, SquareArrowOutUpRight } from "lucide-react"
import {
  Bar, cn, createNamed, Foldable, get, getStore, HeadingButton, isDesktop, newNoteFolder, openDetail, openFile, openInSplit, openView, post, resolver,
  SidebarHeading, snippet, startDrag, stem, useFocusedFile, useHeldHeight, useKeptCount, useLive, useNearEnd, useVaultChange, viewInfo, type SidebarCtx, type Store,
} from "@vaultite"
import { siteOf } from "./weblinks"

type Mention = { path: string; line: string; nth: number; col: number; len: number; text: string }
type Unlinked = { total: number; files: number; mentions: Mention[] }
type Out = { key: string; title: string; file?: string; detail?: string }

const isMd = (p: string) => /\.md$/i.test(p)
const PAGE = 100

type FileLinked = { path: string; linked: { path: string; line: string }[]; links: string[] }

function useLinks(store: Store, path: string) {
  const [v, setV] = useState(() => Date.now())
  useVaultChange(() => setV(Date.now()), (p) => !p.startsWith("."))
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [path])
  const { data } = useLive<Unlinked>(path && isMd(path) ? `backlinks/unlinked?path=${encodeURIComponent(path)}&limit=${limit}` : null, v)
  const unlinked = path && isMd(path) ? data ?? null : { total: 0, files: 0, mentions: [] }
  const more = () => { if (data && data.mentions.length < data.total && data.mentions.length >= limit) setLimit(limit + PAGE) }
  const got = useLive<FileLinked>(path ? `file/linked?path=${encodeURIComponent(path)}` : null, v).data
  const answer = got?.path === path ? got : null
  const linked = useMemo(() => answer?.linked.map((l) => ({ ...l, title: stem(l.path) })) ?? null, [answer])
  const outgoing = useMemo(() => {
    if (!answer) return null
    const resolve = resolver(store)
    const seen = new Map<string, Out>()
    for (const t of answer.links) {
      const r = resolve(t, path)
      const key = r ? r.file || r.detail || r.id : `?${t.split("#")[0].trim().toLowerCase()}`
      if (r?.file === path || seen.has(key)) continue
      seen.set(key, { key, title: r ? (r.file ? stem(r.file) : r.title) : t.split("#")[0].trim(), file: r?.file, detail: r?.detail || undefined })
    }
    return [...seen.values()].sort((a, b) => Number(!a.file && !a.detail) - Number(!b.file && !b.detail))
  }, [store, path, answer])
  return { linked, outgoing, unlinked, more, refresh: () => setV(Date.now()) }
}

function Item({ icon: Icon, title, context, faint, onOpen, action, tip, path }: {
  icon: typeof FileText; title: string; context?: ReactNode; faint?: boolean; onOpen?: () => void; action?: ReactNode; tip?: string
  path?: string
}) {
  return (
    <div className={cn("group/item relative flex min-w-0 flex-col rounded-[5px] py-1 pr-1 pl-1.5", onOpen && "cursor-pointer hover:bg-foreground/[0.04]", faint && "opacity-60")}
      onPointerDown={path ? (e) => { if (!(e.target instanceof Element && e.target.closest("button"))) startDrag(e, { from: "row", path, to: `file:${path}`, label: title }) } : undefined}
      onClick={onOpen} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} data-keyrow={onOpen ? "" : undefined} data-tip={tip ?? (path ? undefined : title)} data-tip-trunc={tip ? undefined : ""} data-link-item={title} data-preview={path}
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

function around(m: Mention) {
  const a = Math.max(0, m.col - 60), b = Math.min(m.line.length, m.col + m.len + 80)
  const before = m.line.slice(a, m.col), after = m.line.slice(m.col + m.len, b)
  const pre = snippet(before) + (/\s$/.test(before) ? " " : ""), post = (/^\s/.test(after) ? " " : "") + snippet(after)
  return (
    <>{a > 0 && "…"}{pre}<strong className="font-semibold text-foreground">{m.text}</strong>{post}{b < m.line.length && "…"}</>
  )
}

function More({ onNear, children }: { onNear: () => void; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useNearEnd(ref, onNear, 0, "400px")
  return <p ref={ref} className="py-1 pl-6 text-[12px] text-tertiary">{children}</p>
}

const empty = (text: string) => <p className="py-1 pl-6 text-[12px] text-tertiary">{text}</p>

function Looking({ count }: { count: number }) {
  if (!count) return <p className="loading-in py-1 pl-6 text-[12px] text-tertiary" aria-busy><span className="shimmer">Looking…</span></p>
  return (
    <div className="loading-in" aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-w-0 flex-col py-1 pr-1 pl-1.5">
          <div className="flex h-5 min-w-0 items-center gap-2 text-[13px]"><span className="skeleton size-4 shrink-0" /><span className="min-w-0 flex-1"><Bar w={i % 2 ? "35%" : "50%"} /></span></div>
          <div className="pl-6 text-[12px] leading-[16px]"><Bar w="85%" /></div>
        </div>
      ))}
    </div>
  )
}

function Held({ id, children }: { id: string; children: ReactNode }) {
  const held = useHeldHeight<HTMLDivElement>(id, true, true)
  return <div ref={held} className="flex flex-col gap-px">{children}</div>
}

export function LinksList({ store, path, pane }: { store: Store; path: string; pane?: string }) {
  const { linked, outgoing, unlinked, more, refresh } = useLinks(store, path)
  const [busy, setBusy] = useState("")
  const looking = useKeptCount(`links:unlinked:${path}`, unlinked ? unlinked.mentions.length : undefined, 0, 6)
  const lookingLinked = useKeptCount(`links:linked:${path}`, linked ? linked.length : undefined, 0, 6)
  const at = pane ? "tab" : "panel"
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
      <Foldable data-links-group="linked" keep="links.linked" title="Linked mentions" count={linked ? linked.length : null}>
        <Held id={`links:linked:${at}:${path}`}>
          {!linked ? <Looking count={lookingLinked} /> : linked.length ? linked.map((l) => (
            <Item key={l.path} icon={FileText} title={l.title} onOpen={() => open(l.path)} path={l.path} context={l.line && snippet(l.line)} />
          )) : empty("Nothing links here yet.")}
        </Held>
      </Foldable>
      <Foldable data-links-group="unlinked" keep="links.unlinked" title="Unlinked mentions" count={unlinked ? unlinked.total : null}>
        {!unlinked ? <Looking count={looking} /> : unlinked.mentions.length ? <>{unlinked.mentions.map((m) => {
          const key = `${m.path}:${m.line}:${m.nth}:${m.col}`
          return (
            <Item key={key} icon={FileText} title={stem(m.path)} context={around(m)} onOpen={() => open(m.path)} path={m.path}
              action={
                <button type="button" disabled={busy === key} data-link-action
                  onClick={(e) => { e.stopPropagation(); link(m) }} data-tip={`Make it [[${stem(path)}]]`}
                  className="relative h-5 shrink-0 cursor-pointer rounded-[4px] px-1.5 text-[12px] font-medium text-primary opacity-0 group-hover/item:opacity-100 hover:bg-primary/10 focus-visible:opacity-100 disabled:opacity-50 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-3">
                  Link
                </button>
              } />
          )
        })}
        {unlinked.mentions.length < unlinked.total && (
          <More key={unlinked.mentions.length} onNear={more}>{unlinked.total - unlinked.mentions.length} more…</More>
        )}</> : empty(isMd(path) ? "Its name isn't written anywhere else." : "Only notes have mentions.")}
      </Foldable>
      <Foldable data-links-group="outgoing" keep="links.outgoing" title="Outgoing links" count={outgoing ? outgoing.length : null}>
        <Held id={`links:outgoing:${at}:${path}`}>
          {!outgoing ? <Looking count={0} /> : outgoing.length ? outgoing.map((o) => {
            const to = o.file, detail = o.detail
            return (
              <Item key={o.key} icon={to || detail ? FileText : FileQuestion} title={o.title} faint={!to && !detail}
                tip={!to && !detail ? "No file has this name yet" : undefined}
                onOpen={to ? () => open(to) : detail ? () => openDetail(detail) : undefined} path={to || undefined} />
            )
          }) : empty("It doesn't link anywhere.")}
        </Held>
      </Foldable>
    </div>
  )
}

type WebLinked = { site: string; about: { path: string }[]; linked: { path: string; line: string }[]; elsewhere: { path: string; url: string; line: string }[]; total: number }

export const webPageOf = (tab: string) => /^view:web\/(?:@[^/]+\/)?(https?:\/\/.+)$/i.exec(tab)?.[1] ?? ""

export async function openPageNote(url: string, title: string) {
  const r = await get<WebLinked>(`backlinks/web?url=${encodeURIComponent(url)}&limit=1`)
  const name = title.replaceAll("/", " - ").trim().slice(0, 100) || siteOf(url)
  const path = r.about[0]?.path ?? (await createNamed(newNoteFolder(getStore()), name, `---\nsource: ${/\s/.test(url) ? JSON.stringify(url) : url}\n---\n`))?.path
  if (!path) return
  if (isDesktop()) openInSplit(`file:${path}`); else openFile(path)
}

function WebLinksList({ url, title, pane }: { url: string; title: string; pane?: string }) {
  const [v, setV] = useState(() => Date.now())
  useVaultChange(() => setV(Date.now()), (p) => !p.startsWith("."))
  const { data } = useLive<WebLinked>(`backlinks/web?url=${encodeURIComponent(url)}`, v)
  const looking = useKeptCount(`links:web:${url}`, data ? data.about.length + data.linked.length : undefined, 0, 6)
  const open = (p: string) => openFile(p, { pane })
  const site = siteOf(url)
  return (
    <div className="flex flex-col" data-links-for={url}>
      <Foldable data-links-group="page" keep="links.page" title="This page" count={data ? data.about.length + data.linked.length : null}>
        {!data ? <Looking count={looking} /> : <>
          {data.about.map(({ path }) => <Item key={`a:${path}`} icon={NotebookPen} title={stem(path)} context="A note on this page" onOpen={() => open(path)} path={path} />)}
          {data.linked.map(({ path, line }) => <Item key={`l:${path}`} icon={FileText} title={stem(path)} context={snippet(line)} onOpen={() => open(path)} path={path} />)}
          {!data.about.length && !data.linked.length && empty("No note links here yet.")}
          <button type="button" data-page-note onClick={() => void openPageNote(url, title)}
            className="flex h-6 cursor-pointer items-center gap-2 rounded-[5px] pl-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
            <NotebookPen className="size-4 shrink-0" strokeWidth={2} />{data.about.length ? "Open its note" : "New note on this page"}
          </button>
        </>}
      </Foldable>
      {site && <Foldable data-links-group="site" keep="links.site" title={`Elsewhere on ${site}`} count={data ? data.total : null}>
        {!data ? <Looking count={0} /> : data.elsewhere.length ? <>{data.elsewhere.map(({ path, url: to, line }, i) => (
          <Item key={`${path}:${i}`} icon={Globe} title={stem(path)} context={snippet(line)} tip={to} onOpen={() => open(path)} path={path} />
        ))}{data.total > data.elsewhere.length && empty(`${data.total - data.elsewhere.length} more`)}</> : empty("No note links its other pages.")}
      </Foldable>}
    </div>
  )
}

export function LinksPanel({ store, open, file: focused, tab }: SidebarCtx) {
  const last = useFocusedFile()
  const page = focused ? "" : webPageOf(tab)
  const file = focused || last.path
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-links-panel>
      <SidebarHeading title="Links" open={open}>
        <HeadingButton icon={SquareArrowOutUpRight} label="Open links in a tab" tip="Open in a tab" onClick={() => openView("links", { newTab: true })} />
      </SidebarHeading>
      {page ? <WebLinksList url={page} title={viewInfo(tab).label} /> : file ? <>
        {!focused && <p className="truncate pl-1.5 text-[12px] leading-6 text-tertiary" data-links-of>For {stem(file)}, the file you were on</p>}
        <LinksList store={store} path={file} />
      </> : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Open a file to see its links.</p>}
    </div>
  )
}

export function LinksView({ store }: { store: Store }) {
  const { path, pane: group } = useFocusedFile()
  return (
    <div className="pb-10" data-links-view>
      <h1 className="mb-1 truncate text-[22px] leading-[28px] font-bold max-md:hidden">{path ? stem(path) : "Links"}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">{path ? "What links here, where it's mentioned, and what it links to. Follows the file you're on." : "Open a file in another pane to see its links here."}</p>
      {path && <div className="size-up-bleed"><div data-size-up><LinksList store={store} path={path} pane={group} /></div></div>}
    </div>
  )
}
