// Where new files go and how links are written: new notes at the top, pasted images in Attachments/, [[wikilinks]],
// unless a plugin that's on answers otherwise (`conventions`: a vault's .obsidian/app.json). First answer wins.
import type { Conventions } from "@/core/define"
import type { Store } from "@/core/data"
import { post } from "@/core/http"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { unarchived } from "../../../core/fileprops.ts"
import { activeFile } from "@/core/active"
import { folderOf, isHidden } from "@/core/files"
import { isPage } from "@/core/pages"

type Answer<K extends keyof Conventions> = ReturnType<NonNullable<Conventions[K]>>

/** The first answer of the plugins that are on, or undefined. */
function ask<K extends keyof Conventions>(key: K, ...args: Parameters<NonNullable<Conventions[K]>>): Answer<K> | undefined {
  const { disabled } = getPrefs()
  for (const p of PLUGINS) {
    const fn = p.conventions?.[key] as ((...a: typeof args) => Answer<K>) | undefined
    if (!fn || !isEnabled(p.id, disabled)) continue
    const out = fn(...args)
    if (out !== undefined) return out
  }
  return undefined
}

/** The folder every new note goes in ("" = the top), unless the vault says otherwise. `from`: the file
 *  the user is on (an archived one as if it weren't: nothing new goes into an archive). */
export function newNoteFolder(s: Store | null | undefined, from = ""): string {
  return (s ? ask("newNoteFolder", s, unarchived(from)) : undefined) ?? ""
}

/** The folder of the note being written, for a file made from it (a canvas, a drawing, a base): an archived note's as
 *  if it weren't (nothing new goes into an archive); `fallback` when it's a page, hidden, or there's none. */
export function besideActive<T>(fallback: T, skip?: (path: string) => boolean): string | T {
  const open = activeFile()?.path
  return open && !isHidden(open) && !isPage(open) && !skip?.(open) ? folderOf(unarchived(open)) : fallback
}

/** Links are written [name](path.md), not [[name]]: only when the vault says so. */
export const markdownLinks = (s: Store | null | undefined) => (s ? ask("markdownLinks", s) : undefined) === true

/** The folder a file pasted into the note `from` goes in: Attachments, unless the vault says otherwise. */
export function attachmentFolder(s: Store | null | undefined, from: string): string {
  return (s ? ask("attachmentFolder", s, unarchived(from)) : undefined) ?? "Attachments"
}

/** Save pasted or dropped files as attachments of `from` where the vault says (or in `folder`), answering their paths.
 *  A taken name gets a number; a nameless screenshot is "Pasted image <date time>.png". */
export async function saveAttachments(s: Store, from: string, files: File[], folder = attachmentFolder(s, from)): Promise<string[]> {
  if (folder) await post("folder", { path: folder }).catch(() => {}) // (it's there already: fine)
  const out: string[] = []
  const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0")
  const when = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  for (const f of files) {
    const ext = (/\/(png|jpe?g|gif|webp|svg)/.exec(f.type)?.[1] ?? "png").replace("jpeg", "jpg")
    const name = f.name && f.name !== "image.png" ? f.name : `Pasted image ${when}.${ext}`
    const { path } = await post<{ path: string }>("upload/name", { folder, name })
    const bytes = new Uint8Array(await f.arrayBuffer())
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    await post("upload", { path, data: btoa(bin) })
    out.push(path)
  }
  return out
}

/** Save pasted files as attachments of `from` (saveAttachments) and answer what to type for them: `![[name]]` (or
 *  `![](path)` with Markdown links), one per line. */
export async function pasteAttachments(s: Store, from: string, files: File[]): Promise<string> {
  const paths = await saveAttachments(s, from, files)
  return paths.map((path) => markdownLinks(s)
    ? `![](${path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`
    : `![[${path.split("/").pop()!}]]`).join("\n")
}
