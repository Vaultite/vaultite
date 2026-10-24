import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check, tmp } = $
  // ---------- Linux's vault watcher (core/treewatch.ts): folder by folder, new folders followed, skipped ones not watched ----------
  {
    const { watchTree } = await import("../../../core/treewatch.ts")
    const root = path.join(tmp, "watched")
    fs.mkdirSync(path.join(root, ".git"), { recursive: true })
    fs.mkdirSync(path.join(root, "Notes"), { recursive: true })
    const seen = new Set<string | null>()
    const w = watchTree(root, (rel) => rel.split("/").includes(".git"), (rel) => seen.add(rel))
    const settle = () => new Promise((r) => setTimeout(r, 150))
    const until = async (rel: string, tries = 40) => { for (let i = 0; i < tries && !seen.has(rel); i++) await settle(); return seen.has(rel) }
    // A Mac's watch (FSEvents) misses what's written before it has started, Linux's (inotify, which uses this) doesn't:
    // a folder's watch is live once a file written there is heard.
    let probes = 0
    const live = async (dir: string) => {
      for (let i = 0; i < 20; i++) {
        const rel = `${dir}/probe ${++probes}`
        fs.writeFileSync(path.join(root, rel), "")
        if (await until(rel, 2)) return
      }
    }
    await live("Notes")
    fs.writeFileSync(path.join(root, "Notes", "a.md"), "a")
    check("tree watcher: a file in a subfolder", await until("Notes/a.md"), [...seen])
    fs.mkdirSync(path.join(root, "Notes", "New"))
    await until("Notes/New")
    await live("Notes/New")
    fs.writeFileSync(path.join(root, "Notes", "New", "b.md"), "b")
    check("tree watcher: a folder made after it started is watched too", await until("Notes/New/b.md"), [...seen])
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "x")
    await settle(); await settle()
    check("tree watcher: a skipped folder isn't watched", ![...seen].some((r) => r?.startsWith(".git/")), [...seen])
    fs.renameSync(path.join(root, "Notes", "New"), path.join(root, "Moved"))
    await until("Moved")
    await live("Moved")
    fs.writeFileSync(path.join(root, "Moved", "c.md"), "c")
    check("tree watcher: a folder moved within it is followed", await until("Moved/c.md"), [...seen])
    fs.mkdirSync(path.join(root, "At once", "Deeper"), { recursive: true })
    fs.writeFileSync(path.join(root, "At once", "Deeper", "d.md"), "d")
    check("tree watcher: a file made with its new folders is told", await until("At once/Deeper/d.md"), [...seen])
    w.close()
  }
}
