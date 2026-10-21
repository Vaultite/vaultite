// Pin the plugins the app's bundles install to a commit and their files' hash (tags move): re-run on a release of one.
// node tools/pin_bundles.ts [--check]   (--check: say which pins aren't the newest, change nothing)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { APP_BUNDLES } from "../core/bundles.ts"
import { git, parseSource, stage, tagsOf } from "../core/installs.ts"
import { MOVED } from "../core/migrations.ts"
import { digestOf } from "../core/vaultplugins.ts"

export type Pin = { tag: string | null; commit: string; hash: string }

/** A source at `tag` (its newest version tag when null): the commit it names now and the hash of its files as
 *  installing them would make them (core/installs.ts stage, digestOf). */
export async function pinOf(source: string, tag: string | null): Promise<Pin> {
  const src = parseSource(source)
  if (!src.url) throw new Error(`${source}: not a repository`)
  const at = tag ?? (await tagsOf(src.url, src.dir))[0] ?? null
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-pin-"))
  try {
    const clone = path.join(tmp, "clone")
    await git(["-c", "core.symlinks=false", "clone", "--quiet", "--depth", "1", "--no-tags", "--single-branch", ...(at ? ["--branch", at] : []), src.url, clone])
    const commit = (await git(["rev-parse", "HEAD"], clone)).trim()
    const files = path.join(tmp, "stage")
    stage(src.dir ? path.join(clone, src.dir) : clone, files)
    return { tag: at, commit, hash: digestOf(files).content }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** Each of a folder of bundles' installs pinned by `pin` (a plugin moved out of the app that one turns on, named too). */
export async function pinBundles(dir: string, pin: (source: string, tag: string | null) => Promise<Pin>, check = false) {
  const stale: string[] = []
  for (const id of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, id, "plugins.json")
    if (!fs.existsSync(file)) continue
    const pj = JSON.parse(fs.readFileSync(file, "utf8"))
    const install: Record<string, Record<string, unknown>> = { ...pj.install }
    for (const p of pj.enabled ?? []) if (MOVED[p] && !install[p]) install[p] = { name: p.charAt(0).toUpperCase() + p.slice(1), source: MOVED[p] }
    for (const [p, x] of Object.entries(install)) {
      const got = await pin(String(x.source), null)
      if (got.commit !== x.commit || got.hash !== x.hash) stale.push(`bundles/${id}: ${p} ${x.tag ?? "(none)"} -> ${got.tag} (${got.commit.slice(0, 7)})`)
      install[p] = { name: x.name ?? p, source: x.source, ...(got.tag ? { tag: got.tag } : {}), commit: got.commit, hash: got.hash }
    }
    if (!check && Object.keys(install).length) fs.writeFileSync(file, JSON.stringify({ ...pj, install }, null, 2) + "\n")
  }
  return stale
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check")
  const stale = await pinBundles(APP_BUNDLES, pinOf, check)
  console.log(stale.length ? `${check ? "Not pinned to their newest" : "Pinned"}:\n${stale.join("\n")}` : "Every install is pinned to its newest version.")
  process.exit(check && stale.length ? 1 : 0)
}
