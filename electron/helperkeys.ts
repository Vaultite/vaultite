import { fnActsToo, isChord, keyCodes, modKeys, type FnEvent, type ModEvent } from "../core/fnkey.ts"
import { dictationKeys, tappedKeys } from "./helperlogic.ts"
import { fnUsage } from "./screen.ts"
import { LIVE, QUIET, screenAsk, stubs } from "./helperask.ts"
import { dictating, host, notice, prefs } from "./helperbase.ts"
import { act, key, page, pageIs, session, starting } from "./helpersession.ts"
import { talkHeard } from "./helpertalk.ts"

/** The screen helper's tap hears the picked keys only: the dictation keys (none while Dictate anywhere is off) and the
 *  Talk keys, a key alone by its code, a chord by its name. */
const heardKeys = () => dictationKeys(prefs)
const keysNow = () => `${heardKeys().join()}|${prefs.talk.join()}`
export const listen = () => { const all = tappedKeys(prefs); return LIVE ? screenAsk("fn", { keys: keyCodes(all), chords: all.filter(isChord) }) : Promise.resolve({}) }
let mods = modKeys(heardKeys()), talkMods = modKeys(prefs.talk), followed = keysNow()
export function followKeys() {
  if (keysNow() === followed) return
  followed = keysNow()
  mods = modKeys(heardKeys())
  talkMods = modKeys(prefs.talk)
  void listen().catch(() => {})
}
let settling: ReturnType<typeof setTimeout> | null = null, talkSettling: ReturnType<typeof setTimeout> | null = null
const asFn = (events: FnEvent[]) => { for (const e of events) fnHeard(e, false) }
const asTalk = (events: FnEvent[]) => { for (const e of events) talkHeard(e) }
export function modHeard(m: Record<string, unknown>) {
  const r = mods.heard(m as ModEvent), t = talkMods.heard(m as ModEvent)
  if (settling) clearTimeout(settling)
  settling = r.wait ? setTimeout(() => { settling = null; asFn(mods.settled()) }, r.wait) : null
  if (talkSettling) clearTimeout(talkSettling)
  talkSettling = t.wait ? setTimeout(() => { talkSettling = null; asTalk(talkMods.settled()) }, t.wait) : null
  asFn(r.fn)
  asTalk(t.fn)
}
/** A chord (⌃⌥, fn⌃): the companion's if it's a Talk key, else dictation's, as a key's press and release. */
export function chordHeard(m: Record<string, unknown>) {
  const name = String(m.name), e: FnEvent = m.other === true ? { other: true } : { down: m.on === true, ...typeof m.t === "number" ? { t: m.t } : {} }
  if (prefs.talk.includes(name)) talkHeard(e)
  else if (heardKeys().includes(name)) fnHeard(e)
}
export function fnHeard(m: Record<string, unknown>, byFn = true) {
  if (!prefs.fn || !host?.home()) return
  const to = page && !page.isDestroyed() ? page : null
  // (Control's double tap: hands-free, or off; the window's while it dictates or has the keyboard, never because it
  // took an earlier press: a double tap brings no down of its own)
  if (m.double === true) {
    const win = session || starting ? null : dictating() ? to : keyboardPage()
    if (win) { pageIs(win); return void win.send("vaultite:fn", { double: true }) }
    if (session || starting) return act("stop")
    act("start")
    return act("free")
  }
  if (m.other === true) { const shortcut = m.shortcut === true; if (to) to.send("vaultite:fn", { other: true, shortcut }); else act(key.other(Date.now(), shortcut)); return }
  if (m.down === true) {
    if (!session) pageIs(keyboardPage())
    if (page && !session) return void page.send("vaultite:fn", { down: true, held: m.held === true })
    pageIs(null)
    if (byFn) void firstUse()
    return act(key.down(Date.now(), !!session || starting, m.held === true))
  }
  if (to) { to.send("vaultite:fn", { down: false }); return }
  act(key.up(Date.now()))
}
/** The app's page that has the keyboard, which a dictation key's press goes to (a scripted copy's never does: a stub
 *  says it does). */
const keyboardPage = () => host?.focusedPage() ?? (QUIET && stubs.has("keyboard") ? host?.homeWindow()?.page ?? null : null)
let checkedFn = false
/** The first press: macOS's own action for the key (an emoji picker, the input source) would come too: say how to stop it, once. */
async function firstUse() {
  if (checkedFn || host?.prefs().fnNotice) return
  checkedFn = true
  if (fnActsToo(await fnUsage())) notice("fn-usage", "macOS acts on fn too", "In System Settings, Keyboard, set \"Press globe key to\" to \"Do nothing\".",
    "x-apple.systempreferences:com.apple.Keyboard-Settings.extension", "fnNotice")
}
