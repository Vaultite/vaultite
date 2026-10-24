// Managed extensions: the ones this Mac forces on, as Chrome's force-install policy. Only a file the Mac's owner writes
// from the terminal names them, never a vault setting (plugins rule 4), so the app can't turn them off or remove them.
import { app } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import * as store from "./extstore.ts"

/** Where the policy is read, both at once: the machine's, for every Vaultite app (made as an administrator, so changing
 *  it takes one too), and this app's own in its userData. `{ "extensions": ["<an unpacked extension's folder>", "<a Web Store id>"] }` */
export const policyFiles = () => [
  process.platform === "darwin" ? "/Library/Application Support/Vaultite/managed-extensions.json"
    : process.platform === "win32" ? path.join(process.env.ProgramData ?? "C:\\ProgramData", "Vaultite", "managed-extensions.json")
    : "/etc/vaultite/managed-extensions.json",
  path.join(app.getPath("userData"), "managed-extensions.json"),
]

/** What the policy names that couldn't be added, said in the Extensions view. */
export let problems: string[] = []

function wanted(said: string[]) {
  const out: string[] = []
  for (const f of policyFiles()) {
    let j: unknown
    try { j = JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") said.push(`${f} isn't readable JSON`)
      continue
    }
    const list = (j as { extensions?: unknown })?.extensions
    if (!Array.isArray(list)) { said.push(`${f} has no "extensions" list`); continue }
    for (const x of list) {
      if (typeof x === "string" && (store.ID.test(x) || path.isAbsolute(x))) out.push(store.ID.test(x) ? x : path.resolve(x))
      else said.push(`${f}: ${JSON.stringify(x)} is neither an extension's folder (a full path) nor a Web Store id`)
    }
  }
  return [...new Set(out)]
}

/** A folder's files as they are now (names, sizes, times), so a rebuilt extension is copied again. */
function signature(dir: string) {
  const h = crypto.createHash("sha256")
  let n = 0
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === ".git" || e.name === "node_modules") continue
      if (++n > 20_000) throw new Error("too many files for an extension")
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else { const st = fs.statSync(f); h.update(`${path.relative(dir, f)}\0${st.size}\0${st.mtimeMs}\n`) }
    }
  }
  walk(dir)
  return h.digest("hex")
}

/** Install or update what the policy names and mark it managed; what left the policy becomes an ordinary one. Folders
 *  come first, before anything waits, so a launch's sessions load them. Answers the extensions to (re)load. */
export async function applyPolicy(): Promise<store.Installed[]> {
  const said: string[] = [], load: store.Installed[] = [], keep = new Set<string>()
  const wants = wanted(said)
  const mark = (x: store.Installed, managed: store.Installed["managed"]) => {
    if (!x.on && !load.includes(x)) load.push(x)
    x.on = true
    x.managed = managed
    keep.add(x.id)
  }
  for (const dir of wants.filter((w) => !store.ID.test(w))) {
    let had: store.Installed | undefined
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^﻿/, "")) as store.Manifest
      had = store.get(store.idOfFolder(dir, m))
      const sig = signature(dir)
      const x = had?.managed?.sig === sig ? had : store.fromFolder(dir)
      if (x !== had) load.push(x)
      mark(x, { source: dir, sig })
    } catch (e) {
      // (a folder gone or broken: the copy it had stays, still forced on)
      had ??= store.installed().find((x) => x.managed?.source === dir)
      if (had) mark(had, had.managed)
      const why = !fs.existsSync(dir) ? "the folder isn't there" : !fs.existsSync(path.join(dir, "manifest.json")) ? "the folder has no manifest.json" : "its files couldn't be read"
      said.push(`${dir}: ${why}${had ? " (the copy from before stays on)" : ""}`)
      console.error(`vaultite: couldn't add the managed extension ${dir}:`, e)
    }
  }
  for (const id of wants.filter((w) => store.ID.test(w))) {
    try {
      let x = store.get(id)
      if (!x) { x = await store.fromStore(id); load.push(x) }
      mark(x, { source: "store" })
    } catch (e) {
      said.push(`${id}: ${e instanceof store.NotOffered ? e.message : "the Chrome Web Store couldn't be reached"}`)
      console.error(`vaultite: couldn't add the managed extension ${id}:`, e)
    }
  }
  for (const x of store.installed()) if (x.managed && !keep.has(x.id)) delete x.managed
  store.save()
  problems = said
  return load
}

/** `fn` when a policy file changes (looked at every few seconds: one may not exist yet). */
export function watchPolicy(fn: () => void) {
  for (const f of policyFiles()) fs.watchFile(f, { interval: 4000, persistent: false }, (now, was) => { if (now.mtimeMs !== was.mtimeMs || now.size !== was.size) fn() })
}
