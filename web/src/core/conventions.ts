import type { Conventions } from "@/core/define"
import { mutate, type Store } from "@/core/data"
import { op, post, upload } from "@/core/http"
import type { Dropped } from "@/core/filedrop"
import { notify } from "@/core/notify"
import { keepLocal } from "@/core/justsaved"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { attachmentDir, unarchived } from "../../../core/fileprops.ts"
import { activeFile } from "@/core/active"
import { folderOf, isHidden } from "@/core/files"
import { isPage } from "@/core/pages"
import { newLink } from "@/core/links"

type Args = { [K in keyof Conventions]-?: Parameters<NonNullable<Conventions[K]>> }
type Answers = { [K in keyof Conventions]-?: ReturnType<NonNullable<Conventions[K]>> }
type Asks = { [K in keyof Conventions]?: (...a: Args[K]) => Answers[K] | undefined }

function ask<K extends keyof Conventions>(key: K, ...args: Args[K]): Answers[K] | undefined {
  const { disabled } = getPrefs()
  for (const p of PLUGINS) {
    const asks: Asks = p.conventions ?? {}
    const fn = asks[key]
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

export async function linkedNote(s: Store, name: string, from = ""): Promise<string | null> {
  const { disabled } = getPrefs()
  for (const p of PLUGINS) {
    const fn = p.conventions?.linkedNote
    if (!fn || !isEnabled(p.id, disabled)) continue
    const path = await fn(s, name, from)
    if (path) return path
  }
  return null
}

/** The folder of the note being written, for a file made from it (a canvas, a drawing, a base): an archived note's as
 *  if it weren't (nothing new goes into an archive); `fallback` when it's a page, hidden, or there's none. */
export function besideActive<T>(fallback: T, skip?: (path: string) => boolean): string | T {
  const open = activeFile()?.path
  return open && !isHidden(open) && !isPage(open) && !skip?.(open) ? folderOf(unarchived(open)) : fallback
}

export const vaultEditor = (s: Store | null | undefined) => (s ? ask("editor", s) : undefined) ?? {}

/** The folder a file pasted into the note `from` goes in: the File explorer's attachment folder (another app's when
 *  unset: core/filing.ts), else Attachments. */
export function attachmentFolder(s: Store | null | undefined, from: string): string {
  return attachmentDir(s?.filing?.attachments ?? "Attachments", unarchived(from))
}

/** Save pasted or dropped files as `from`'s attachments (or in `folder`), answering their paths: "Pasted image <time>"
 *  when nameless, as Obsidian names them. Each is in the store once saved, not once the server's file watcher sees it. */
export async function saveAttachments(s: Store, from: string, files: File[], folder = attachmentFolder(s, from)): Promise<string[]> {
  if (folder && !s.files.folders.includes(folder)) await post("folder", { path: folder }).catch(() => {})
  const out: string[] = []
  const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0")
  const when = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  for (const f of files) {
    // A browser's generic "image.png", the iPhone camera's "image.jpg": nameless, as in Obsidian.
    const nameless = !f.name || /^image\.\w+$/i.test(f.name)
    const ext = (/\.(\w+)$/.exec(f.name)?.[1] ?? /\/(png|jpe?g|gif|webp|svg|heic|heif|avif)/.exec(f.type)?.[1] ?? "png").toLowerCase().replace("jpeg", "jpg")
    const name = nameless ? `Pasted image ${when}.${ext}` : f.name
    const { path } = await post<{ path: string }>("upload/name", { folder, name })
    await upload(path, f)
    keepLocal(path, f)
    const now = Date.now()
    mutate((st) => st.files.others.some((o) => o.path === path) ? st
      : { ...st, files: { ...st.files, others: [...st.files.others, { path, mtime: now, ctime: now, size: f.size }] } })
    out.push(path)
  }
  return out
}

export async function pasteAttachments(s: Store, from: string, files: File[]): Promise<string> {
  const paths = await saveAttachments(s, from, files)
  return paths.map((path) => newLink(s, { path, embed: true }, from)).join("\n")
}

export async function attachDropped(s: Store, from: string, d: Dropped): Promise<string> {
  const lines = d.files.length ? [await pasteAttachments(s, from, d.files)] : []
  for (const url of d.images) lines.push(await imageFrom(s, from, url))
  return [...lines, ...d.links].join("\n")
}

async function imageFrom(s: Store, from: string, url: string): Promise<string> {
  if (/^data:/i.test(url)) {
    const blob = await (await fetch(url)).blob()
    return pasteAttachments(s, from, [new File([blob], `image.${blob.type.split("/")[1]?.replace(/\+.*/, "") || "png"}`, { type: blob.type })])
  }
  try {
    const { path, bytes } = await op<{ path: string; bytes: number }>("file.upload", { url, folder: attachmentFolder(s, from) })
    const now = Date.now()
    mutate((st) => st.files.others.some((o) => o.path === path) ? st
      : { ...st, files: { ...st.files, others: [...st.files.others, { path, mtime: now, ctime: now, size: bytes }] } })
    return newLink(s, { path, embed: true }, from)
  } catch {
    notify("Couldn't download the image into the vault, so the note shows it from the web", { id: "drop-image" })
    return `![](${url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`
  }
}
