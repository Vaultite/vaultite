// An extension's settings from another browser's profile: chrome.storage's local and sync areas (options, sign-ins,
// licenses), read and written by a stand-in with its key (electron/browser/CLAUDE.md).
import { app, session, WebContentsView, type Session } from "electron"
import { AREAS, manifestOf, storageShim, type Source } from "./extstore.ts"
import { z } from "zod"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const AREA = z.record(z.string(), z.json())
export type Settings = { local: z.infer<typeof AREA>; sync: z.infer<typeof AREA> }

const PAGE = "settings.html"

/** The stand-in: `dir`'s key (so its id, and its storage, are the extension's), storage, and an empty page. Nothing of
 *  the extension's own runs: its worker would act on what it found (open tabs, sign in). */
function standIn(dir: string, tmp: string) {
  const key = manifestOf(dir).key
  if (typeof key !== "string") throw new Error("it has no key to read its settings by")
  const to = path.join(tmp, "stand-in")
  fs.mkdirSync(to, { recursive: true })
  fs.writeFileSync(path.join(to, "manifest.json"), JSON.stringify({ name: "Settings", version: "1", manifest_version: 3, key, permissions: ["storage", "unlimitedStorage"] }))
  fs.writeFileSync(path.join(to, PAGE), "<!doctype html><title>Settings</title>")
  return to
}

/** `code` run in the stand-in's page in `s` (where the extension itself isn't loaded). */
async function inStandIn<S extends z.ZodType>(s: Session, dir: string, id: string, code: string, answer: S): Promise<z.output<S>> {
  const ext = await s.extensions.loadExtension(dir)
  if (ext.id !== id) { s.extensions.removeExtension(ext.id); throw new Error("its key doesn't give its id") }
  const view = new WebContentsView({ webPreferences: { session: s, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await view.webContents.loadURL(`chrome-extension://${id}/${PAGE}`)
    return answer.parse(await view.webContents.executeJavaScript(code))
  } finally {
    view.webContents.close()
    s.extensions.removeExtension(id)
  }
}

/** `id`'s settings in a browser's profile (a copy read: that browser may be running and holds them locked). */
export async function read(from: Source, id: string, dir: string): Promise<Settings> {
  const tmp = fs.mkdtempSync(path.join(app.getPath("temp"), "vaultite-ext-settings-"))
  try {
    const reader = standIn(dir, tmp)
    const area = async (name: (typeof AREAS)[number]) => {
      const src = path.join(from.dir, name, id)
      if (!fs.existsSync(src)) return {}
      // (each area as a session's own local one, in a session of its own)
      const at = path.join(tmp, crypto.randomBytes(6).toString("hex"))
      fs.cpSync(src, path.join(at, "Local Extension Settings", id), { recursive: true, filter: (f) => path.basename(f) !== "LOCK" })
      return inStandIn(session.fromPath(at), reader, id, "chrome.storage.local.get(null)", AREA)
    }
    return { local: await area(AREAS[0]), sync: await area(AREAS[1]) }
  } finally { fs.rm(tmp, { recursive: true, force: true }, () => {}) }
}

/** `settings` as `id`'s in `s`, replacing what it had there. The extension mustn't be loaded in `s`. */
export async function write(s: Session, id: string, dir: string, settings: Settings) {
  const tmp = fs.mkdtempSync(path.join(app.getPath("temp"), "vaultite-ext-settings-"))
  try {
    // Through the storage shim, as the extension reads them (a session's preload has put it there, or this does).
    await inStandIn(s, standIn(dir, tmp), id, `(async () => {
      (${String(storageShim())})()
      const st = chrome.storage, { local, sync } = ${JSON.stringify(settings)}
      await st.local.clear(); await st.sync.clear()
      await st.local.set(local); await st.sync.set(sync)
    })()`, z.unknown())
  } finally { fs.rm(tmp, { recursive: true, force: true }, () => {}) }
}
