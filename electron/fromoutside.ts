import { app, dialog, type OpenDialogOptions } from "electron"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseRepo, repoText } from "../core/bundlelinks.ts"
import { plainError } from "../core/plainerror.ts"
import { inVault } from "../core/opening.ts"
import { ROOT, WIN } from "./mainbase.ts"
import { known, real, vaultOf } from "./vaultlist.ts"
import type { Win } from "./servers.ts"
import { allowIn, focusedVault, openVault, send, showManager, waiting } from "./vaultwindow.ts"

const slashed = (p: string) => (WIN ? p.replace(/\\/g, "/") : p)

export async function openFiles(paths: string[], into: Win | null): Promise<string[]> {
  const mine: string[] = []
  for (const p of paths) {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) {
      await openVault(p).catch(() => {})
      continue
    }
    const hit = vaultOf(p)
    if (hit && !hit[1].split("/").some((x) => x.startsWith("."))) {
      if (into && hit[0].path === into.vault.path) mine.push(hit[1])
      else await openVault(hit[0].path, hit[1]).catch(() => {})
      continue
    }
    let w: Win | null = into ?? focusedVault()
    if (!w) {
      const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
      if (!last) { waiting.push(p); showManager(); continue }
      w = await openVault(last.path).catch(() => null)
      if (!w) continue
    }
    const abs = slashed(p)
    allowIn(w, abs)
    if (w === into) mine.push(abs)
    else { send(w, abs); w.win.focus() }
  }
  return mine
}

function freeIn(dir: string, name: string) {
  const ext = path.extname(name), stem = ext && ext !== name ? name.slice(0, -ext.length) : name
  let out = name, n = 1
  while (fs.existsSync(path.join(dir, out))) out = `${stem} ${n++}${ext && ext !== name ? ext : ""}`
  return out
}

export function copyIn(w: Win, paths: string[], folder: string, move: boolean) {
  const parts = folder.split("/").filter(Boolean)
  if (parts.some((x) => x === ".." || x.startsWith("."))) throw new Error("not a folder of the vault")
  const dir = path.join(w.vault.path, ...parts)
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no folder '${folder}'`)
  const made: string[] = [], failed: string[] = []
  for (const src of paths) {
    try {
      const st = fs.statSync(src, { throwIfNoEntry: false })
      if (!st || !path.isAbsolute(src)) continue
      const from = real(src), into = real(dir)
      if (into === from || into.startsWith(from + path.sep) || path.dirname(from) === into) continue
      const name = freeIn(dir, path.basename(src))
      const dst = path.join(dir, name)
      if (move) {
        try {
          fs.renameSync(src, dst)
        } catch {
          fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false })
          fs.rmSync(src, { recursive: true })
        }
      } else fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false })
      made.push([...parts, name].join("/"))
    } catch (e) {
      failed.push(`${path.basename(src)}: ${plainError(e).reason ?? "it couldn't be copied"}`)
    }
  }
  if (failed.length && !made.length) throw new Error(failed[0])
  if (failed.length) {
    void dialog.showMessageBox(w.win, { type: "warning", message: `Couldn't ${move ? "move" : "copy"} ${failed.length} of ${made.length + failed.length} into ${folder || "the vault"}`, detail: failed.slice(0, 10).join("\n") })
  }
  return made
}

export async function pickOutside(w: Win | null) {
  const target = w ?? focusedVault()
  const opts = {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Notes and tables", extensions: ["md", "markdown", "txt", "csv", "html", "htm", "json"] }, { name: "All files", extensions: ["*"] }],
  } satisfies OpenDialogOptions
  const r = target ? await dialog.showOpenDialog(target.win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled) return []
  const mine = await openFiles(r.filePaths, target)
  if (target) for (const f of mine) send(target, f)
  return []
}

// Linux's Open with passes file:// URLs (the desktop file's %U), Windows' a path; a Mac sends open-file instead.
export function argFiles(argv: string[], cwd: string) {
  const out: string[] = []
  for (let i = app.isPackaged ? 1 : 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--vault") { i++; continue }
    if (a.startsWith("-") || /^vaultite:/i.test(a)) continue
    let p = a
    if (p.startsWith("file://")) try { p = fileURLToPath(p) } catch { continue }
    p = path.resolve(cwd, p)
    if (p !== ROOT && fs.existsSync(p)) out.push(p)
  }
  return out
}

// Windows and Linux hand the app a vaultite:// link on its command line; a Mac sends open-url.
export const argLinks = (argv: string[]) => argv.slice(1).filter((a) => /^vaultite:/i.test(a))
export async function appLink(url: string) {
  let u: URL
  try { u = new URL(url) } catch { return }
  if (u.protocol === "http:" || u.protocol === "https:") {
    const w = focusedVault() ?? await (async () => { const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]; return last ? openVault(last.path).catch(() => null) : null })()
    if (!w) return showManager()
    const go = (n = 0) => { if (w.win.isDestroyed()) return; if (w.ready) { w.win.webContents.send("vaultite", { type: "web", url: u.href }); w.win.show(); w.win.focus() } else if (n < 150) setTimeout(() => go(n + 1), 200) }
    return go()
  }
  if (u.protocol !== "vaultite:") return
  let rest = ""
  try { rest = decodeURIComponent(u.pathname.replace(/^\/+/, "")) } catch { return }
  const what = u.hostname.toLowerCase()
  if (what === "bundle") { const r = parseRepo(rest); if (!r) return; rest = repoText(r) }
  else if (what === "command" ? !/^[\w:.-]+$/.test(rest) : what !== "open" || !rest || rest.split(/[\\/]/).some((x) => x === ".." || x.startsWith("."))) return
  let w: Win | null = focusedVault()
  if (!w) {
    const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
    if (!last) return showManager()
    w = await openVault(last.path).catch(() => null)
  }
  if (!w) return
  if (what === "open") {
    const abs = inVault(w.vault.path, rest)
    if (!abs) return
    if (!path.extname(rest) && fs.existsSync(`${abs}.md`)) rest += ".md"
    if (!fs.existsSync(path.join(w.vault.path, rest))) return
    send(w, rest)
  } else {
    const to = w
    const msg = what === "bundle" ? { type: "link", bundle: rest } : { type: "link", id: rest }
    const go = (n = 0) => { if (to.win.isDestroyed()) return; if (to.ready) to.win.webContents.send("vaultite", msg); else if (n < 150) setTimeout(() => go(n + 1), 200) }
    go()
  }
  if (w.win.isMinimized()) w.win.restore()
  w.win.focus()
}
