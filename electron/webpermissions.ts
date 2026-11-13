import { app, dialog, shell, systemPreferences, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { otherAppScheme } from "../core/opening.ts"
import fs from "node:fs"
import path from "node:path"
import { hostOfUrl, siteOf } from "./webwire.ts"
import { MAC, type Page, pageOf } from "./webbase.ts"

export const FREE = new Set(["clipboard-sanitized-write", "notifications", "fullscreen", "pointerLock", "keyboardLock", "speaker-selection",
  "storage-access", "top-level-storage-access"])
const ASKED: Record<string, string> = {
  camera: "use your camera", microphone: "use your microphone", geolocation: "know your location", "clipboard-read": "see what you copy",
  midi: "use your MIDI devices", midiSysex: "control your MIDI devices", "idle-detection": "know when you're away from the computer",
  "window-management": "see your screens and place windows on them", fileSystem: "edit files on this Mac", openExternal: "open another app",
}
type Answers = Record<string, Record<string, Record<string, boolean>>> // profile -> site -> what -> allowed
let answers: Answers | null = null
const answersFile = () => path.join(app.getPath("userData"), "web-permissions.json")
export function loadAnswers(): Answers {
  if (answers) return answers
  try { const j = JSON.parse(fs.readFileSync(answersFile(), "utf8")); answers = j && typeof j === "object" ? j : {} } catch { answers = {} }
  return answers!
}
export const permissionOf = (profile: string, site: string, kind: string): boolean | undefined => loadAnswers()[profile]?.[site]?.[kind]
export function answer(profile: string, site: string, kind: string, yes: boolean | null) {
  const all = loadAnswers(), of = (all[profile] ??= {}), at = (of[site] ??= {})
  if (yes === null) delete at[kind]; else at[kind] = yes
  if (!Object.keys(at).length) delete of[site]
  try { fs.writeFileSync(answersFile(), JSON.stringify(all)) } catch { /* asked again next time */ }
}
const asking = new Map<string, Promise<boolean>>()

/** The camera and microphone also need macOS's yes. */
export async function askPermission(profile: string, wc: WebContents, perm: string, details: { mediaTypes?: string[]; requestingUrl?: string; externalURL?: string }) {
  if (FREE.has(perm)) return true
  // (another app by its scheme, said in the question: a yes to zoommtg: is none to ms-msdt:; a frame's link to another
  // app comes only here, never past otherApp)
  const scheme = perm === "openExternal" ? otherAppScheme(details.externalURL ?? "") : ""
  if (perm === "openExternal" && !scheme) return false
  // (media with no camera or microphone is sharing the screen: its picker asks, browser/screenshare.ts)
  if (perm === "media" && !details.mediaTypes?.length) return true
  const kinds = perm === "media" ? [...new Set((details.mediaTypes ?? []).map((t) => (t === "video" ? "camera" : "microphone")))] : [scheme ? `openExternal:${scheme}` : perm]
  if (!kinds.length || kinds.some((k) => !ASKED[k.split(":")[0]])) return false
  const site = siteOf(hostOfUrl(details.requestingUrl || wc.getURL()))
  if (!site) return false
  const known = kinds.map((k) => permissionOf(profile, site, k))
  if (known.some((k) => k === false)) return false
  let yes = known.every((k) => k === true)
  if (!yes) {
    const key = `${profile} ${site} ${kinds.join(",")}`
    let q = asking.get(key)
    if (!q) {
      const win = pageOf(wc)?.win ?? AppWindow.fromWebContents(wc) ?? undefined
      const what = kinds.map((k) => (scheme ? `open ${scheme}: links in another app` : ASKED[k])).join(" and ").replace(/ and use your /, " and ")
      const box = { type: "question" as const, message: `${site} wants to ${what}`, buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1,
        checkboxLabel: "Remember for this site", checkboxChecked: true }
      q = (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box)).then((r) => {
        const allow = r.response === 0
        if (r.checkboxChecked && (allow || !scheme)) for (const k of kinds) answer(profile, site, k, allow)
        return allow
      }).finally(() => asking.delete(key))
      asking.set(key, q)
    }
    yes = await q
  }
  if (yes && MAC && perm === "media") {
    for (const k of kinds) if (!(await systemPreferences.askForMediaAccess(k === "camera" ? "camera" : "microphone"))) return false
  }
  return yes
}

export async function otherApp(p: Page, to: string) {
  const scheme = otherAppScheme(to)
  if (!scheme) return
  if (scheme === "mailto") return void shell.openExternal(to)
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await askPermission(p.profile, wc, "openExternal", { requestingUrl: wc.getURL(), externalURL: to }).catch(() => false)) await shell.openExternal(to).catch(console.error)
}
