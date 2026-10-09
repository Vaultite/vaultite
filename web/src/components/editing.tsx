// What the Markdown editor draws with React and asks the vault for, wherever it edits: blocks and embeds as islands
// (each its own root), images, [[ suggestions.
import { useCallback, useMemo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Store } from "@/core/data"
import { findEmbed, folderOf, isMd, openFile, readFile, stem } from "@/core/files"
import { followLink, resolver, shortestLink, type Target } from "@/core/links"
import { markdownLinks, pasteAttachments } from "@/core/conventions"
import { notifyError } from "@/core/notify"
import { slashItems } from "@/core/slash"
import { assetPath, openEmbedMenu } from "@/components/EmbedMenu"
import { rawUrl } from "@/components/FileViewers"
import { Catch } from "@/components/Guard"
import { EmbedView, noteFor } from "@/components/NoteEmbed"
import type { Drawn, EmbedEdit, PreviewConfig } from "@/editor/livePreview"
import { headingsOf, linkText } from "../../../core/sections.ts"

const failed = () => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn. Click to edit its Markdown.</p>

/** Draw something into an element of the editor (a block, a section, an embed) as its own React root, redrawn with its
 *  new text; a failing one shows a note instead of breaking the editor. */
export function island(draw: (t: string) => ReactNode, text: string, el: HTMLElement): Drawn {
  const root = createRoot(el)
  const paint = (t: string) => root.render(<Catch fallback={failed}><div className="cm-island">{draw(t)}</div></Catch>)
  paint(text)
  return { update: paint, destroy: () => setTimeout(() => root.unmount(), 0) }
}

/** A vault file an image embed in `from` names (`![[photo.png]]`, `![](Attachments/photo.png)`), as a URL; null if
 *  there's none. */
export function assetUrl(store: Store, name: string, from?: string): string | null {
  const path = assetPath(store, name, from)
  return path ? rawUrl(path) : null
}

/** An image drawn in the editor: its open button and its menu (components/EmbedMenu.tsx). */
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

/** `![[x]]` on a line of its own in a file (`from`): a note's text (read-only), or an artifact, a table, a PDF, a
 *  player or a file a plugin draws, with its menu (`edit`: what changes it in the note); false when it names nothing. */
export function drawEmbed(store: Store, target: string, height: number | undefined, el: HTMLElement, from: string, edit?: () => EmbedEdit | null): Drawn | false {
  if (!findEmbed(store, target, from) && !noteFor(store, target, from)) return false
  return island(() => <EmbedView store={store} target={target} height={height} from={from} seen={[from]} edit={edit} />, "", el)
}

/** What a [[link]] goes to, for the editor's colours: null for nothing (grey), else its kind ("" a note or a file). */
export function linkKind(resolve: (t: string) => Target | null, target: string): string | null {
  if (target.trim().startsWith("#")) return ""
  const hit = resolve(target)
  return !hit ? null : hit.kind === "file" || hit.kind === "note" ? "" : hit.kind
}

/** What [[ suggests in `from`: every file by its name (and folder), and its aliases; attachments (images, PDFs) by name.
 *  Picking one writes the shortest path that finds it from there (its name, unless another file closer has it). */
function linkNames(store: Store, from: string) {
  const out: { label: string; detail?: string; path?: string; insert?: string; link?: string }[] = []
  for (const f of store.files.files) {
    out.push({ label: stem(f.path), detail: folderOf(f.path) || undefined, path: f.path, insert: shortestLink(store, f.path, from) })
    for (const a of f.aliases) if (a !== stem(f.path)) out.push({ label: a, detail: `→ ${stem(f.path)}`, path: f.path, link: shortestLink(store, f.path, from) })
  }
  for (const f of store.files.others) out.push({ label: stem(f.path), detail: folderOf(f.path) || undefined, path: f.path, insert: shortestLink(store, f.path, from) })
  return out
}

/** What an editor of `from` asks the vault for (the Editor's props): links to suggest and follow, the slash menu, pasted
 *  files saved as attachments. `own` is the text as typed, for [[# headings. */
export function useVaultEditing(store: Store, from: string, own: () => string) {
  // (links as written in `from`: the closest file of a name wins)
  const resolve = useMemo(() => { const r = resolver(store); return (t: string) => r(t, from) }, [store, from])
  // (worked out when [[ is first typed, then kept while the files are the same)
  const names = useMemo(() => { let list: ReturnType<typeof linkNames> | null = null; return () => (list ??= linkNames(store, from)) }, [store, from])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headings = useCallback((name: string) => headingsIn(resolve, name, from, own), [resolve, from])
  const onOpen = useCallback((link: { wiki?: string; url?: string; tag?: string }, newTab: boolean) => followLink(store, link, newTab, from), [store, from])
  const mdLinks = useCallback(() => markdownLinks(store), [store])
  const slash = useCallback(() => slashItems(store), [store])
  const paste = useCallback(async (files: File[]) => {
    try { return await pasteAttachments(store, from, files) } catch (e) { notifyError(e, "Couldn't save the pasted file"); return null }
  }, [store, from])
  return { resolve, names, headings, onOpen, markdownLinks: mdLinks, slash, paste }
}

/** [[Note#: that note's headings ("" is the text being edited, `own`, as typed so far; so is the file it's in, `from`). */
async function headingsIn(resolve: (t: string) => Target | null, name: string, from: string, own: () => string) {
  let text = ""
  if (!name.trim()) text = own()
  else {
    const file = resolve(name)?.file
    if (file && isMd(file)) text = file === from ? own() : await readFile(file).then((f) => f.text, () => "")
  }
  // (as a link can hold them: a [[link]] in a heading by its text, no [ ] | # ^; links match headings loosely)
  const plain = (h: string) => linkText(h).replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim()
  return [...new Set(headingsOf(text).map((h) => plain(h.text)).filter(Boolean))]
}
