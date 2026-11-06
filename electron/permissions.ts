// macOS's privacy permissions as the app has them now (core/permissions.ts lists them), read without making macOS ask;
// Location, Input monitoring and the drag helper are macpermissions.m (without it: unknown, and Allow opens Settings).
import { app, desktopCapturer, shell, systemPreferences } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PERMISSIONS, VAULT_PANE, actionOf, paneUrl, signingOf, type Permission, type PermissionDef, type PermissionState, type Signing } from "../core/permissions.ts"
import { macAddon, type MacAddon } from "./macaddons.ts"

const FOLDERS: Record<string, () => string> = {
  desktop: () => app.getPath("desktop"), documents: () => app.getPath("documents"), downloads: () => app.getPath("downloads"),
}
/** The folders read since launch (their Check): macOS answers the same until its settings change, which the app hears of
 *  only by reading again. */
const checked = new Map<string, PermissionState>()

// ---------- the addon: shipped built in the app (tools/build_helpers.ts), else built the first time into userData

let addon: MacAddon | null = null
let loading: Promise<MacAddon | null> | null = null
function native(): Promise<MacAddon | null> {
  if (addon) return Promise.resolve(addon)
  loading ??= macAddon("macpermissions", path.join(app.getPath("userData"), "bin")).then((a) => (addon = a)).catch((e) => { console.warn(`permissions: no native helper (${(e as Error).message})`); return null })
  return loading
}
const ask = (cmd: string, more: Record<string, unknown> = {}) => addon?.call({ cmd, ...more })

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
    case "location": case "input": return (ask(id)?.state as PermissionState | undefined) ?? "unknown"
    default: return checked.get(id) ?? "unknown"
  }
}

function permissionOf(d: PermissionDef): Permission {
  const state = stateOf(d.id), action = actionOf(d, state)
  return {
    ...d, state, action,
    ...(action === "settings" ? { fix: `In System Settings, switch on ${app.getName()}` } : {}),
    ...(d.id === "automation" ? { note: "Asked per app" } : {}),
  }
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
  await native()
  return { signing: await signing(), permissions: PERMISSIONS.map(permissionOf) }
}

// ---------- the drag helper: System Settings' pane, and beside it the app to drag into its list

/** The app's bundle (from a checkout, Electron's: the one macOS gives these permissions to then). */
const bundle = () => path.resolve(process.execPath, "../../..")
let watching: ReturnType<typeof setInterval> | null = null

/** Open the pane with the panel by it; the panel goes once the permission reads allowed (or it's closed, or Settings is). */
function drag(def: PermissionDef) {
  if (watching) clearInterval(watching)
  // (a script's copy shows nothing: its panel would sit over the user's own System Settings)
  if (process.env.VAULTITE_QUIET) return
  ask("show", { app: bundle(), name: app.getName(), hint: `Drag ${app.getName()} into the list` })
  const since = Date.now()
  watching = setInterval(() => {
    const open = ask("panel")?.open === true, granted = stateOf(def.id) === "allowed", late = Date.now() - since > 10 * 60_000
    if (open && (granted || late)) ask("hide", { why: granted ? "granted" : "timeout" })
    if (!open || granted || late) { clearInterval(watching!); watching = null }
  }, 1000)
}

/** Location's prompt, waited for (the user answers in their own time). */
async function locate(): Promise<PermissionState> {
  ask("ask-location")
  for (const t = Date.now(); Date.now() - t < 120_000; await new Promise((r) => setTimeout(r, 250))) {
    const s = stateOf("location")
    if (s !== "not-asked") return s
  }
  return "not-asked"
}

/** The row's button: macOS's own prompt where it has one, the drag helper where it has a list, a folder read (asked the
 *  first time), else its pane (after a no). */
export async function permissionAct(id: string) {
  if (id === "vault") return void await shell.openExternal(paneUrl(VAULT_PANE))
  const def = PERMISSIONS.find((d) => d.id === id)
  if (!def) throw new Error(`no permission '${id}'`)
  const helper = await native()
  const action = actionOf(def, stateOf(id))
  if (action === "none") return
  if (action === "check") return void checked.set(id, await readable(FOLDERS[id]()))
  if (action === "ask" && (id === "microphone" || id === "camera")) return void await systemPreferences.askForMediaAccess(id)
  if (action === "ask" && id === "location") {
    // (without the helper the app can't ask, and isn't in the list till it has: the pane is all there is)
    if (helper) return void await locate()
  }
  if (action === "drag" && !helper) {
    // (no panel: what puts the app in the list, macOS's prompt for Accessibility, a capture for Screen recording)
    if (id === "accessibility") return void systemPreferences.isTrustedAccessibilityClient(true)
    if (id === "screen") await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }).catch(() => {})
  }
  await shell.openExternal(paneUrl(def.pane))
  if (action === "drag" && helper) drag(def)
}
