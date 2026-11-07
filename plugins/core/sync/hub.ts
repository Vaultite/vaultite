// The hub's jobs: hourly git snapshots of the text and settings, and the one-way copy (the iCloud copy) that catches what
// anyone writes into it as a change, never writing over it unseen.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../../../core/plugins.ts"
import { norm, type Replica, sha, unsynced } from "./engine.ts"
import type { DiskFolder, DiskStore } from "./disk.ts"

// ---------- git snapshots: text and settings only (media is in the copy)

const TEXT_EXT = ["md", "markdown", "txt", "json", "jsonl", "canvas", "base", "csv", "tsv", "yaml", "yml", "toml", "css", "js", "mjs", "ts",
  "tsx", "html", "htm", "svg", "excalidraw", "ics", "org", "tex", "bib", "py", "sh", "swift", "xml", "vtt", "srt"]
const run = (args: string[], cwd?: string) => new Promise<{ ok: boolean; out: string; err: string }>((done) =>
  execFile(process.platform === "win32" ? "git" : "nice", process.platform === "win32" ? args : ["-n", "10", "git", ...args],
    { cwd, env: { ...gitEnv(), GIT_AUTHOR_NAME: "Vaultite", GIT_AUTHOR_EMAIL: "sync@vaultite.local", GIT_COMMITTER_NAME: "Vaultite", GIT_COMMITTER_EMAIL: "sync@vaultite.local" },
      timeout: 600_000, maxBuffer: 64 << 20 }, (e, out, err) => done({ ok: !e, out: String(out), err: String(err || e?.message || "") })))

/** Commit the folder's text and settings into the repo `gitDir` (made the first time, outside the vault), if changed. */
export async function snapshot(gitDir: string, work: string, label = new Date().toISOString().slice(0, 16).replace("T", " ")) {
  const g = ["--git-dir", gitDir, "--work-tree", work]
  if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
    fs.mkdirSync(gitDir, { recursive: true })
    const r = await run(["init", "--bare", "-q", gitDir])
    if (!r.ok) throw new Error(`git init: ${r.err}`)
    await run([...g, "config", "core.quotepath", "false"])
    await run([...g, "config", "core.precomposeunicode", "true"])
  }
  fs.mkdirSync(path.join(gitDir, "info"), { recursive: true })
  fs.writeFileSync(path.join(gitDir, "info", "exclude"), ["*", "!*/", ...TEXT_EXT.map((e) => `!*.${e}`), ".git/", "node_modules/", "*.sync-part", ""].join("\n"))
  const add = await run([...g, "add", "-A", "."], work)
  if (!add.ok) throw new Error(`git add: ${add.err.split("\n")[0]}`)
  const same = await run([...g, "diff", "--cached", "--quiet"], work)
  if (same.ok) return { committed: false }
  const c = await run([...g, "commit", "-q", "-m", `Snapshot ${label}`], work)
  if (!c.ok) throw new Error(`git commit: ${c.err.split("\n")[0]}`)
  const files = (await run([...g, "diff", "--stat", "HEAD~1", "HEAD"], work)).out.trim().split("\n").pop() ?? ""
  return { committed: true, files }
}

// ---------- the one-way copy

type Copied = { hash: string; node: string; size: number; mtime: number }
export type CopyNotice = { path: string; what: "imported" | "restored" }

/** Mirror the replica's files into `target`; what was written there by anyone else comes back as a change from `from`. */
export class Mirror {
  readonly target: string
  readonly from: string
  copied: Map<string, Copied>
  constructor(target: string, from: string, saved?: [string, Copied][]) { this.target = target; this.from = from; this.copied = new Map(saved ?? []) }
  private abs(p: string) { return path.join(this.target, ...p.split("/")) }
  private stat(p: string) { try { const st = fs.statSync(this.abs(p)); return st.isFile() ? { size: st.size, mtime: Math.round(st.mtimeMs) } : null } catch { return null } }

  /** What changed in the copy that this didn't write: imported (edits and new files) or put back (deletes). */
  check(r: Replica): CopyNotice[] {
    const out: CopyNotice[] = []
    for (const [p, c] of this.copied) {
      const st = this.stat(p)
      if (!st) { this.copied.delete(p); out.push({ path: p, what: "restored" }); continue }
      if (st.size === c.size && st.mtime === c.mtime) continue
      let bytes: Uint8Array
      try { bytes = new Uint8Array(fs.readFileSync(this.abs(p))) } catch { continue }
      const h = sha(bytes)
      if (h === c.hash) { this.copied.set(p, { ...c, ...st }); continue }
      r.foreign(p, bytes, c.node, this.from)
      this.copied.set(p, { hash: h, node: c.node, ...st })
      out.push({ path: p, what: "imported" })
    }
    // (files there that nobody copied: new ones written straight into it)
    const snap = r.snapshot()
    const walk = (dir: string) => {
      let names: fs.Dirent[]
      try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const d of names) {
        const abs = path.join(dir, d.name), rel = norm(path.relative(this.target, abs).split(path.sep).join("/"))
        if (unsynced(rel)) continue
        if (d.isDirectory()) walk(abs)
        else if (d.isFile() && !this.copied.has(rel)) {
          let bytes: Uint8Array
          try { bytes = new Uint8Array(fs.readFileSync(abs)) } catch { continue }
          const st = this.stat(rel)!, live = snap.get(rel)
          if (live === sha(bytes)) { this.copied.set(rel, { hash: live, node: "", ...st }); continue }
          const n = r.foreign(rel, bytes, null, this.from)
          this.copied.set(rel, { hash: n.blob!, node: n.id, ...st })
          out.push({ path: rel, what: "imported" })
        }
      }
    }
    walk(this.target)
    return out
  }

  /** Write the replica's files into the copy where they differ, and remove those it no longer has. */
  update(r: Replica, folder: DiskFolder, store: DiskStore): number {
    let n = 0
    const live = new Map<string, { blob: string; node: string }>()
    for (const [file] of r.byFile) { const h = r.head(file); if (h?.blob) live.set(h.path, { blob: h.blob, node: h.id }) }
    for (const [p, v] of live) {
      const c = this.copied.get(p)
      if (c && c.hash === v.blob) { if (c.node !== v.node) this.copied.set(p, { ...c, node: v.node }); continue }
      const abs = this.abs(p), tmp = `${abs}.sync-part`
      const src = folder.hash(p) === v.blob ? folder.abs(p) : store.hasBlob(v.blob) ? store.blobPath(v.blob) : null
      if (!src) continue
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.copyFileSync(src, tmp, fs.constants.COPYFILE_FICLONE)
        fs.renameSync(tmp, abs)
      } catch { fs.rmSync(tmp, { force: true }); continue }
      const st = this.stat(p)!
      this.copied.set(p, { hash: v.blob, node: v.node, ...st }); n++
    }
    for (const p of [...this.copied.keys()]) if (!live.has(p)) { fs.rmSync(this.abs(p), { force: true }); this.copied.delete(p); n++ }
    return n
  }
  saved() { return [...this.copied] }
}
