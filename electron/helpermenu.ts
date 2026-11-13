import { app, Menu, nativeImage, Notification, screen, Tray, type BrowserWindow } from "electron"
import path from "node:path"
import type { Presence } from "../core/desktop/knocks.ts"
import { countText } from "../core/desktop/walks.ts"
import { badgeOf, cursorBitmap, dottedBitmap, type HelperJob, jobNote, menuNow, type Point, TINT_RGB } from "./helperlogic.ts"
import { openFromMenu, presencesNow } from "./knockhelper.ts"
import { panelMenuClosed } from "./overlay.ts"
import { macAddon } from "./macaddons.ts"
import { icon } from "./menu.ts"
import { endWalk, startWalk, walkOn, walkScene } from "./walk.ts"
import { asked, QUIET } from "./helperask.ts"
import { host, op, prefs } from "./helperbase.ts"
import { live } from "./helperlive.ts"

let up: { refresh: () => Promise<void>; openChat: (name: string, at: Point) => void }
export const menuHost = (h: typeof up) => { up = h }
const refresh = () => up.refresh()
const openChat = (name: string, at: Point) => up.openChat(name, at)
let tray: Tray | null = null
/** The tray's icon, and with its badge's dot (made once it's first needed). */
let plainIcon: Electron.NativeImage | null = null, dottedIcon: Electron.NativeImage | null = null
export function panelMenu(_name: string, at: { window: BrowserWindow; x: number; y: number }) {
  const mode = (m: string) => () => void op("settings.set", { name: "plugin/companion", values: { mode: m } })
  Menu.buildFromTemplate([
    { label: "Quiet", type: "radio", checked: live.state.mode === "quiet", click: mode("quiet") },
    { label: "Pair", type: "radio", checked: live.state.mode === "pair", click: mode("pair") },
  ]).popup({ ...at, callback: panelMenuClosed })
}
/** The menu bar's menu: the way in, what waits on the user, how many work, the companion's few controls, Settings. The
 *  island has the rest at a glance, the Agents view all of it. */
export function menuItems(): Electron.MenuItemConstructorOptions[] {
  const h = host!, home = h.home()
  const setting = (name: string, values: Record<string, unknown>) => () => void op("settings.set", { name, values }).then(refresh)
  const name = live.state.name, unread = unreadSays().length, mode = live.state.mode
  const m = menuNow({ presences: presencesNow(), decisions, jobs: live.state.jobs ?? [], now: Date.now() })
  const muted = mutedUntil > Date.now()
  const needs: Electron.MenuItemConstructorOptions[] = m.needs.map((r) => ({ label: r.label, sublabel: r.sub, icon: cursorIcon(r.tint), enabled: !!home,
    click: () => { const j = r.job ? live.state.jobs?.find((x) => x.id === r.job) : undefined; if (r.presence) openFromMenu(r.presence); else if (j) void openJob(j); else void openIn("view:inbox") } }))
  return [
    { label: home ? `Open ${home.name}` : `Open ${app.getName()}`, click: () => h.openHome() },
    ...(m.needCount ? [{ type: "separator" as const }, { label: `Needs you (${m.needCount})`, type: "header" as const }, ...needs,
      { label: "All in inbox", icon: icon("inbox"), enabled: !!home, click: () => void openIn("view:inbox") }] : []),
    ...(m.count ? [{ type: "separator" as const }, { label: m.count, icon: icon("mouse-pointer-2"), enabled: !!home, click: () => void openIn("view:agents") }] : []),
    { type: "separator" },
    { label: name || "Companion", type: "header", sublabel: prefs.talk.length ? `Hold ${keysSaid(prefs.talk)} to talk` : undefined },
    // (what it said that wasn't seen: the menu bar icon's badge)
    { label: unread ? `What it said (${unread} new)` : "What it said", icon: icon("message-circle"), enabled: !!name && live.state.said.some((n) => n.agent === name && n.kind === "say"),
      click: () => openChat(name, screen.getCursorScreenPoint()) },
    { label: "Quiet", type: "checkbox", checked: mode === "quiet", enabled: !!home, click: setting("plugin/companion", { mode: "quiet" }) },
    { label: "Pair", type: "checkbox", checked: mode === "pair", enabled: !!home, click: setting("plugin/companion", { mode: "pair" }) },
    // (the inbox's hold, on every machine: nothing comes up by the notch, is said or notified till then)
    { label: muted ? `Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Mute for an hour", icon: icon("bell-off"), type: "checkbox", checked: muted, enabled: !!home,
      click: () => void op("inbox.hold", muted ? { until: "off" } : { until: "1h", label: "Muted from the menu bar" }).then((r) => { mutedUntil = heldUntil(r.hold) }, () => {}) },
    { type: "separator" },
    // (a QA walk: started and ended here too, as by voice)
    walkOn() ? { label: "End the QA walk", icon: icon("footprints"), sublabel: walkScene()?.state === "sending" ? "Sending…" : `${countText(walkScene()?.count ?? 0)}: sent as a job per project`, enabled: walkScene()?.state !== "sending", click: () => void endWalk(true) }
      : { label: "Start a QA walk", icon: icon("footprints"), enabled: !!home && !!name, click: () => void startWalk() },
    { type: "separator" },
    { label: "Settings…", icon: icon("settings"), accelerator: "Command+,", enabled: !!home, click: () => void openIn("settings") },
    { label: `Quit ${app.getName()}`, accelerator: "Command+Q", click: () => h.quit() },
  ]
}
/** The decisions an agent waits on (inbox.decisions' blocking ones), read with the settings. */
let decisions: { question: string; from: string | null; created: string | null }[] = []
/** Till when the user muted (the inbox's hold), in ms; 0: not. */
export let mutedUntil = 0
const heldUntil = (h: unknown) => { const u = (h as { until?: unknown } | null)?.until; const t = typeof u === "string" ? Date.parse(u.replace(" ", "T")) : NaN; return Number.isFinite(t) ? t : 0 }
const cursors = new Map<string, Electron.NativeImage>()
/** An agent's cursor in its colour, as the island draws it (not a template: it keeps its colour). */
function cursorIcon(tint: string) {
  if (!cursors.has(tint)) {
    const img = nativeImage.createEmpty()
    for (const scale of [1, 2]) img.addRepresentation({ scaleFactor: scale, width: 16 * scale, height: 16 * scale, buffer: cursorBitmap(TINT_RGB[tint] ?? TINT_RGB.blue, 16 * scale) })
    cursors.set(tint, img)
  }
  return cursors.get(tint)
}
export async function openIn(to: string) {
  if (!host) return
  host.openHome()
  // (a window just opening has no page to open it in yet)
  for (let i = 0; i < 20; i++) {
    if (await op("ui.open", { path: to }).then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
/** A job opened: its tab in the home vault's window (opened first if need be; one closed once done resumes), and it's
 *  no longer news. */
async function openJob(j: HelperJob) {
  live.say({ t: "job-seen", ids: [j.id] })
  if (!j.link || !host) return
  host.openHome()
  // (a window just opening has no page to open it in yet)
  for (let i = 0; i < 20; i++) {
    if (await op("companion.job-open", { id: j.id }).catch(() => op("ui.open", { path: j.link })).then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
/** A session by the notch opened: its terminal in Vaultite, or what its knock names; a job's ready knock shows its
 *  change (its proof, companion job-show) over this Mac's displays. */
export async function openPresence(p: Presence) {
  if (!host) return
  host.openHome()
  const job = p.open?.startsWith("job:") ? p.open.slice(4) : ""
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  const go = () => (job ? op("companion.job-show", { id: job, displays }) : p.terminal ? op("ui.open", { path: `view:terminal/${p.terminal}` }) : p.open ? op("ui.open", { path: p.open }) : Promise.resolve({}))
  // (a window just opening has no page to open it in yet)
  for (let i = 0; i < 20; i++) {
    if (await go().then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
/** A job ended or needs them: a notification, whose click opens it; what it waits on, its buttons answer there. */
export function jobNotice(j: HelperJob) {
  if (mutedUntil > Date.now()) return
  const note = jobNote(j)
  if (QUIET) return void asked.push({ notice: "job", id: j.id, state: j.state, body: note.body, choices: note.choices })
  if (!Notification.isSupported()) return
  const n = new Notification({ title: note.title, body: note.body, silent: true, actions: note.choices.map((text) => ({ type: "button" as const, text })) })
  n.on("click", () => void openJob(j))
  // (a choice that no longer fits, its prompt gone or changed: the job opens instead)
  n.on("action", (_e, i) => void op("companion.job-answer", { id: j.id, choice: String(i + 1) }).catch(() => openJob(j)))
  n.show()
}
/** Keys as a Mac writes them: "fn⌃, right ⌥ or ⌃⌥". */
export function keysSaid(keys: string[]) {
  const said = keys.map((k) => ({ fn: "fn", right_option: "right ⌥", right_command: "right ⌘", left_control: "left ⌃", right_control: "right ⌃", control_option: "⌃⌥", fn_control: "fn⌃" } as Record<string, string>)[k]).filter(Boolean)
  return said.length ? said.length > 1 ? `${said.slice(0, -1).join(", ")} or ${said.at(-1)}` : said[0] : "No keys picked"
}
export function login(on: boolean) {
  if (app.getLoginItemSettings().openAtLogin !== on) app.setLoginItemSettings({ openAtLogin: on })
}
export let badged = ""
const unreadSays = () => live.state.said.filter((n) => n.agent === live.state.name && n.kind === "say" && !n.seen)
/** The menu bar icon's badge: a dot on it while some of its words weren't seen or jobs ended that weren't opened, how
 *  many in its tooltip. Never a number beside it: the menu bar is for glances, the menu says what they are. */
export function badge() {
  const b = live.state.mode === "off" ? "" : badgeOf(unreadSays().length, live.state.jobs ?? [])
  if (b === badged) return
  badged = b
  if (!tray || !plainIcon) return
  if (b && !dottedIcon) {
    const img = nativeImage.createEmpty()
    for (const scale of [1, 2]) {
      const bgra = plainIcon.toBitmap({ scaleFactor: scale }), px = Math.round(Math.sqrt(bgra.length / 4))
      if (px) img.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: dottedBitmap(bgra, px) })
    }
    img.setTemplateImage(true)
    dottedIcon = img
  }
  tray.setImage(b ? dottedIcon! : plainIcon)
  tray.setToolTip(b ? `${app.getName()}: ${b} new` : app.getName())
}

export function showTray(file: string) {
  const icon = nativeImage.createFromPath(file)
  icon.setTemplateImage(true)
  plainIcon = icon
  tray = new Tray(icon)
  tray.setToolTip(app.getName())
  // (its section headers, Companion and Jobs, read as bold titles: menus.m)
  void macAddon("menus", path.join(app.getPath("userData"), "bin")).then((m) => m.call({ cmd: "boldHeaders" }))
    .catch((e) => console.warn(`vaultite: the menu's headers stay AppKit's (${(e as Error).message})`))
  tray.on("click", () => tray?.popUpContextMenu(Menu.buildFromTemplate(menuItems())))
}
export function hideTray() {
  tray?.destroy()
  tray = null
}
/** For the menu: the decisions an agent waits on, and whether the user muted (a vault without the inbox has neither). */
export async function followInbox() {
  const [ds, held] = await Promise.all([op("inbox.decisions", {}).catch(() => null), op("inbox.hold", {}).catch(() => null)])
  decisions = ((ds?.decisions ?? []) as { question: string; from: string | null; created: string | null; blocking?: boolean }[]).filter((x) => x.blocking)
  mutedUntil = heldUntil(held?.hold)
}
