import { useCallback, useMemo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Store } from "@/core/data"
import { findEmbed, folderOf, isMd, openFile, readFile, stem } from "@/core/files"
import { followLink, resolver, shortestLink, type LinkClick, type Target } from "@/core/links"
import { attachDropped, markdownLinks } from "@/core/conventions"
import type { Dropped } from "@/core/filedrop"
import { notifyError } from "@/core/notify"
import { slashItems } from "@/core/slash"
import { vocabOf } from "@/core/vocab"
import { assetPath, openEmbedMenu } from "@/components/EmbedMenu"
import { rawUrl } from "@/components/FileViewers"
import { Catch } from "@/components/Guard"
import { EmbedView, noteFor } from "@/components/NoteEmbed"
import type { Drawn, EmbedEdit, PreviewConfig } from "@/editor/livePreview"
import { headingsOf, linkText } from "../../../core/sections.ts"

const failed = () => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn. Click to edit its Markdown.</p>

export function island<T = string>(draw: (t: T) => ReactNode, text: T, el: HTMLElement): { update: (t: T) => void; destroy: () => void } {
  const root = createRoot(el)
  const paint = (t: T) => root.render(<Catch fallback={failed}><div className="cm-island">{draw(t)}</div></Catch>)
  paint(text)
  return { update: paint, destroy: () => setTimeout(() => root.unmount(), 0) }
}

export function assetUrl(store: Store, name: string, from?: string): string | null {
  const path = assetPath(store, name, from)
  return path ? rawUrl(path) : null
}

export function imageActions(store: Store): Pick<PreviewConfig, "embedMenu" | "openImage"> {
  return {
    openImage: (target) => {
      const path = assetPath(store, target)
      if (path) openFile(path, { newTab: true })
      else if (/^https?:/i.test(target)) window.open(target, "_blank", "noopener")
    },
    embedMenu: (target, at, edit) => openEmbedMenu(store, target, at, edit),
  }
}

export function drawEmbed(store: Store, target: string, height: number | undefined, el: HTMLElement, from: string, edit?: () => EmbedEdit | null): Drawn | false {
  if (!findEmbed(store, target, from) && !noteFor(store, target, from)) return false
  return island(() => <EmbedView store={store} target={target} height={height} from={from} seen={[from]} edit={edit} />, "", el)
}

export function linkKind(resolve: (t: string) => Target | null, target: string): string | null {
  if (target.trim().startsWith("#")) return ""
  const hit = resolve(target)
  return !hit ? null : hit.kind === "file" || hit.kind === "note" ? "" : hit.kind
}

function linkNames(store: Store, from: string) {
  const out: { label: string; detail?: string; path?: string; insert?: string; link?: string }[] = []
  for (const f of store.files.files) {
    out.push({ label: stem(f.path), detail: folderOf(f.path) || undefined, path: f.path, insert: shortestLink(store, f.path, from) })
    for (const a of f.aliases) if (a !== stem(f.path)) out.push({ label: a, detail: `→ ${stem(f.path)}`, path: f.path, link: shortestLink(store, f.path, from) })
  }
  for (const f of store.files.others) out.push({ label: stem(f.path), detail: folderOf(f.path) || undefined, path: f.path, insert: shortestLink(store, f.path, from) })
  return out
}

export function useVaultEditing(store: Store, from: string, own: () => string) {
  const resolve = useMemo(() => { let r: ReturnType<typeof resolver> | null = null; return (t: string) => (r ??= resolver(store))(t, from) }, [store, from])
  const names = useMemo(() => { let list: ReturnType<typeof linkNames> | null = null; return () => (list ??= linkNames(store, from)) }, [store, from])
  const tags = useCallback(() => vocabOf(store.files.files).tagFiles.filter((t) => t.only !== from), [store, from])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- own is a getter, read at each call
  const headings = useCallback((name: string) => headingsIn(resolve, name, from, own), [resolve, from])
  const onOpen = useCallback((link: { wiki?: string; url?: string; tag?: string }, how: boolean | LinkClick) => followLink(store, link, how, from), [store, from])
  const mdLinks = useCallback(() => markdownLinks(store), [store])
  const slash = useCallback(() => slashItems(store), [store])
  const attach = useCallback(async (d: Dropped) => {
    const n = d.files.length + d.images.length
    try { return await attachDropped(store, from, d) } catch (e) { notifyError(e, n > 1 ? "Couldn't save the files" : "Couldn't save the file"); return null }
  }, [store, from])
  return { resolve, names, tags, headings, onOpen, markdownLinks: mdLinks, slash, attach }
}

async function headingsIn(resolve: (t: string) => Target | null, name: string, from: string, own: () => string) {
  let text = ""
  if (!name.trim()) text = own()
  else {
    const file = resolve(name)?.file
    if (file && isMd(file)) text = file === from ? own() : await readFile(file).then((f) => f.text, () => "")
  }
  const plain = (h: string) => linkText(h).replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim()
  return [...new Set(headingsOf(text).map((h) => plain(h.text)).filter(Boolean))]
}
