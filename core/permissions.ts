// macOS's privacy permissions the desktop app uses (Settings > Permissions, `vau permissions`), and where System Settings
// has each; no Node. electron/permissions.ts reads their state, core/coreops/permissions.ts adds the vault's.

/** Allowed, not allowed, never asked (macOS asks on first use), or unknown: macOS has no way to tell without asking. */
export type PermissionState = "allowed" | "denied" | "not-asked" | "unknown"
/** What the row's button does: ask macOS (its own prompt), read a folder (asks the first time), open System Settings. */
export type PermissionAction = "ask" | "check" | "settings"

export type PermissionDef = { id: string; name: string; use: string
  /** System Settings' pane, after `com.apple.preference.security?`. */
  pane: string }
export type Permission = PermissionDef & { state: PermissionState; action: PermissionAction }

/** How the running app is signed: with Developer ID or Apple Development macOS keeps its permissions across updates;
 *  ad hoc, each build is a new app to it. `source`: run from a checkout, on Electron's own signature. */
export type Signing = { kind: "developer-id" | "development" | "adhoc" | "unsigned" | "source" | "unknown"; authority?: string; team?: string; id?: string }

/** Whether a process can read a folder now: null when it can't be told (no terminal keeper, one too old to ask). */
export type Access = { ok: boolean | null; why?: string }

/** A folder read's answer: "" read, else the error's code. */
export const accessOf = (code: string): Access => !code ? { ok: true }
  : { ok: false, why: code === "EPERM" || code === "EACCES" ? "macOS didn't allow it" : code === "ENOENT" ? "the folder isn't there" : `it couldn't be read (${code})` }

/** What `app.permissions` answers. `mac`: null outside the desktop app on a Mac. */
export type PermissionReport = {
  vault: { path: string; app: Access; terminals: Access }
  mac: { signing: Signing; permissions: Permission[] } | null
}

// Programs in the app's terminals ask as Vaultite (macOS gives them what it gives the app), so their needs are here too.
export const PERMISSIONS: PermissionDef[] = [
  { id: "microphone", name: "Microphone", use: "The audio recorder, and web pages you let use it", pane: "Privacy_Microphone" },
  { id: "camera", name: "Camera", use: "Web pages you let use it", pane: "Privacy_Camera" },
  { id: "location", name: "Location", use: "Web pages you let know where you are", pane: "Privacy_LocationServices" },
  { id: "accessibility", name: "Accessibility", use: "App windows in tabs, and agents in terminals that use the Mac", pane: "Privacy_Accessibility" },
  { id: "screen", name: "Screen recording", use: "Agents in terminals that look at the screen", pane: "Privacy_ScreenCapture" },
  { id: "input", name: "Input monitoring", use: "Agents in terminals that watch keys typed in other apps", pane: "Privacy_ListenEvent" },
  { id: "automation", name: "Automation", use: "Scripts in terminals that control other apps", pane: "Privacy_Automation" },
  { id: "desktop", name: "Desktop folder", use: "Terminals working there", pane: "Privacy_FilesAndFolders" },
  { id: "documents", name: "Documents folder", use: "Terminals working there, and vaults kept there", pane: "Privacy_FilesAndFolders" },
  { id: "downloads", name: "Downloads folder", use: "The Browser's downloads, and terminals working there", pane: "Privacy_FilesAndFolders" },
  { id: "full-disk", name: "Full disk access", use: "Optional: plugins and terminals reading other apps' data, like Screen Time", pane: "Privacy_AllFiles" },
]
export const VAULT_PANE = "Privacy_FilesAndFolders"

export const paneUrl = (pane: string) => `x-apple.systempreferences:com.apple.preference.security?${pane}`

/** The signing `codesign -dv --verbose=2` prints (to stderr) for the running app. */
export function signingOf(out: string): Signing {
  const field = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(out)?.[1]?.trim()
  const authority = field("Authority"), team = field("TeamIdentifier"), id = field("Identifier")
  const of = { ...(authority ? { authority } : {}), ...(team && team !== "not set" ? { team } : {}), ...(id ? { id } : {}) }
  if (/^Signature=adhoc$/m.test(out) || /flags=0x\w*\(.*adhoc/.test(out)) return { kind: "adhoc", ...of }
  if (/code object is not signed/.test(out)) return { kind: "unsigned" }
  if (authority?.startsWith("Developer ID Application:")) return { kind: "developer-id", ...of }
  if (authority?.startsWith("Apple Development:")) return { kind: "development", ...of }
  return { kind: "unknown", ...of }
}

/** Whether macOS keeps this app's permissions across its updates. */
export const keepsPermissions = (s: Signing) => s.kind === "developer-id" || s.kind === "development"

/** The signing in a line: what it means for the permissions. */
export function signingText(s: Signing) {
  const who = s.authority?.replace(/^(Developer ID Application|Apple Development): /, "")
  switch (s.kind) {
    case "developer-id": return `Signed with Developer ID${who ? ` (${who})` : ""}: macOS keeps these permissions across updates`
    case "development": return `Signed for development${who ? ` (${who})` : ""}: macOS keeps these permissions across updates`
    case "adhoc": return "Signed ad hoc: macOS takes each update for a new app, and asks for these permissions again"
    case "unsigned": return "Not signed: macOS takes each build for a new app, and asks for these permissions again"
    case "source": return "Run from source, on Electron's signature: these permissions are Electron's, not the installed app's"
    default: return "Signed, by an identity macOS may not keep permissions for across updates"
  }
}

export const STATE_TEXT: Record<PermissionState, string> = { allowed: "Allowed", denied: "Not allowed", "not-asked": "Not asked yet", unknown: "Unknown" }
