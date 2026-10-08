// Obsidian's own links, obsidian://open, new and search (notes written in Obsidian keep them), followed here.
// Other actions (a plugin's, obsidian://advanced-uri) are left to whoever registered them.
import { createFile, get, getStore, newNoteFolder, notify, openAt, openView, post, put, resolver } from "@vaultite"

const params = (u: URL) => Object.fromEntries([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]))

/** A vault path, a note's name, or an absolute path ending in one of the vault's files. */
function fileFor(target: string): string | null {
  const s = getStore()
  if (!s) return null
  const clean = target.replace(/\\/g, "/").replace(/^\/+/, "")
  const parts = clean.split("/")
  for (let i = 0; i < parts.length; i++) {
    const rel = parts.slice(i).join("/")
    const t = resolver(s)(rel.replace(/\.md$/i, ""))
    if (t?.file) return t.file
  }
  return null
}

export function obsidianLink(url: string, { mod }: { mod: boolean }): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== "obsidian:") return false
  const action = (u.hostname || u.pathname.replace(/^\/+/, "")).toLowerCase(), p = params(u)
  if (action === "open") {
    const target = p.file ?? p.path ?? ""
    const [name, anchor = ""] = target.split("#")
    const f = name ? fileFor(name) : null
    if (f) openAt(f, anchor, { newTab: mod })
    else if (name) notify(`No note ${name} in this vault`)
    return true
  }
  if (action === "search") { openView(`search/${p.query ?? ""}`); return true }
  if (action === "new") { void make(p, mod); return true }
  return false
}

async function make(p: Record<string, string>, mod: boolean) {
  const s = getStore()
  const text = p.content ?? (p.clipboard !== undefined ? await navigator.clipboard.readText().catch(() => "") : "")
  const target = p.file ?? p.path
  if (!target) {
    const f = await createFile(newNoteFolder(s!, ""), p.name ?? "Untitled", text)
    if (p.silent === undefined) openAt(f.path, "", { newTab: mod })
    return
  }
  const path = /\.\w+$/.test(target) ? target : `${target}.md`
  const was = fileFor(path)
  if (was && (p.append !== undefined || p.overwrite !== undefined)) {
    const old = p.append !== undefined ? (await get<{ text: string }>(`file?path=${encodeURIComponent(was)}`)).text : ""
    await put("file", { path: was, text: old ? `${old.replace(/\n?$/, "\n")}${text}` : text })
  } else if (!was) await post("file", { path, text })
  if (p.silent === undefined) openAt(was ?? path, "", { newTab: mod })
}
