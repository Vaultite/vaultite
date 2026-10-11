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
    const until = async (rel: string) => { for (let i = 0; i < 40 && !seen.has(rel); i++) await settle(); return seen.has(rel) }
    await settle(); await settle() // (a Mac's watches take a moment to start: Linux is the one that uses this)
    fs.writeFileSync(path.join(root, "Notes", "a.md"), "a")
    check("tree watcher: a file in a subfolder", await until("Notes/a.md"), [...seen])
    fs.mkdirSync(path.join(root, "Notes", "New"))
    await until("Notes/New")
    await settle()
    fs.writeFileSync(path.join(root, "Notes", "New", "b.md"), "b")
    check("tree watcher: a folder made after it started is watched too", await until("Notes/New/b.md"), [...seen])
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "x")
    await settle(); await settle()
    check("tree watcher: a skipped folder isn't watched", ![...seen].some((r) => r?.startsWith(".git/")), [...seen])
    fs.renameSync(path.join(root, "Notes", "New"), path.join(root, "Moved"))
    await until("Moved")
    await settle()
    fs.writeFileSync(path.join(root, "Moved", "c.md"), "c")
    check("tree watcher: a folder moved within it is followed", await until("Moved/c.md"), [...seen])
    fs.mkdirSync(path.join(root, "At once", "Deeper"), { recursive: true })
    fs.writeFileSync(path.join(root, "At once", "Deeper", "d.md"), "d")
    check("tree watcher: a file made with its new folders is told", await until("At once/Deeper/d.md"), [...seen])
    w.close()
  }
}
