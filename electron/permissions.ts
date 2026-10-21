// macOS's privacy permissions as the app has them now (core/permissions.ts lists them): read only through calls that
// never make macOS ask, so opening Settings > Permissions pops nothing up. A folder is read only when its Check is pressed.
import { app, shell, systemPreferences } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PERMISSIONS, VAULT_PANE, paneUrl, signingOf, type Permission, type PermissionAction, type PermissionState, type Signing } from "../core/permissions.ts"

const FOLDERS: Record<string, () => string> = {
  desktop: () => app.getPath("desktop"), documents: () => app.getPath("documents"), downloads: () => app.getPath("downloads"),
}
/** The folders read since launch (their Check): macOS answers the same until its settings change, which the app hears of
 *  only by reading again. */
const checked = new Map<string, PermissionState>()
/** Accessibility asked once since launch: macOS shows its prompt only once a launch, so the next press opens the pane. */
let askedTrust = false

/** EPERM is macOS saying no; anything else (no such folder) isn't about permission. */
const refused = (e: unknown): PermissionState => (["EPERM", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "") ? "denied" : "unknown")
/** Read off the main thread: while macOS asks, the read waits for the answer, and the windows mustn't. */
const readable = (dir: string): Promise<PermissionState> => fs.promises.readdir(dir).then(() => "allowed" as const, refused)

const media = (s: string): PermissionState =>
  s === "granted" ? "allowed" : s === "denied" || s === "restricted" ? "denied" : s === "not-determined" ? "not-asked" : "unknown"

function stateOf(id: string): PermissionState {
  switch (id) {
    case "microphone": case "camera": return media(systemPreferences.getMediaAccessStatus(id))
    // (macOS tells only whether it's allowed: never asked reads as not allowed)
    case "screen": return systemPreferences.getMediaAccessStatus("screen") === "granted" ? "allowed" : "denied"
    case "accessibility": return systemPreferences.isTrustedAccessibilityClient(false) ? "allowed" : "denied"
    // (a folder only full disk access reaches: reading it never asks, it fails)
    case "full-disk": try { fs.readdirSync(path.join(os.homedir(), "Library", "Application Support", "com.apple.TCC")); return "allowed" } catch (e) { return refused(e) }
    default: return checked.get(id) ?? "unknown"
  }
}

function actionOf(id: string, state: PermissionState): PermissionAction {
  if (state === "not-asked" || (id === "accessibility" && state === "denied" && !askedTrust)) return "ask"
  if (FOLDERS[id] && state === "unknown") return "check"
  return "settings"
}

let signed: Promise<Signing> | null = null
/** The running app's own signature (its process, not the bundle on disk, which an update may have replaced). */
function signing(): Promise<Signing> {
  if (!app.isPackaged) return Promise.resolve({ kind: "source" })
  signed ??= new Promise((ok) => execFile("codesign", ["-dv", "--verbose=2", String(process.pid)], { timeout: 10_000 }, (_e, out, err) =>
    ok(signingOf(`${out}${err}`))))
  return signed
}

export async function macPermissions(): Promise<{ signing: Signing; permissions: Permission[] }> {
  const permissions = PERMISSIONS.map((d) => { const state = stateOf(d.id); return { ...d, state, action: actionOf(d.id, state) } })
  return { signing: await signing(), permissions }
}

/** The row's button: macOS's own prompt where it has one, a folder read (asked the first time), else its pane. */
export async function permissionAct(id: string) {
  if (id === "vault") return void await shell.openExternal(paneUrl(VAULT_PANE))
  const def = PERMISSIONS.find((d) => d.id === id)
  if (!def) throw new Error(`no permission '${id}'`)
  const action = actionOf(id, stateOf(id))
  if (action === "ask" && (id === "microphone" || id === "camera")) return void await systemPreferences.askForMediaAccess(id)
  if (action === "ask" && id === "accessibility") { askedTrust = true; return void systemPreferences.isTrustedAccessibilityClient(true) }
  if (action === "check") return void checked.set(id, await readable(FOLDERS[id]()))
  await shell.openExternal(paneUrl(def.pane))
}
