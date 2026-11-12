import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  const { api, check, tmp } = $
  // The menu-bar helper (electron/helper.ts): fn as ⌘J, the overlay's scene, the screen plugin and the companion's
  // screen moments. Its native part (screen.swift) only answers here: no key is tapped, no app's tree is woken.
  {
    const { fnKey, fnActsToo, isChord, keyCodes, modKeys, talkGesture } = await import("../../../core/fnkey.ts")
    const k = fnKey(450)
    const tap = [k.down(0, false), k.up(100)], again = [k.down(1000, true), k.up(1100)], held = [k.down(2000, false), k.up(2600)]
    check("fn: a tap starts and leaves it listening, the next press stops; held, it stops when let go",
      tap.join() === "start," && again.join() === "stop," && held.join() === "start,stop", { tap, again, held })
    const combo = [k.down(3000, false), k.other(3050), k.up(3100)]
    check("fn: a key pressed with it (fn+arrow) cancels what its press started, and nothing else", combo.join() === "start,cancel," && fnKey().other(0) === null, combo)
    const talking = fnKey(450), said = [talking.down(0, false), talking.other(2000), talking.up(3000)]
    check("fn: a key pressed long after, while held (⌘Tab while talking), leaves it listening, till let go", said.join() === "start,,stop", said)
    const dbl = fnKey(450, 350), twice = [dbl.down(0, false), dbl.up(80), dbl.down(200, true), dbl.up(260), dbl.down(5000, true), dbl.up(5080)]
    check("fn: a double tap goes hands-free, the next press stops", twice.join() === "start,,free,,stop,", twice)
    const apart = fnKey(450, 350), two = [apart.down(0, false), apart.up(80), apart.down(1000, true), apart.up(1080)]
    check("fn: two taps far apart are a start and a stop", two.join() === "start,,stop,", two)
    const end = fnKey(450, 350), ended = [end.down(0, false), end.up(80), end.down(5000, true), end.up(5060), end.down(5200, false), end.up(5260), end.down(9000, false)]
    check("fn: a double tap that stops doesn't start another", ended.join() === "start,,stop,,,,start", ended)
    check("fn: macOS's globe key acts too unless it's set to Do nothing", fnActsToo(null) && fnActsToo("2") && !fnActsToo("0\n"))

    const ALL = ["fn", "right_option", "right_command"]
    const ROPT = 61, RCMD = 54, LOPT = 58, CTRL = 59
    const solo = (code: number) => { const m = modKeys(ALL); return { m, down: m.heard({ code, on: true, alone: true, at: 0 }), up: () => m.heard({ code, on: false, at: 100 }).fn } }
    const quick = solo(ROPT), quickUp = quick.up()
    check("right Option: it waits to see it's alone; let go first, it's a tap of fn", !!quick.down.wait && !quick.down.fn.length && JSON.stringify(quickUp) === '[{"down":true},{"down":false}]', quickUp)
    const long = solo(RCMD), settled = long.m.settled(), heldUp = long.up()
    check("right Command: still alone, it's fn down, then up when let go", JSON.stringify(settled) === '[{"down":true}]' && JSON.stringify(heldUp) === '[{"down":false}]', { settled, heldUp })
    const chord = solo(ROPT), chordKey = chord.m.heard({ other: true }).fn, chordSettled = chord.m.settled(), chordUp = chord.up()
    check("right Option + a key: nothing, it still types its accent", !chordKey.length && !chordSettled.length && !chordUp.length, { chordKey, chordSettled, chordUp })
    const slow = solo(ROPT), slowDown = slow.m.settled(), slowKey = slow.m.heard({ other: true }).fn, slowUp = slow.up()
    check("right Option + a key after it counted: that press is cancelled, as fn+key is", JSON.stringify(slowDown) === '[{"down":true}]' && JSON.stringify(slowKey) === '[{"other":true}]' && !slowUp.length, { slowKey, slowUp })
    const left = modKeys(ALL), leftDown = left.heard({ code: LOPT, on: true, alone: true, at: 0 })
    check("left Option: not a trigger, nor Control alone (double Control is no key now)", !leftDown.wait && !leftDown.fn.length && !left.settled().length && !left.heard({ code: LOPT, on: false, at: 100 }).fn.length &&
      !modKeys([...ALL, "double_control"]).heard({ code: CTRL, on: true, alone: true, at: 0 }).wait)
    const withShift = modKeys(ALL), shifted = withShift.heard({ code: RCMD, on: true, alone: false, at: 0 })
    check("right Command with another modifier held: not a trigger", !shifted.wait && !withShift.settled().length && !withShift.heard({ code: RCMD, on: false, at: 100 }).fn.length)
    const both = modKeys(ALL)
    both.heard({ code: ROPT, on: true, alone: true, at: 0 })
    const second = both.heard({ code: RCMD, on: true, alone: false, at: 20 })
    check("right Option and Command together: neither", !second.wait && !both.settled().length && !both.heard({ code: ROPT, on: false, at: 50 }).fn.length && !both.heard({ code: RCMD, on: false, at: 60 }).fn.length)
    const off = modKeys(["fn"]), offDown = off.heard({ code: ROPT, on: true, alone: true, at: 0 })
    check("a key not picked: not a trigger", !offDown.wait && !off.settled().length && !off.heard({ code: ROPT, on: false, at: 100 }).fn.length)
    {
    const LCTL = 59, RCTL = 62
    const ctl = () => modKeys(["left_control", "right_control"])
    const press = (m: ReturnType<typeof modKeys>, code: number, at: number, ms: number) => [...m.heard({ code, on: true, alone: true, at }).fn, ...m.heard({ code, on: false, at: at + ms }).fn]
    const one = ctl(), single = press(one, LCTL, 0, 90)
    check("Control: a tap alone is nothing (it's in every shortcut)", !single.length && !one.settled().length, single)
    const two = ctl(), dbl2 = [...press(two, LCTL, 0, 80), ...press(two, LCTL, 250, 80)]
    check("Control: a double tap is hands-free (on, or off)", JSON.stringify(dbl2) === '[{"double":true}]', dbl2)
    const slow2 = ctl(), apart2 = [...press(slow2, LCTL, 0, 80), ...press(slow2, LCTL, 1200, 80)]
    const hold2 = ctl(); hold2.heard({ code: LCTL, on: true, alone: true, at: 0 }); hold2.settled(); hold2.heard({ code: LCTL, on: false, at: 700 })
    const afterHold = press(hold2, LCTL, 800, 80)
    check("Control: two presses more than 500 ms apart, or a hold then a tap, aren't a double tap", !apart2.length && !afterHold.length, { apart2, afterHold })
    const cut = ctl(); press(cut, LCTL, 0, 80); cut.heard({ other: true })
    const cutAfter = press(cut, LCTL, 200, 80)
    check("Control: a tap, Control+C, a tap: not a double tap", !cutAfter.length, cutAfter)
    const held = ctl(), heldDown = (held.heard({ code: RCTL, on: true, alone: true, at: 0 }), held.settled()), heldUp = held.heard({ code: RCTL, on: false, at: 900 }).fn
    check("Control: held alone, it listens till let go", JSON.stringify(heldDown) === '[{"down":true,"held":true}]' && JSON.stringify(heldUp) === '[{"down":false}]', { heldDown, heldUp })
    const kh = fnKey(450), heldActs = [kh.down(400, false, true), kh.up(500)], busy = fnKey(450), heldBusy = [busy.down(0, true, true), busy.up(900)]
    check("Control: its hold's release always stops (it counted late); held while listening, nothing", heldActs.join() === "start,stop" && heldBusy.join() === ",", { heldActs, heldBusy })
    const sc = ctl(), quickC = [...sc.heard({ code: LCTL, on: true, alone: true, at: 0 }).fn, ...sc.heard({ other: true }).fn, ...sc.settled(), ...sc.heard({ code: LCTL, on: false, at: 900 }).fn]
    check("Control+C (or Control-click, Control-scroll) before the hold counts: nothing starts", !quickC.length, quickC)
    const late = ctl(); late.heard({ code: LCTL, on: true, alone: true, at: 0 }); late.settled()
    const lateKey = late.heard({ other: true }).fn, kc = fnKey(450), lateCancel = [kc.down(0, false, true), kc.other(2000, true), kc.up(3000)]
    check("Control held, then a key (a slow shortcut): what it started is cancelled, however long it was held", JSON.stringify(lateKey) === '[{"other":true,"shortcut":true}]' &&
      lateCancel.join() === "start,cancel,", { lateKey, lateCancel })
    const chordFirst = ctl(), withOpt = [...chordFirst.heard({ code: LCTL, on: true, alone: true, at: 0 }).fn, ...chordFirst.heard({ code: LOPT, on: true, alone: false, at: 60 }).fn, ...chordFirst.settled(), ...chordFirst.heard({ code: LCTL, on: false, at: 300 }).fn]
    check("Control then Option (the Talk keys' ⌃⌥): Control alone does nothing", !withOpt.length, withOpt)
    check("Control waits longer than right Option to count", ctl().heard({ code: LCTL, on: true, alone: true, at: 0 }).wait! > (modKeys(ALL).heard({ code: ROPT, on: true, alone: true, at: 0 }).wait ?? 0))
    }
    check("the tap hears the picked keys' codes; chords go by name", keyCodes([...ALL, "control_option", "fn_control", "left_control", "right_control"]).join() === "63,61,54,59,62" && keyCodes(["nope"]).length === 0 &&
      isChord("control_option") && isChord("fn_control") && !isChord("fn"))

    // The Talk keys' gesture (HeyClicky's): hold, tap, double tap.
    const run = (steps: [string, number][]) => { const g = talkGesture(250, 350); return steps.map(([e, t]) => (e === "d" ? g.down(t) : e === "u" ? g.up(t) : e === "h" ? g.held() : g.other())).filter(Boolean).join() }
    check("talk: held, it listens and sends when let go", run([["d", 0], ["u", 900]]) === "listen,send")
    check("talk: a tap opens its box to type in, nothing heard", run([["d", 0], ["u", 120]]) === "listen,type")
    check("talk: a double tap listens hands-free, and the next double tap sends", run([["d", 0], ["u", 100], ["d", 250], ["u", 330], ["d", 5000], ["u", 5080], ["d", 5200], ["u", 5280]]) === "listen,type,free,send")
    check("talk: hands-free, a single tap doesn't send, a hold does", run([["d", 0], ["u", 100], ["d", 250], ["u", 330], ["d", 5000], ["u", 5080]]) === "listen,type,free" &&
      run([["d", 0], ["u", 100], ["d", 250], ["u", 330], ["d", 9000], ["u", 9900]]) === "listen,type,free,send")
    // (2026-11-07, as logged: let go of a hold, then two 50 ms taps of the chord within a third of a second)
    check("talk: taps bouncing just after a send open nothing, and go hands-free never", run([["d", 0], ["u", 5367], ["d", 5629], ["u", 5682], ["d", 5743], ["u", 5788]]) === "listen,send")
    check("talk: pressed again just after a send and held, it listens once held", run([["d", 0], ["u", 900], ["d", 1100], ["h", 1350], ["u", 3000]]) === "listen,send,listen,send" &&
      run([["d", 0], ["u", 900], ["d", 1100], ["o", 1200], ["h", 1350], ["u", 1500]]) === "listen,send")
    check("talk: a tap a moment after a send opens its box", run([["d", 0], ["u", 900], ["d", 1400], ["u", 1480]]) === "listen,send,listen,type")
    check("talk: a key with it (⌃⌥→, a shortcut) cancels, and its release does nothing", run([["d", 0], ["o", 50], ["u", 900]]) === "listen,cancel")
    check("talk: two taps far apart are two boxes, not hands-free", run([["d", 0], ["u", 100], ["d", 2000], ["u", 2100]]) === "listen,type,listen,type")
  }
  {
    const { joinText, replacer } = await import("../../../core/dictationtext.ts")
    const swap = replacer(["at Claude: @claude"])
    check("dictation: words join with a space, none before punctuation; replacements by whole words",
      joinText("Hi", "there") === " there" && joinText("Hi", ", there") === ", there" && joinText("", "x") === "x" &&
      swap.reduce((t, [re, to]) => t.replace(re, to), "ask at  claude now") === "ask @claude now")
  }
  {
    const { privateApp } = await import("../../../core/privateapps.ts")
    const list = ["1Password", "com.bank.*", "com.apple.MobileSMS"]
    check("private apps: by name or bundle id in any case, a vendor's by its prefix; Messages only when listed",
      privateApp({ bundle: "com.1password.1password", name: "1Password" }, list) && privateApp({ bundle: "com.bank.mobile", name: "Bank" }, list) &&
      privateApp({ bundle: "COM.APPLE.MOBILESMS", name: "Messages" }, list) && !privateApp({ bundle: "com.apple.mail", name: "Mail" }, list) &&
      !privateApp({ bundle: "com.apple.MobileSMS", name: "Messages" }, ["1Password"]))
  }
  {
    const { atOffset, beatsWait, dictationKeys, drawingHold, drawnShapes, inkOf, panelAt, pointIn, prefsOf, sceneFor, splitScene, tappedKeys, trailStrokes } = await import("../../../electron/helperlogic.ts")
    // (a drawing answered with no words: its marks wait for nothing, and are held up long enough to see before a spoken
    // exchange ends by itself; the bug: they waited for words never said, and went with the exchange 1.5 s on)
    check("helper: a wordless drawing's marks don't wait for words once its turn is over; a worded one's do while said or to come",
      !beatsWait({ saying: null, aloud: true, words: false, working: false }) && beatsWait({ saying: null, aloud: true, words: false, working: true }) &&
      beatsWait({ saying: null, aloud: true, words: true, working: false }) && beatsWait({ saying: true, aloud: false, words: false, working: false }) &&
      !beatsWait({ saying: false, aloud: true, words: true, working: true }) && !beatsWait({ saying: null, aloud: false, words: true, working: true }))
    check("helper: a drawing is held up a few seconds to be seen, longer for each beat", drawingHold(0) >= 3000 && drawingHold(2) > drawingHold(0) && drawingHold(99) <= 20_000)
    const area = { x: 0, y: 25, width: 1600, height: 975 }, bounds = { x: 0, y: 0, width: 1600, height: 1000 }, size = { width: 300, height: 200 }
    const { arrowBox, boxAt, flagBox } = await import("../../../core/desktop/boxes.ts")
    const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    type Rect = { x: number; y: number; width: number; height: number }
    const covers: unknown[] = []
    // (every corner and edge of the screen, the flag under its arrow or over it, a target or none)
    for (const x of [10, 400, 1200, 1590]) for (const y of [30, 300, 700, 990]) for (const target of [null, { x: x - 16, y: y - 10, width: 160, height: 22 }]) {
      const tip = { x, y }, f = flagBox(tip, 130, area), clear = [arrowBox(tip), f, ...(target ? [target] : [])]
      for (const sz of [{ width: 220, height: 60 }, size]) {
        const b = { ...boxAt(tip, sz, area, clear), ...sz }
        if (clear.some((c) => meets(b, c)) || b.x < area.x || b.y < area.y || b.x + b.width > area.x + area.width || b.y + b.height > area.y + area.height) covers.push({ tip, target, b, f })
      }
    }
    check("boxes: a cursor's words never cover its arrow, its name or what it points at, and stay on screen, in every corner", !covers.length, covers.slice(0, 3))
    const low = flagBox({ x: 100, y: 990 }, 130, area), lowBox = boxAt({ x: 100, y: 990 }, { width: 220, height: 60 }, area, [arrowBox({ x: 100, y: 990 }), low])
    check("boxes: near the foot its name goes over its arrow, and its words go above it, not on it (the bug)", low.low && !meets({ ...lowBox, width: 220, height: 60 }, low) && lowBox.y + 60 <= low.y, { low, lowBox })
    check("boxes: beside its arrow, rising from its tip, by default", JSON.stringify(boxAt({ x: 100, y: 100 }, { width: 220, height: 60 }, area, [arrowBox({ x: 100, y: 100 }), flagBox({ x: 100, y: 100 }, 130, area)])) === '{"x":121,"y":56,"side":"right","up":true}')
    check("helper: a cursor's conversation opens clear of its arrow and name, always on screen",
      !meets({ ...panelAt({ x: 100, y: 990 }, size, area, 130), ...size }, flagBox({ x: 100, y: 990 }, 130, area)) && panelAt({ x: 100, y: 0 }, { width: 300, height: 960 }, area).y >= 25)
    check("helper: a spot left in a window stays inside it as it shrinks", JSON.stringify(atOffset({ x: 10, y: 10, width: 100, height: 100 }, { dx: 500, dy: 50 })) === '{"x":102,"y":60}')
    const blank = { agents: [], summon: null, pill: null }
    check("helper: a display's scene knows the menu bar's height", sceneFor({ id: 1, bounds, workArea: area }, blank, { x: 0, y: 0 }, []).top === 25)
    const defaults = { dictation: { fn: { default: true }, keys: { default: ["fn_control"] } }, companion: { keys: { default: ["control_option"] } }, screen: { private_apps: { default: ["1Password"] } } }
    const none = prefsOf({}, {}, {}, defaults), set = prefsOf({ fn: false, keys: ["right_option"] }, {}, { private_apps: [] }, defaults)
    check("helper: settings left out are the manifests' defaults (fn⌃ dictates, ⌃⌥ talks); set ones win, an empty private list too",
      none.fn && none.keys.join() === "fn_control" && none.talk.join() === "control_option" && set.keys.join() === "right_option" && none.privateApps.join() === "1Password" && !set.fn && set.privateApps.length === 0, { none, set })
    check("helper: Dictate anywhere off, its keys go unheard but the Talk keys are still tapped (the companion stays)",
      dictationKeys(set).length === 0 && tappedKeys(set).join() === "control_option" && tappedKeys(none).join() === "fn_control,control_option", [tappedKeys(set), tappedKeys(none)])
    const split = prefsOf({ keys: ["fn", "right_option", "control_option"] }, {}, {}, defaults), mine = prefsOf({}, { keys: ["fn"] }, {}, defaults)
    check("helper: Talk keys are the companion's, and a key in both talks, never dictates",
      split.talk.join() === "control_option" && split.keys.join() === "fn,right_option" && mine.talk.join() === "fn" && !mine.keys.includes("fn"), { split, mine })
    check("helper: it points at an element by its left edge's middle, at a window by its title bar",
      JSON.stringify(pointIn({ x: 100, y: 200, width: 80, height: 20 }, true)) === '{"x":116,"y":210}' &&
      JSON.stringify(pointIn({ x: 0, y: 30, width: 800, height: 600 }, false)) === '{"x":400,"y":42}')
    const left = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }, right = { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    const scene = { agents: [{ name: "Claude", tint: "orange", state: "thinking", sx: 1500, sy: 100, target: { x: 1480, y: 90, width: 100, height: 20 } }],
      summon: { name: "Claude", tint: "orange", state: "listening" as const, sx: 978, sy: 266, words: "what's" },
      pill: { level: 0.5, text: "hello", ready: true } }
    const l = sceneFor(left, scene, { x: 10, y: 10 }, [left, right]), r = sceneFor(right, scene, { x: 10, y: 10 }, [left, right])
    check("helper: each display draws what's on it, in its own points (a target's frame); dictation's box on the pointer's",
      !l.agents.length && l.summon?.sx === 978 && l.pill?.text === "hello" && r.agents[0]?.sx === 500 && r.agents[0]?.target?.x === 480 && !r.summon && !r.pill, { l, r })
    const riding = sceneFor(right, { ...scene, summon: { ...scene.summon, follow: true } }, { x: 10, y: 10 }, [left, right])
    check("helper: riding with the pointer, the summoned one is on every display (each draws it while it's there)", riding.summon?.sx === -22, riding.summon)
    const loud = (level: number) => splitScene(sceneFor(left, { ...scene, summon: { ...scene.summon, follow: true, level } }, { x: 10, y: 10 }, [left, right]))
    check("helper: listening, how loud they are goes with the places, not as a new scene", loud(0.2).shape === loud(0.9).shape && loud(0.9).at.hear === 0.9, loud(0.9).at)
    const lost = sceneFor(left, scene, { x: -9999, y: -9999 }, [left, right])
    check("helper: the pointer on no display known, dictation's box still shows", !!lost.pill, lost)

    // Where dictated words land (electron/dictationroam.ts), with what's asked stood in.
    const { land, landedSaid } = await import("../../../electron/dictationroam.ts")
    const landing = (o: Record<string, unknown> = {}) => {
      const did: string[] = []
      return { did, o: { page: async () => null, front: async () => ({}), insert: async (t: string) => { did.push(`insert:${t}`); return { ok: true, how: "ax" } },
        origin: async (t: string) => { did.push(`origin:${t}`); return { ok: false } }, copy: (t: string) => { did.push(`copy:${t}`) }, capture: async (t: string) => { did.push(`capture:${t}`); return true }, secret: () => false, ...o } as never }
    }
    const inPage = landing({ page: async () => ({ ok: true }) })
    check("dictation lands: a window's own target first", (await land("hi", inPage.o)).to === "page" && !inPage.did.length, inPage.did)
    const inField = landing({ front: async () => ({ field: true, before: "well", name: "Mail" }) })
    const fieldTo = await land("hi", inField.o)
    check("dictation lands: else the field in front, joined to what's before its caret", fieldTo.to === "front" && inField.did.join() === "insert: hi" && landedSaid(fieldTo, "Notes") === "In Mail" && landedSaid(fieldTo, "Mail") === "", { fieldTo, did: inField.did })
    const secure = landing({ front: async () => ({ field: true, secure: true }), origin: async () => ({ ok: true, name: "Slack" }) })
    const secureTo = await land("hi", secure.o)
    check("dictation lands: never a password field; the field it started in instead", secureTo.to === "origin" && !secure.did.length && landedSaid(secureTo) === "Back in Slack", { secureTo })
    const nowhere = landing()
    const nowhereTo = await land("hi", nowhere.o)
    check("dictation lands: with neither, the clipboard and the inbox: never lost", nowhereTo.to === "clipboard" && nowhereTo.kept === true && nowhere.did.join() === "origin:hi,copy:hi,capture:hi" && landedSaid(nowhereTo) === "Copied, and in your inbox", { nowhereTo, did: nowhere.did })
    const hush = landing({ secret: () => true })
    const hushTo = await land("hi", hush.o)
    check("dictation lands: a private app in front: copied, not kept in the vault", hushTo.to === "clipboard" && !hushTo.kept && !hush.did.includes("capture:hi") && landedSaid(hushTo) === "Copied", { hushTo, did: hush.did })
    const failing = landing({ insert: async () => { throw new Error("gone") }, front: async () => ({ field: true }), capture: async () => { throw new Error("no server") } })
    const failedTo = await land("hi", failing.o)
    check("dictation lands: a step failing goes on to the next; the clipboard always has them", failedTo.to === "clipboard" && !failedTo.kept && failing.did.includes("copy:hi") && landedSaid(failedTo) === "Copied", { failedTo })
    const web = landing({ page: async () => ({ ok: false, elsewhere: true }), front: async () => ({ vaultite: true, editable: true }) })
    check("dictation lands: a web pane of ours with a field: typed there", (await land("hi", web.o)).to === "front" && web.did.join() === "insert:hi", web.did)
    const ownNot = landing({ page: async () => ({ ok: false }), front: async () => ({ vaultite: true, editable: true }) })
    check("dictation lands: our page with no target isn't typed into by Accessibility", (await land("hi", ownNot.o)).to === "clipboard" && !ownNot.did.some((d) => d.startsWith("insert")), ownNot.did)
    check("dictation lands: what went into another app's field is told, to follow it; not into a pane of ours", fieldTo.text === " hi" && !(await land("hi", landing({ page: async () => ({ ok: false, elsewhere: true }), front: async () => ({ vaultite: true, editable: true }) }).o)).text &&
      (await land("hi", landing({ origin: async () => ({ ok: true, name: "Slack", text: " hi", how: "paste" }) }).o)).how === "paste", fieldTo)

    // Dictation learning in other apps (electron/dictationfix.ts): the words found again in the field's text as it changes
    const { placeOf, followField } = await import("../../../electron/dictationfix.ts")
    check("learn in apps: the words said are found by the caret, else nearest it, else not at all",
      JSON.stringify(placeOf("So: hi there", " hi", 6)) === '{"before":"So:","after":" there"}' && placeOf("hi, hi, hi", "hi", 9)?.before === "hi, hi, " &&
      placeOf("hi, hi, hi", "hi", 7)?.before === "hi, " && placeOf("hi then hi", "hi")?.before === "hi then " && placeOf("autocorrected", " hi", 3) === null && placeOf("x", "  ") === null)
    const taught: string[] = [], told: string[] = []
    const teach = { add: async (e: { word: string; said?: string }) => { taught.push(`${e.said}>${e.word}`); return e }, remove: async () => {}, told: (es: { word: string }[]) => { told.push(es.map((e) => e.word).join()) } }
    const settle = () => new Promise((r) => setTimeout(r, 30))
    let over = 0
    const words = " we met Kyle at the Lighthouse office today"
    const f = followField(words, `Notes:${words}`, 6 + words.length, teach, () => over++)!
    f.changed(`Notes: we met Ka at the Lighthouse office today`)
    f.changed(`Notes: we met Kaio at the Lighthouse office today and more`)
    f.done(); await settle()
    check("learn in apps: a word fixed in the field (typed more after it too) is learned when it's done, once; then it's over",
      taught.join() === "Kyle>Kaio" && told.join() === "Kaio" && over === 1, { taught, told, over })
    taught.length = 0
    for (const before of ["Notes:", ""]) {
      const sent = followField(words, before + words, -1, teach, () => {})!
      sent.changed(before + words.replace("Kyle", "Kaio"))
      sent.changed("")
    }
    await settle()
    check("learn in apps: a message sent (the field cleared) right after the fix: the fix still counts, the words alone in it too", taught.join() === "Kyle>Kaio,Kyle>Kaio", taught)
    taught.length = 0
    const before = followField(words, `Notes:${words}`, -1, teach, () => {})!
    before.changed(`Draft notes: we met Kyle at the Lighthouse office today`); await settle()
    const untouched = followField(words, `Notes:${words}`, -1, teach, () => {})!
    untouched.changed(`Notes:${words}`); untouched.done(); await settle()
    check("learn in apps: an edit before the words loses them; words left as said teach nothing; words not there, nothing followed",
      !taught.length && followField(words, "Notes: something else", -1, teach, () => {}) === null, taught)
    const crossing = { ...scene, agents: [{ ...scene.agents[0], from: { x: 900, y: 100 } }] }
    const cl = sceneFor(left, crossing, { x: 10, y: 10 }, [left, right]), cr = sceneFor(right, crossing, { x: 10, y: 10 }, [left, right])
    check("helper: a cursor on its way from one display to another is drawn on both, each in its own points",
      cl.agents[0]?.sx === 1500 && cl.agents[0]?.from?.x === 900 && cr.agents[0]?.sx === 500 && cr.agents[0]?.from?.x === -100, { cl, cr })
    const a = splitScene(r), moved = splitScene({ ...r, agents: [{ ...r.agents[0], sx: 510, from: { x: 1, y: 2 } }] }), said = splitScene({ ...r, agents: [{ ...r.agents[0], say: { id: "s1", text: "hi" } }] })
    check("helper: a cursor that only moved sends only its place (and its target's); one that says something, the whole scene",
      a.shape === moved.shape && JSON.stringify(moved.at.agents) === '{"Claude":[510,100,480,90,100,20]}' && a.shape !== said.shape, { a, moved })
    const ring = Array.from({ length: 40 }, (_, i) => ({ x: 500 + 60 * Math.cos((i / 39) * Math.PI * 2), y: 300 + 40 * Math.sin((i / 39) * Math.PI * 2) }))
    const under = Array.from({ length: 30 }, (_, i) => ({ x: 400 + i * 8, y: 520 + (i % 2) }))
    const ink = inkOf([ring, under, [{ x: 1, y: 1 }]])
    check("helper: ink reads as shapes with their box and a few points: a ring round something, an underline",
      ink.length === 2 && ink[0].shape === "ring" && ink[0].box.x === 440 && ink[0].box.width === 120 && ink[0].points.length <= 40 && ink[1].shape === "underline" && ink[1].points.length < 10, ink)
    // (the trail a held Talk key leaves: the way there, then a ring round the thing)
    const t0 = 10_000, way = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 13, y: 100 + i * 6, t: t0 + i * 16 }))
    const loop = Array.from({ length: 50 }, (_, i) => ({ x: 560 + 50 * Math.cos(-Math.PI + (i / 49) * Math.PI * 2.2), y: 300 + 30 * Math.sin(-Math.PI + (i / 49) * Math.PI * 2.2), t: t0 + 480 + i * 16 }))
    const still = [{ x: 900, y: 900, t: t0 - 5000 }]
    const drawn = trailStrokes([...still, ...way, ...loop], t0 + 1300)
    const read = inkOf(drawn)
    check("helper: held, the pointer's trail is what it drew: its last seconds, the way to a thing and the ring round it read as that ring",
      drawn.length === 1 && read[0]?.shape === "ring" && Math.abs(read[0].box.x - 510) < 6 && Math.abs(read[0].box.width - 100) < 8, { n: drawn.length, read })
    const paused = trailStrokes([...way, ...way.map((p) => ({ ...p, x: p.x + 400, t: p.t + 900 }))], t0 + 2000)
    const pointed = drawnShapes(inkOf(trailStrokes(way, t0 + 600))), underlined = drawnShapes(inkOf([Array.from({ length: 20 }, (_, i) => ({ x: 300 + i * 8, y: 500 + (i % 2) }))]))
    check("helper: only what was meant goes as a drawing: a ring, an underline; the pointer's way to a thing doesn't", !pointed.length && underlined[0]?.shape === "underline" &&
      drawnShapes(read).length === 1, { pointed, underlined })
    check("helper: a pause splits the trail into strokes; a twitch isn't a stroke", paused.length === 2 && !trailStrokes([{ x: 1, y: 1, t: 1 }, { x: 3, y: 2, t: 17 }], 20).length, paused.length)
  }
  {
    // The helper's cursor between the window and the screen (electron/helper.ts draw), in a Node of its own with Electron
    // stood in: it needs module mocks.
    const run = (flags: string[]) => spawnSync(process.execPath, [...flags, "--no-warnings", path.join(import.meta.dirname, "..", "helperdraw.ts")], { encoding: "utf8", timeout: 60_000 })
    // (a Node whose mocks are no longer behind a flag may not know it)
    let r = run(["--experimental-test-module-mocks"])
    if (/bad option/.test(r.stderr)) r = run([])
    const lines = r.stdout.split("\n").filter((l) => /^(ok|FAIL) /.test(l))
    for (const l of lines) check(l.replace(/^(ok|FAIL)\s+/, "").replace(/ [[{].*$/, ""), l.startsWith("ok"), l)
    check("helper draw: ran to its end", r.status === 0 && lines.length >= 12, { status: r.status, err: r.stderr.slice(-2000) })
  }
  {
    // The screen cursor's spring (web/src/core/spring.ts): it settles in its time, never overshoots, and a target
    // changed mid-way keeps its speed.
    const { glide, stiffness } = await import("../../../web/src/core/spring.ts")
    const run = (ms: number, w: number, g = { x: 0, y: 0, vx: 0, vy: 0 }, to = { x: 100, y: 0 }) => {
      let max = 0, t = 0, still = false
      for (; t < ms && !still; t += 16) { still = glide(g, to.x, to.y, w, 0.016); max = Math.max(max, g.x) }
      return { g, t, max, still }
    }
    const w = stiffness(380), near = run(380, w), done = run(2000, w)
    check("spring: within 1% at its time, still and exactly there soon after, never past it",
      Math.abs(near.g.x - 100) < 1.5 && done.still && done.g.x === 100 && done.t < 900 && done.max <= 100, { near, done })
    const g = { x: 0, y: 0, vx: 0, vy: 0 }
    run(100, w, g)
    const speed = g.vx, bent = { ...g }
    glide(bent, 100, 100, w, 0.016)
    check("spring: a new target mid-way keeps the speed it had, bending toward it", speed > 100 && bent.vx > speed * 0.5 && bent.vy > 0, { speed, bent })
    const big = { x: 0, y: 0, vx: 0, vy: 0 }
    glide(big, 100, 0, w, 0.25)
    const steps = { x: 0, y: 0, vx: 0, vy: 0 }
    for (let i = 0; i < 25; i++) glide(steps, 100, 0, w, 0.01)
    check("spring: one long frame lands where many short ones do", Math.abs(big.x - steps.x) < 1e-6, { big, steps })
  }
  {
    // The screen under the companion's marks (electron/markwatch.ts): sampled while what points is up; it fades when
    // the screen there changes for good, follows its thing when one is known, and lets a never-still area be.
    const mw = await import("../../../electron/markwatch.ts")
    const things = [{ id: "a1", role: "button", label: "Send", frame: { x: 100, y: 100, width: 60, height: 24 } }, { id: "a2", role: "row", label: "Inbox", frame: { x: 0, y: 300, width: 400, height: 30 } }]
    const layer = { id: "d1", agent: "Claude", tint: "blue", t: 0, places: { "el:a1": { x: 100, y: 100, w: 60, h: 24 } },
      marks: [{ type: "ring", id: "m1", at: { el: "a1" } }, { type: "underline", id: "m2", at: { x: 2, y: 302, w: 396, h: 26 } }, { type: "check", id: "m3", at: { x: 900, y: 900, w: 0, h: 0 } },
        { type: "sticky", id: "m4", text: "kept" }, { type: "write", id: "m5", text: "till it changes", life: "screen", at: { x: 600, y: 600, w: 80, h: 20 } }] } as never
    const areas = mw.watchedAreas([layer], things)
    check("mark watch: what points is watched (a point's tip as a small box), cards only when told to live till the screen changes; each anchored to the thing it's on",
      areas.map((a) => a.mark).join() === "m1,m2,m3,m5" && areas[0].on?.anchor.label === "Send" && areas[1].on?.anchor.label === "Inbox" && !areas[2].on && areas[2].rect.w === 36 &&
        mw.watchedAreas([{ ...(layer as object), hidden: true } as never]).length === 0, areas)
    const px = (v: number, n = 64) => ({ w: 8, h: 8, px: new Uint8Array(n).fill(v) })
    const tinted = { w: 8, h: 8, px: new Uint8Array(64).fill(110) }, other = { w: 8, h: 8, px: Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 250 : 10)) }
    check("mark watch: a hover's tint or a few pixels isn't a change; something else there is", !mw.differs(px(100), tinted) && !mw.differs(px(100), { w: 8, h: 8, px: Uint8Array.from({ length: 64 }, (_, i) => (i < 5 ? 255 : 100)) }) && mw.differs(px(100), other))
    const w = mw.makeWatch(), still = areas[2], seq = (a: typeof still, ss: ReturnType<typeof px>[]) => ss.map((x) => w.saw(a, x))
    check("mark watch: an area that changes from how it was as the mark came, and holds, is changed; a flicker is only moving",
      seq(still, [px(100), px(100), other, px(100), other, other]).join() === ",,moving,,moving,changed", seq)
    const e = mw.makeWatch()
    check("mark watch: a change as soon as the mark comes still counts (its first picture is the one it's compared with)", [px(100), other, other].map((x) => e.saw(still, x)).join() === ",moving,changed")
    const v = mw.makeWatch(), noisy = Array.from({ length: 9 }, (_, i) => px(i % 2 ? 0 : 250))
    check("mark watch: an area never still (a video) is never changed", noisy.map((x) => v.saw(still, x)).every((r) => r !== "changed"))
    const a1 = mw.watchedAreas([layer], things)[0], aw = mw.makeWatch()
    check("mark watch: an anchored mark's area is told the same way (the helper looks for its thing)", [px(100), px(100), other, other].map((x) => aw.saw(a1, x)).join() === ",,moving,changed")
    aw.settled(a1)
    check("mark watch: settled where its thing is now, that's how it looks", aw.saw(a1, other) === null)
    const scrolled = [{ ...things[0], frame: { ...things[0].frame, y: 40 } }, things[1]], relabelled = [things[1]]
    const moved = mw.followed(a1, scrolled), again = mw.followed(a1, scrolled), gone = mw.followed(a1, relabelled)
    check("mark watch: its thing found again moved says by how much (then where it is now), found where it was stays, not found is gone",
      moved.kind === "moved" && moved.dx === 0 && moved.dy === -60 && again.kind === "stayed" && gone.kind === "gone" && mw.followed(areas[2], scrolled).kind === "gone", { moved, again, gone })
    check("mark watch: a sample's size keeps its area's shape, small", JSON.stringify(mw.sampleSize({ x: 0, y: 0, w: 300, h: 30 })) === '{"w":48,"h":5}' && JSON.stringify(mw.sampleSize({ x: 0, y: 0, w: 20, h: 20 })) === '{"w":20,"h":20}')
  }
  {
    // The summoned companion's motion (web/src/core/pilot.ts): beside the pointer on a fast spring, an arc to what it
    // points at, its marks traced as their pen, back once the user moves on; the same on every display's window.
    const { alongLine, cubicBezier, DWELL, flightMs, makePilot, MOVE_ON, penAt } = await import("../../../web/src/core/pilot.ts")
    const pilot = makePilot(), home = (p: { x: number; y: number }) => ({ x: p.x + 24, y: p.y + 20 })
    let t = 1000
    const P = (x: number, y: number) => { const p = { x, y }; pilot.pointer(p, home(p), t) }
    const run = (ms: number, every = 16) => { const out = []; for (const end = t + ms; t < end;) { t += every; out.push(pilot.pose(t)) } return out }
    P(100, 100)
    check("pilot: it starts beside the pointer", JSON.stringify(run(16).at(-1)).includes('"x":124,"y":120'), pilot.pose(t))
    P(600, 100)
    const follow = run(800), fx = follow.map((q) => q.x)
    check("pilot: it trails the pointer on a spring, visibly behind at first, there in about a third of a second, never past, then still",
      624 - follow[4].x > 150 && Math.abs(follow[20].x - 624) < 6 && Math.max(...fx) <= 624.01 && follow.at(-1)!.x === 624 && !follow.at(-1)!.busy && follow.every((q) => q.mode === "follow"), fx.slice(0, 22))
    pilot.aim({ id: "a1", x: 300, y: 500 }, t)
    const dur = flightMs(Math.hypot(300 - 624, 500 - 120)), flight = run(dur + 32)
    const mid = flight[Math.floor(flight.length / 2)], onLine = 624 + (300 - 624) * ((mid.y - 120) / (500 - 120))
    check("pilot: pointing, it flies an arc there (bent up off the straight way, a little bigger mid-flight) and lands on it",
      flight[0].mode === "fly" && Math.abs(mid.x - onLine) > 20 && mid.scale > 1.05 && flight.at(-1)!.x === 300 && flight.at(-1)!.y === 500 && flight.at(-1)!.mode === "parked", { mid, last: flight.at(-1) })
    P(640, 130)
    run(DWELL + 100)
    check("pilot: there, a small move of the pointer leaves it pointing", pilot.mode() === "parked")
    P(600 + MOVE_ON + 40, 100)
    const away = run(1000)
    check("pilot: moving on takes it back to the pointer, flying, then riding with it", away[0].mode === "back" && away.at(-1)!.mode === "follow" && away.at(-1)!.x === 600 + MOVE_ON + 64, away.at(-1))
    pilot.aim({ id: "a1", x: 300, y: 500 }, t)
    check("pilot: the same pointing again doesn't fly it back there", run(50).at(-1)!.mode === "follow")
    // (its pen: two strokes, a gap between them)
    const s0 = t + 520, script = { id: "d1", strokes: [{ start: s0, dur: 400, pts: [[100, 300], [300, 300]] as [number, number][] }, { start: s0 + 1400, dur: 300, pts: [[100, 400], [100, 600]] as [number, number][] }] }
    pilot.pen(script, t)
    const before = run(260).at(-1)!
    t = s0 + 200
    const drawing = pilot.pose(t), ease = cubicBezier(0.35, 0.1, 0.35, 1)(0.5)
    check("pilot: given strokes, it flies to the first as the ink begins, then keeps to the ink's front as its pen",
      before.mode === "pen" && before.x < 700 && before.x > 100 && Math.abs(drawing.x - (100 + 200 * ease)) < 0.6 && drawing.y === 300, { before, drawing, ease })
    t = s0 + 900
    const waiting = pilot.pose(t)
    t = s0 + 1400 - 20
    const hopping = pilot.pose(t)
    check("pilot: between strokes it waits at the last one's end, then hops so it's at the next as it begins", waiting.x === 300 && waiting.y === 300 && hopping.y > 330 && hopping.y < 400, { waiting, hopping })
    t = s0 + 1800
    const ended = pilot.pose(t)
    check("pilot: done drawing, it stays by its last stroke", ended.mode === "parked" && ended.x === 100 && ended.y === 600, ended)
    pilot.pen(null, t)
    check("pilot: the drawing gone, it flies back to the pointer", pilot.pose(t + 16).mode === "back")
    const q = penAt(script, s0 + 1400 + 150, { x: 0, y: 0 }, t), half = alongLine([[100, 400], [100, 600]], cubicBezier(0.35, 0.1, 0.35, 1)(0.5))
    check("pilot: its pen's place on a stroke is the reveal's, eased the same", Math.abs(q.p.y - half.y) < 0.6, { q, half })
    check("pilot: CSS's cubic-bezier as browsers solve it (ease at a half is 0.8024)", Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 0.002)
    // (each display's window runs one: fed the same, at their own frame rates, they agree)
    const a = makePilot(), b = makePilot(), feed = [[0, 100, 100], [100, 500, 300], [180, 520, 340], [400, 900, 200]] as const
    let worst = 0
    for (let ms = 0; ms <= 1200; ms++) {
      for (const [at, x, y] of feed) if (at === ms) { a.pointer({ x, y }, home({ x, y }), 5000 + ms); b.pointer({ x, y }, home({ x, y }), 5000 + ms) }
      if (ms === 500) { a.aim({ id: "x", x: 200, y: 600 }, 5000 + ms); b.aim({ id: "x", x: 200, y: 600 }, 5000 + ms) }
      const pa = ms % 16 === 0 ? a.pose(5000 + ms) : null, pb = ms % 7 === 0 ? b.pose(5000 + ms) : null
      if (pa && pb) worst = Math.max(worst, Math.hypot(pa.x - pb.x, pa.y - pb.y))
    }
    check("pilot: two windows fed the same pointer, at 60 and 144 frames a second, draw it in the same place", worst < 0.5, worst)
    // (a drawing whose first stroke is seconds off, its words not said yet: it rides with the pointer, then flies just in time)
    const late = makePilot()
    late.pointer({ x: 100, y: 100 }, home({ x: 100, y: 100 }), 0)
    late.pose(16)
    late.pen({ id: "w", strokes: [{ start: 6000, dur: 300, pts: [[900, 700], [1000, 700]] }] }, 16)
    const waitPoses = Array.from({ length: 180 }, (_, i) => late.pose(32 + i * 16)), lead = flightMs(Math.hypot(900 - 124, 700 - 120))
    late.pointer({ x: 300, y: 100 }, home({ x: 300, y: 100 }), 3000)
    let rode = late.pose(3000)
    for (let at = 3016; at <= 6000 - lead - 40; at += 16) rode = late.pose(at)
    const flown = late.pose(6000 - lead / 2), there = late.pose(6000)
    check("pilot: its first stroke a while off, it stays beside the pointer (no slow drift there), then flies there in a flight's time",
      waitPoses.every((q) => q.x === 124 && q.y === 120) && Math.abs(rode.x - 324) < 2 && flown.x > 400 && flown.x < 900 && there.x === 900 && there.y === 700, { rode, flown, there, lead })
    const still = penAt({ id: "x", strokes: [{ start: 5000, dur: 200, pts: [[500, 500], [600, 500]] }] }, 2000, { x: 0, y: 0 }, 0)
    check("pilot: its pen waits where it was till a flight's time before its first stroke", still.p.x === 0 && still.p.y === 0 && !still.flying, still)
    const { pacedBeats } = await import("../../../core/desktop/screenmarks.ts")
    const held = pacedBeats("Your chats are here. You start one here.", 1, [{ at: 1500, dur: 900 }, null], 1000, true), guessed = pacedBeats("Your chats are here. You start one here.", 1, [null, null], 1000)
    check("beats: while its words are being said, a beat waits for its sentence to be heard; with no voice, the reading time",
      JSON.stringify(held.times) === "[500,null]" && guessed.times[0] === 0 && guessed.times[1] > 0, [held, guessed])
    const calm = makePilot({ reduced: true })
    calm.pointer({ x: 10, y: 10 }, { x: 34, y: 30 }, 0)
    calm.aim({ id: "r", x: 400, y: 400 }, 10)
    const r1 = calm.pose(11)
    calm.pen({ id: "p", strokes: [{ start: 2000, dur: 300, pts: [[0, 0], [50, 50]] }] }, 20)
    check("pilot: with reduced motion each place is there at once, a drawing done at once", r1.x === 400 && r1.y === 400 && calm.pose(21).x === 50, [r1, calm.pose(21)])
  }
  {
    // Each press of a key, logged a day at a time (electron/presslog.ts): its steps, how it ended once, old days gone.
    const { pressLog } = await import("../../../electron/presslog.ts")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vau-presses-"))
    let t = new Date(2026, 10, 5, 18, 9, 41).getTime()
    fs.writeFileSync(path.join(dir, "talk-2026-10-01.jsonl"), "{}\n")
    fs.writeFileSync(path.join(dir, "talk-2026-11-01.jsonl"), "{}\n")
    const log = pressLog(() => dir, "talk", () => t), p = log.start("talk", "down", { front: "com.example.mail" })
    t += 40; p.step("stt", { engine: "apple" }); t += 900; p.step("up", { action: "send" }); p.end("missed", { why: "nothing heard" }); p.end("sent"); p.step("stt-end")
    const lines = log.read("2026-11-05")
    check("press log: a press's steps in order with their time from its start, ended once, a step after its end marked late",
      lines.map((l) => l.ev).join() === "down,stt,up,end,stt-end" && lines[2].ms === 940 && lines[3].outcome === "missed" && lines[4].late === true && p.ended() && lines.every((l) => l.press === p.id && l.kind === "talk"), lines)
    check("press log: a day a file, two weeks kept", fs.existsSync(path.join(dir, "talk-2026-11-05.jsonl")) && fs.existsSync(path.join(dir, "talk-2026-11-01.jsonl")) && !fs.existsSync(path.join(dir, "talk-2026-10-01.jsonl")))
    // Each dictation's words, kept on this Mac (electron/dictationkeep.ts): as they settle, where they went, a day a file.
    const { dictationKeep } = await import("../../../electron/dictationkeep.ts")
    const kdir = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dictations-"))
    fs.writeFileSync(path.join(kdir, "dictations-2026-09-30.jsonl"), `${JSON.stringify({ t: 1, id: "d-old", ev: "start", where: { kind: "note" } })}\n`)
    fs.writeFileSync(path.join(kdir, "dictations-2026-10-10.jsonl"), `${JSON.stringify({ t: new Date(2026, 9, 10).getTime(), id: "d-kept", ev: "start", where: { kind: "field", name: "Ask" } })}\n${JSON.stringify({ t: new Date(2026, 9, 10).getTime(), id: "d-kept", ev: "words", text: "Kept a month", in: true })}\n`)
    const keep = dictationKeep(() => kdir, () => t)
    const inNote = keep.start({ kind: "note", path: "Shopping.md" })
    inNote.words("Buy milk", true); t += 10; inNote.words("and brioche.", true); inNote.end("stop")
    t += 1000
    const roamed = keep.start({ kind: "app", name: "Mail", bundle: "com.apple.mail" })
    roamed.words("Dear Alice,", false); roamed.end("stop"); roamed.landed({ to: "front", name: "Mail", text: "Dear Alice," })
    t += 1000
    const copied = keep.start({ kind: "app" }); copied.words("Call Lighthouse back", false); copied.end("stop"); copied.landed({ to: "clipboard", text: "Call Lighthouse back", inbox: true })
    t += 1000
    const closed = keep.start({ kind: "app", name: "Notes" }); closed.words("The first part.", false); t += 4000; closed.pending("And what was still being said")
    t += 1000
    const cancelled = keep.start({ kind: "app", name: "Slack" }); cancelled.words("Never mind", false); cancelled.end("cancel")
    t += 1000
    const moved = keep.start({ kind: "note", path: "A.md" }); moved.end("moved")
    const silent = keep.start({ kind: "field" }); silent.end("stop")
    const all = keep.list().items, by = (id: string) => all.find((x) => x.id === id)
    check("dictations: a window's words, typed in as they settle, are one dictation into its note", by(inNote.id)?.text === "Buy milk and brioche." && by(inNote.id)?.landing === "in" && by(inNote.id)?.where.path === "Shopping.md", by(inNote.id))
    check("dictations: the helper's says where they landed (an app, the clipboard and the inbox)", by(roamed.id)?.landing === "front" && by(roamed.id)?.where.name === "Mail" && by(copied.id)?.landing === "clipboard" && by(copied.id)?.inbox === true, [by(roamed.id), by(copied.id)])
    check("dictations: words never landed are kept, what was still being heard too, still listening while its session is", by(closed.id)?.landing === "live" && by(closed.id)?.text === "The first part. And what was still being said", by(closed.id))
    const later = dictationKeep(() => kdir, () => t).list().items.find((x) => x.id === closed.id)
    check("dictations: the app closed before they landed: kept, marked so", later?.landing === "lost" && later.why === "closed", later)
    check("dictations: cancelled ones are kept and marked; none with no words; newest first", by(cancelled.id)?.landing === "cancelled" && !by(moved.id) && !by(silent.id) && all[0].id === cancelled.id && all.at(-1)!.id === "d-kept", all.map((x) => x.id))
    check("dictations: 30 days kept, older days' files gone", !fs.existsSync(path.join(kdir, "dictations-2026-09-30.jsonl")) && !!by("d-kept"))
    const found = keep.list({ q: "LIGHTHÖUSE" }).items, mail = keep.list({ q: "mail dear" }).items
    check("dictations: search finds every word, any case or accent, in the words or where they went", found.length === 1 && found[0].id === copied.id && mail.length === 1 && mail[0].id === roamed.id, [found, mail])
    keep.forget(copied.id)
    check("dictations: one forgotten is gone, the rest kept", !keep.list().items.some((x) => x.id === copied.id) && keep.list().total === all.length - 1)
    keep.clear()
    check("dictations: cleared, nothing's left", keep.list().total === 0 && !fs.readdirSync(kdir).length)
    // A Talk-key press's machine (electron/pressmachine.ts): its table only, each move logged, a stuck phase told.
    const { pressMachine } = await import("../../../electron/pressmachine.ts")
    const moves: string[] = [], stuck: string[] = []
    const m = pressMachine({ log: (x) => moves.push(`${x.from}>${x.to}:${x.on}`), stuck: (ph) => stuck.push(ph), limits: { sending: 20 } })
    const took = [m.send("sent"), m.send("up"), m.send("up")]
    await new Promise((r) => setTimeout(r, 60))
    m.send("sent"); m.send("busy"); m.send("arrived"); m.send("done"); m.send("close", "esc"); m.send("arrived")
    check("press machine: only what its phase takes moves it, each move logged; a phase past its limit is told stuck once",
      took.join() === "false,true,false" && moves.join() === "listening>sending:up,sending>thinking:sent,thinking>working:busy,working>answering:arrived,answering>open:done,open>closed:close" &&
      m.phase === "closed" && stuck.join() === "sending", [moves, stuck])
    const held = pressMachine({ limits: {} })
    held.send("fail")
    const notSent = !held.send("sent"), was = held.phase
    check("press machine: held after the recognizer stopped, nothing is sent till it's let go", notSent && was === "failed" && held.send("up") && held.send("sent"), [was, held.phase])
    {
    // Whether the helper is talking (electron/talkstate.ts): each place that asks reads its facets, the same answer as
    // the mix of facts each used to OR, for every fact (the voice's level is on only while it says something: voice.ts).
    const { talkState } = await import("../../../electron/talkstate.ts")
    type Facts = Parameters<typeof talkState>[0]
    const PHASES = ["listening", "failed", "sending", "thinking", "working", "answering", "open", "missed", "closed"] as const
    const bools = [false, true]
    const pressFacts = [null, ...PHASES.flatMap((phase) => bools.flatMap((begun) => bools.map((ofExchange) => ({ phase, begun, ofExchange }))))]
    const exchangeFacts = [null, ...bools.flatMap((spoken) => bools.map((working) => ({ spoken, working })))]
    const all: Facts[] = []
    for (let n = 0; n < 128; n++) {
      const [session, starting, box, level, saying, realtime, offering] = [0, 1, 2, 3, 4, 5, 6].map((i) => !!(n & (1 << i)))
      if (level && !saying) continue
      for (const press of pressFacts) for (const exchange of exchangeFacts) all.push({ session, starting, box, level, saying, realtime, press, exchange, offering })
    }
    const ACTIVE = ["listening", "failed", "sending", "thinking", "working", "answering"]
    const waitingWas = (f: Facts) => !!f.press && (f.press.phase === "sending" || f.press.phase === "thinking" || (f.press.phase === "answering" && !f.press.begun))
    const goingWas = (f: Facts) => !!f.exchange && f.exchange.spoken && (f.level || f.saying || f.exchange.working || (!!f.press?.ofExchange && waitingWas(f)) || f.offering)
    const activeWas = (f: Facts) => !!f.press && ACTIVE.includes(f.press.phase)
    const busyWas = (f: Facts) => (f.session || f.starting ? "dictating" : activeWas(f) ? "press" : goingWas(f) ? "exchange" : f.level || f.saying || f.realtime ? "speaking" : f.box ? "box" : null)
    const SITES: [string, (f: Facts) => unknown, (t: ReturnType<typeof talkState>) => unknown][] = [
      ["knocks wait while it talks", (f) => f.session || f.box || f.level || f.saying || f.realtime || activeWas(f) || goingWas(f), (t) => t.listening || t.box || t.speaking || t.pressing || t.answering],
      ["a reload waits while it's busy", busyWas, (t) => (t.listening || t.starting ? "dictating" : t.pressing ? "press" : t.answering ? "exchange" : t.speaking ? "speaking" : t.box ? "box" : null)],
      ["a spoken exchange goes on", goingWas, (t) => t.answering],
      ["hands-free gives way", (f) => f.level || f.saying || f.realtime || (!!f.press && !["open", "missed", "closed"].includes(f.press.phase)), (t) => t.speaking || t.pressing],
      ["a Bluetooth mic stays held", (f) => f.session || activeWas(f) || goingWas(f) || f.saying || f.realtime, (t) => t.listening || t.pressing || t.answering || t.speaking],
      ["news waits till it's quiet", (f) => f.saying || f.realtime || activeWas(f) || goingWas(f), (t) => t.speaking || t.pressing || t.answering],
      ["a call stops its voice", (f) => f.saying || f.realtime, (t) => t.speaking],
      ["its press done once nothing's said", (f) => !(f.level || f.saying || f.realtime), (t) => !t.speaking],
      ["its cursor thinks while a press waits", waitingWas, (t) => t.waiting],
    ]
    for (const [site, was, now] of SITES) {
      const off = all.filter((f) => was(f) !== now(talkState(f)))
      check(`talk state: ${site}, as it did, for all ${all.length} facts`, !off.length, off.slice(0, 3))
    }
    const quiet: Facts = { session: false, starting: false, box: false, level: false, saying: false, realtime: false, press: null, exchange: null, offering: false }
    const typed = talkState({ ...quiet, exchange: { spoken: false, working: true } }), spokenAtWork = talkState({ ...quiet, exchange: { spoken: true, working: true } })
    const answered = talkState({ ...quiet, press: { phase: "open", begun: true, ofExchange: true } })
    check("talk state: a typed exchange's turn at work isn't talking, a spoken one's is; an answered press is no press", !typed.answering && spokenAtWork.answering && !answered.pressing && !answered.waiting)
    }
    const { liveInput } = await import("../../../electron/helperlogic.ts")
    check("helper: only the app the user runs hears their keys and takes the one lock; never a copy a script drives or one run from source, unless asked",
      liveInput({}, true) && !liveInput({ VAULTITE_QUIET: "1" }, true) && !liveInput({}, false) && liveInput({ VAULTITE_HELPER_TAP: "1" }, false) && !liveInput({ VAULTITE_QUIET: "1", VAULTITE_HELPER_TAP: "1" }, false))
  }
  {
    // The mic dictation and the Talk key hear with (electron/miclogic.ts), from made-up device lists: a Bluetooth
    // headset's own mic drops it to call quality, so with one as the output `auto` takes the built-in (or a wired) one.
    const { pickMic, micSaid } = await import("../../../electron/miclogic.ts")
    const mac = { uid: "BuiltInMic", name: "MacBook Pro Microphone", transport: "bltn", input: true, output: false }
    const speakers = { uid: "BuiltInSpeaker", name: "MacBook Pro Speakers", transport: "bltn", input: false, output: true }
    const pods = { uid: "aa-bb:input", name: "Alice's AirPods Pro", transport: "blue", input: true, output: true }
    const usb = { uid: "usb-mic", name: "Lighthouse USB Mic", transport: "usb", input: true, output: false }
    const loop = { uid: "virtual-loop", name: "Loopback Audio", transport: "virt", input: true, output: true }
    const list = (devices: typeof mac[], input: string, output: string) => ({ devices, input, output })
    const podsBoth = list([mac, speakers, pods, loop], pods.uid, pods.uid)
    const a = pickMic("auto", podsBoth)
    check("mic: auto, AirPods out and in, hears with the built-in mic, the AirPods mic never opened", a.uid === mac.uid && !a.bluetooth && /AirPods Pro, is Bluetooth/.test(a.why) && !a.fallback.includes(pods.uid), a)
    check("mic: left out or blank is auto", pickMic(undefined, podsBoth).uid === mac.uid && pickMic("  ", podsBoth).uid === mac.uid)
    const lid = pickMic("auto", list([speakers, pods, usb, loop], pods.uid, pods.uid))
    check("mic: auto with no built-in mic (a closed lid) takes a wired one, never a virtual device", lid.uid === usb.uid && !lid.bluetooth, lid)
    const only = pickMic("auto", list([speakers, pods, loop], pods.uid, pods.uid))
    check("mic: auto with only the Bluetooth mic hears with it, said as Bluetooth (held open till the answer is said)", only.uid === pods.uid && only.bluetooth && /no built-in or wired mic/.test(only.why), only)
    const wired = pickMic("auto", list([mac, speakers, pods, usb], usb.uid, pods.uid))
    check("mic: auto keeps the system's input when it isn't Bluetooth, the built-in next should it go", wired.uid === usb.uid && wired.fallback[0] === mac.uid, wired)
    const out = pickMic("auto", list([mac, speakers, pods], pods.uid, speakers.uid))
    check("mic: auto with the speakers out is the system's input, even a Bluetooth one", out.uid === pods.uid && out.why === "the system's input", out)
    const def = pickMic("default", podsBoth)
    check("mic: default is the system's input whatever the output", def.uid === pods.uid && def.bluetooth && /set/.test(def.why), def)
    const built = pickMic("builtin", podsBoth), noBuilt = pickMic("builtin", list([speakers, pods], pods.uid, pods.uid))
    check("mic: builtin is the Mac's own; with none, the system's input and why", built.uid === mac.uid && noBuilt.uid === pods.uid && /no built-in mic/.test(noBuilt.why), [built, noBuilt])
    const named = pickMic("lighthouse usb", list([mac, speakers, pods, usb], mac.uid, pods.uid)), byUid = pickMic("usb-mic", list([mac, usb], mac.uid, speakers.uid))
    check("mic: a device's name (any case, or part of it, or its uid) picks it", named.uid === usb.uid && byUid.uid === usb.uid && named.fallback.includes(mac.uid), [named, byUid])
    const gone = pickMic("Studio Mic", podsBoth)
    check("mic: a name not here is auto's pick, saying so", gone.uid === mac.uid && /^Studio Mic isn't here: /.test(gone.why), gone)
    check("mic: no devices listed yet, or no input at all: the system's input", pickMic("auto", null).uid === "" && pickMic("auto", list([speakers], "", speakers.uid)).why === "no microphone found")
    check("mic: said for the status", micSaid(a) === `MacBook Pro Microphone, ${a.why}` && micSaid({ name: "", why: "no microphone found" }) === "no microphone found")
    const { voiceHereText } = await import("../../../plugins/core/companion/voice.ts")
    check("mic: the status's Voice here line says which mic it hears with", /^Voice here: hears with Soniox through MacBook Pro Microphone, the output/.test(voiceHereText({ hears: "soniox", mic: micSaid(a), speaks: ["mac"], realtime: "off" })))
  }
  {
    // On a call (electron/calllogic.ts), from made-up mic users: an app for calls or a browser at once, another app once it
    // held the mic a while; never this app, dictation or the system's own; a call ends a grace after its mic stops.
    const { callFrom, callSaid, callShown, GRACE_MS, HELD_MS, LET_GO_MS, STUCK_MS } = await import("../../../electron/calllogic.ts")
    const u = (bundle: string, o: Partial<{ app: string; appBundle: string; chain: number[]; input: boolean; output: boolean; pid: number }> = {}) =>
      ({ pid: 500, bundle, app: "", appBundle: "", chain: [1], input: true, output: false, ...o })
    const own = new Set([42]), t0 = 1_000_000
    let first = new Map<string, number>()
    const zoom = callFrom([u("us.zoom.xos", { app: "zoom.us", appBundle: "us.zoom.xos" })], own, null, first, t0)
    check("call: Zoom opening the mic is a call at once", zoom?.app === "Zoom" && callSaid(zoom) === "on a call in Zoom", zoom)
    first = new Map()
    const meet = callFrom([u("com.google.Chrome.helper", { app: "Google Chrome", appBundle: "com.google.Chrome" })], own, null, first, t0)
    check("call: a browser's helper opening the mic is a call in that browser (Meet)", meet?.app === "Chrome" && meet.bundle === "com.google.Chrome", meet)
    first = new Map()
    const ours = [u("app.vaultite.main.helper", { chain: [42, 1] }), u("", { pid: 77, chain: [60, 42, 1] }), u("com.electron.wispr-flow", { app: "Wispr Flow" }),
      u("com.apple.CoreSpeech"), u("com.apple.assistantd")]
    check("call: never this app (its own processes and their children), dictation apps, nor the system's daemons",
      callFrom(ours, own, null, first, t0) === null && callFrom(ours, own, null, first, t0 + 60_000) === null)
    first = new Map()
    const obs = [u("com.obsproject.obs-studio", { app: "OBS" })]
    check("call: another app holding the mic is one only after a while (a recording), not a moment's use",
      callFrom(obs, own, null, first, t0) === null && callFrom(obs, own, null, first, t0 + HELD_MS - 1) === null && callFrom(obs, own, null, first, t0 + HELD_MS)?.app === "OBS")
    check("call: one let go of the mic before then starts over", (() => { const f = new Map<string, number>(); callFrom(obs, own, null, f, t0); callFrom([], own, null, f, t0 + 1000)
      return callFrom(obs, own, null, f, t0 + HELD_MS) === null })())
    const vm = [u("com.apple.VoiceMemos", { app: "Voice Memos" })], f = new Map<string, number>()
    check("call: Voice Memos recording counts, though it's Apple's", callFrom(vm, own, null, f, t0) === null && callFrom(vm, own, null, f, t0 + HELD_MS)?.app === "Voice Memos")
    const muted = callFrom([], own, zoom, new Map(), t0 + GRACE_MS - 1)
    check("call: its mic stopping keeps the call a grace (a mute), then it ends", muted === zoom && callFrom([], own, zoom, new Map(), t0 + GRACE_MS) === null)
    const playing = callFrom([u("us.zoom.xos", { appBundle: "us.zoom.xos", input: false, output: true })], own, zoom, new Map(), t0 + GRACE_MS * 4)
    check("call: an app for calls still playing the call's sound is still on it (muted for long)", playing?.app === "Zoom" && playing.since === t0, playing)
    const video = callFrom([u("com.google.Chrome.helper", { appBundle: "com.google.Chrome", input: false, output: true })], own, meet, new Map(), t0 + GRACE_MS)
    check("call: a browser playing sound after its call (a video) is no call", video === null, video)
    const both = callFrom([u("us.zoom.xos", { appBundle: "us.zoom.xos" }), u("com.google.Chrome.helper", { appBundle: "com.google.Chrome" })], own, zoom, new Map(), t0 + 5000)
    check("call: keeps its app's name while another opens the mic too", both?.app === "Zoom" && both.since === t0, both)
    // A false call's way out: an app excused (Not a call) is no call till it lets go of the mic; its next hold counts.
    const fox = [u("org.mozilla.firefox", { app: "Firefox", appBundle: "org.mozilla.firefox" })], ex = new Map<string, number>(), ff = new Map<string, number>()
    const foxCall = callFrom(fox, own, null, ff, t0, ex)
    ex.set("org.mozilla.firefox", t0)
    check("call: an app excused is no call while it still holds the mic, the call it was over at once",
      foxCall?.app === "Firefox" && callFrom(fox, own, foxCall, ff, t0 + 1500, ex) === null && callFrom(fox, own, null, ff, t0 + 60_000, ex) === null)
    check("call: excused, another app's call still counts", callFrom([...fox, u("us.zoom.xos", { appBundle: "us.zoom.xos" })], own, null, ff, t0 + 61_000, ex)?.app === "Zoom")
    callFrom([], own, null, ff, t0 + 62_000, ex)
    check("call: a blip off the mic keeps it excused", callFrom(fox, own, null, ff, t0 + 62_000 + LET_GO_MS - 1, ex) === null && ex.has("org.mozilla.firefox"))
    callFrom([], own, null, ff, t0 + 70_000, ex)
    check("call: let go a while, its next hold counts again", !ex.has("org.mozilla.firefox") && callFrom(fox, own, null, ff, t0 + 70_000 + LET_GO_MS, ex)?.app === "Firefox")
    // Held for hours by a browser or another app, it's stuck (a tab never let go), not a call; an app for calls still is.
    const sf = new Map<string, number>(), edge = [u("com.microsoft.edgemac.helper", { appBundle: "com.microsoft.edgemac" })], edgeCall = callFrom(edge, own, null, sf, t0)
    const stuck = callFrom(edge, own, edgeCall, sf, t0 + STUCK_MS)
    const df = new Map<string, number>(), disc = [u("com.hnc.Discord", { appBundle: "com.hnc.Discord" })], hang = callFrom(disc, own, null, df, t0)
    check("call: a browser holding the mic for hours is stuck, no call; Discord for hours is still on one",
      edgeCall?.app === "Edge" && stuck === null && callFrom(disc, own, hang, df, t0 + STUCK_MS * 2)?.app === "Discord", [edgeCall, stuck])
    check("call: apps that keep the mic open all day (Krisp, SoundSource, Wave Link) are never one",
      callFrom([u("ai.krisp.krispMac", { app: "krisp" }), u("com.rogueamoeba.soundsource"), u("com.elgato.WaveLink")], own, null, new Map(), t0 + HELD_MS * 3) === null)
    check("call: its box names the app", callShown("Chrome") === "Quiet: Chrome has your mic" && callShown("a phone call") === "Quiet: you're on a phone call")
  }
  {
    // The display at key-down and at let-go: kept both only when something there came or went (a toast), not a caret.
    const { bitmapsDiffer, THUMB } = await import("../../../electron/helperlogic.ts")
    const page = () => Buffer.alloc(THUMB.w * THUMB.h * 4, 230), cell = (b: Buffer, i: number, v: number) => { b.fill(v, i * 4, i * 4 + 3); return b }
    const toast = page()
    for (let i = 0; i < 12; i++) cell(toast, THUMB.w * 28 + 30 + i, 40)
    check("helper: a toast gone between key-down and let-go is a change; a caret's blink or a clock's tick isn't",
      bitmapsDiffer(page(), toast) && !bitmapsDiffer(page(), cell(page(), 100, 200)) && !bitmapsDiffer(page(), cell(cell(page(), 5, 120), 900, 120)) && !bitmapsDiffer(page(), page()))
  }
  {
    // The summoned exchange's geometry (electron/helperlogic.ts): beside the pointer, its box reachable, the picture.
    const { besidePointer, closeCrop, CLOSE, floatingOver, grownAt, panelAt, pointerBox, reaching, shotCrop, SHOT_MOST } = await import("../../../electron/helperlogic.ts")
    const d = { x: 0, y: 0, width: 1470, height: 956 }
    check("beside: right of and below the pointer; on the other side by an edge", JSON.stringify(besidePointer({ x: 500, y: 400 }, d)) === '{"x":524,"y":420}' &&
      besidePointer({ x: 1460, y: 400 }, d).x < 1460 && besidePointer({ x: 500, y: 950 }, d).y < 950)
    const box = { x: 600, y: 300, width: 300, height: 160 }
    check("reaching: the pointer in the box, or heading for it, holds it; moving elsewhere or barely moving doesn't",
      reaching({ x: 650, y: 320 }, { x: 0, y: 0 }, box) && reaching({ x: 400, y: 380 }, { x: 600, y: 20 }, box) && !reaching({ x: 400, y: 380 }, { x: -600, y: 0 }, box) &&
      !reaching({ x: 400, y: 380 }, { x: 0, y: 600 }, box) && !reaching({ x: 400, y: 380 }, { x: 60, y: 0 }, box))
    const meets = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const misses = [10, 700, 1400].flatMap((x) => [40, 500, 900].map((y) => ({ x, y }))).filter((p) => meets({ ...panelAt(besidePointer(p, d), { width: 300, height: 180 }, { ...d, y: 25, height: 931 }, 100, null, [pointerBox(p)]), width: 300, height: 180 }, pointerBox(p)))
    check("box: the answer's box never covers the user's pointer, anywhere on screen", !misses.length, misses)
    const work = { ...d, y: 25, height: 931 }, grow = (y: number, at: number, h: number) => grownAt({ x: 1300, y }, 100, { width: 300, height: h }, { x: 1280, y: at }, work)
    check("box: growing as its words come, it grows away from its cursor, yet no screen edge ever cuts it",
      grow(400, 390, 300).y === 400 && grow(600, 720, 300).y === 400 && grow(800, 790, 300).y === 656 && grow(60, 170, 300).y === 25 && grow(400, 390, 300).x === 1170, [grow(400, 390, 300), grow(800, 790, 300), grow(60, 170, 300)])
    const crop = shotCrop(d, { x: 766, y: 463 }), whole = shotCrop({ x: 0, y: 0, width: 1280, height: 800 }, { x: 10, y: 10 }), side = shotCrop({ x: -2560, y: -200, width: 2560, height: 1440 }, { x: -100, y: 1200 })
    const fr = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
    const floats = floatingOver([{ window: 1, bundle: "com.acme.utils", name: "Acme", layer: 26, frame: fr(470, 40, 530, 290) }, { window: 2, bundle: "com.example.mail", name: "Mail", layer: 0, frame: fr(0, 0, 900, 700) },
      { window: 3, bundle: "com.apple.dock", name: "Dock", layer: 20, frame: fr(0, 880, 1470, 76) }, { window: 4, bundle: "com.acme.utils", name: "Acme", layer: 25, frame: fr(611, 0, 40, 24) },
      { window: 5, bundle: "app.vaultite", name: "Vaultite", layer: 3, frame: fr(0, 0, 1470, 956), vaultite: true }, { window: 6, bundle: "com.secret.app", name: "Secret", layer: 3, frame: fr(100, 100, 300, 300) },
      { window: 7, bundle: "com.acme.utils", name: "Acme", layer: 26, frame: fr(500, 100, 200, 200), seen: false }, { window: 8, bundle: "com.other.pip", name: "Pip", layer: 3, frame: fr(2000, 100, 400, 300) }],
      d, (w) => w.bundle === "com.secret.app")
    check("screen: what floats over the display is another app's panel, front first; not an ordinary window, the system's, ours, a private app's, a sliver, an unseen one, nor another display's",
      JSON.stringify(floats) === JSON.stringify([{ app: "com.acme.utils", name: "Acme", frame: fr(470, 40, 530, 290) }]), floats)
    check("picture: as much of the display as Claude takes unscaled (a pixel stays a point), around the pointer, inside the display",
      crop.width * crop.height <= SHOT_MOST.pixels && Math.abs(crop.width / crop.height - 1470 / 956) < 0.01 && crop.x <= 766 && crop.x + crop.width >= 766 && crop.y >= 0 && crop.y + crop.height <= 956 &&
      JSON.stringify(whole) === '{"x":0,"y":0,"width":1280,"height":800}' && side.x + side.width === 0 && side.y + side.height === 1240 && side.width * side.height <= SHOT_MOST.pixels, { crop, whole, side })
    // (a closer look: what they drew round with room, else by the pointer, several pixels a point; none no closer)
    const ringed = closeCrop(d, { x: 700, y: 400 }, [{ x: 600, y: 300, width: 60, height: 50 }]), pointed = closeCrop(d, { x: 700, y: 400 }, []), edge = closeCrop(d, { x: 1465, y: 3 }, [])
    const within = (r: { x: number; y: number; width: number; height: number }) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1470 && r.y + r.height <= 956
    check("closer look: round what they drew (with room) or by the pointer, inside the display, at 1.5 to 4 pixels a point and no bigger than Claude takes",
      !!ringed && ringed.crop.x < 600 && ringed.crop.x + ringed.crop.width > 660 && ringed.crop.y < 300 && ringed.crop.y + ringed.crop.height > 350 && ringed.scale === CLOSE.most &&
      !!pointed && JSON.stringify(pointed.crop) === '{"x":550,"y":300,"width":300,"height":200}' && pointed.scale === 3.2 &&
      !!edge && within(edge.crop) && edge.crop.width === 300 && [ringed, pointed, edge].every((c) => !!c && within(c.crop) && c.scale >= 1.5 && c.scale <= 4 &&
        c.crop.width * c.crop.height * c.scale ** 2 <= CLOSE.pixels * 1.01 && Math.max(c.crop.width, c.crop.height) * c.scale <= CLOSE.side + 1) &&
      closeCrop(d, { x: 700, y: 400 }, [{ x: 0, y: 0, width: 1400, height: 900 }]) === null, { ringed, pointed, edge })
  }
  {
    // The companion hears the user on screen: an ask or a point with the window's text, the display's picture, what's near
    // the pointer and what they drew.
    const c = await import("../../../plugins/core/companion/plugin.ts")
    // (its Talk key's own session on, as by default: what an area before set doesn't decide where a summoned ask goes)
    await api("PATCH", "config/plugin/companion", { mode: "quiet", summoned_model: null })
    const ask = c.addMoment({ kind: "ask", text: "what does this error mean?", app: "com.apple.Terminal", window: 42, title: "zsh", screen: "error: no such file\nline two", shot: "/tmp/x/screens/window-42-1.png" })
    const text = ask ? c.momentsText([ask], "quiet", null) : ""
    check("companion: an ask on screen names the app and window, its picture and its text", !!ask && text.includes('on screen, "zsh" in com.apple.Terminal (window 42)') &&
      text.includes("its picture: /tmp/x/screens/window-42-1.png") && text.includes("    error: no such file"), text)
    const desk = c.addMoment({ kind: "ask", text: "what is this folder?", app: "com.apple.finder", sx: 812, sy: 440, under: 'Finder: folder "Taxes", in "Desktop"', shot: "/tmp/x/screens/display-812-1.png", shotAt: { x: 0, y: 0, width: 1600, height: 1000 } })
    const deskText = desk ? c.momentsText([desk], "quiet", null) : ""
    const [, deskSt] = await api("POST", "ops/companion.status", {})
    check("companion: an ask from the desktop (no window) says what was under the pointer, its point, and the display's picture",
      deskText.includes('under their pointer (sx 812, sy 440): Finder: folder "Taxes", in "Desktop"') && deskText.includes("its picture: /tmp/x/screens/display-812-1.png (the screen around their pointer") &&
      (deskSt as { agents?: { sx?: number }[] }).agents?.some((a) => a.sx === 812), [deskText, deskSt])
    const clicked = c.addMoment({ kind: "ask", text: "why is this greyed out?", app: "com.apple.Safari", sx: 820, sy: 40, clicks: [{ sx: 820, sy: 40, under: 'Safari: button "Share"' }, { sx: 5, sy: 6 }] })
    const clickedText = clicked ? c.momentsText([clicked], "quiet", null) : ""
    check("companion: what they clicked with the Talk key held goes with the ask, each click the app's",
      clickedText.includes('they clicked as they spoke (each went to the app as a click; the picture may show what it did): Safari: button "Share" at sx 820, sy 40; something at sx 5, sy 6'), clickedText)
    const bar = c.addMoment({ kind: "point", sx: 1290, sy: 12, shot: "/tmp/x/screens/region-2.png" })
    const barText = bar ? c.momentsText([bar], "quiet", null) : ""
    const [, barSt] = await api("POST", "ops/companion.status", {})
    check("companion: a point where nothing reads (the menu bar) is still a point there, with its picture",
      barText.includes("on screen, at sx 1290, sy 12 (no window there") && barText.includes("its picture: /tmp/x/screens/region-2.png") &&
      (barSt as { agents?: { sx?: number }[] }).agents?.some((a) => a.sx === 1290), [barText, barSt])
    // (the summoned companion's ask: the display's picture, what's near the pointer by id, what they drew)
    const held = c.screenMoment({ kind: "ask", text: "what's this button?", app: "com.example.mail", window: 9, title: "Inbox", sx: 812, sy: 440, shot: "/tmp/x/screens/display-812-1.png",
      shotAt: { x: 0, y: 0, width: 1600, height: 1000 }, near: [{ id: "a1", role: "button", label: "Send", frame: { x: 790, y: 430, width: 60, height: 24 } }],
      ink: [{ shape: "ring", box: { x: 770, y: 410, width: 100, height: 60 }, points: [[770, 440], [820, 410], [870, 440]] }] })
    const heldText = held ? c.momentsText([held], "quiet", null) : ""
    check("companion: a summoned ask says the display's picture and their pointer in it, what they drew and what's near, by id",
      heldText.includes("its picture: /tmp/x/screens/display-812-1.png (the screen around their pointer, cropped: what its edges cut is whole on their screen; a pixel a point: its top left is sx 0, sy 0, so its pixel x, y is sx 0 + x, sy 0 + y; their pointer at 812, 440 in it)") &&
      heldText.includes("they drew a ring round sx 770-870, sy 410-470") && heldText.includes('a1 button "Send" at 790,430 60×24'), heldText)
    const name = (barSt as { agents: { name: string; sx?: number }[] }).agents.find((a) => a.sx === 1290)!.name
    const [axSt] = await api("POST", "ops/companion.look", { ax: "a1", as: name })
    const [, axIs] = await api("POST", "ops/companion.status", {})
    const pointed = (axIs as { agents: { name: string; sx?: number; sy?: number; frame?: { x: number } }[] }).agents.find((a) => a.name === name)
    check("companion: --ax points at an element of the ask's list, snapped to its frame; an id not listed is a 404",
      axSt === 200 && pointed?.sx === 806 && pointed?.sy === 442 && pointed?.frame?.x === 790 && (await api("POST", "ops/companion.look", { ax: "a9" }))[0] === 404, [axSt, pointed])
    // (a floating panel of another app: asked over, named by its app's name; behind the ask, said as what floats there)
    const tray = c.screenMoment({ kind: "ask", text: "what is this?", app: "com.acme.utils", appName: "Acme", sx: 535, sy: 125, under: "Acme: list" })
    const trayText = tray ? c.momentsText([tray], "pair", null) : ""
    const behind = c.screenMoment({ kind: "ask", text: "what's that thing?", app: "com.example.mail", appName: "Mail", window: 9, sx: 240, sy: 183,
      floating: [{ app: "com.acme.utils", name: "Acme", frame: { x: 470, y: 40, width: 530, height: 290 } }] })
    const behindText = behind ? c.momentsText([behind], "pair", null) : ""
    check("companion: an app on screen is named by its name and bundle id, and another app's panel floating over the screen is said, by whose",
      trayText.includes("The user is in Acme (com.acme.utils)") && trayText.includes("on screen, Acme (com.acme.utils)") &&
      behindText.includes("floating over the screen (another app's panel, maybe what they mean): Acme (com.acme.utils) at sx 470, sy 40, 530×290"), [trayText, behindText])
    // (over Vaultite's own window: the page's place there, a note's line, as asked there, with the display's picture)
    const there = c.screenMoment({ kind: "ask", text: "what's this line?", path: "Notes/A.md", line: 3, selection: "the plan", sx: 400, sy: 300, shot: "/tmp/x/screens/display-400-1.png",
      shotAt: { x: 0, y: 0, width: 1600, height: 1000 } })
    check("companion: a summoned ask over Vaultite's window is about the note's line under the pointer, its picture too",
      there?.path === "Notes/A.md" && there.line === 3 && there.selection === "the plan" && there.summoned === true && there.shot === "/tmp/x/screens/display-400-1.png" && !there.app, there)
    c.comeBack(name)
    const [, homeSt] = await api("POST", "ops/companion.status", {})
    check("companion: done there, its cursor leaves the screen", !(homeSt as { agents?: { sx?: number; app?: string }[] }).agents?.some((a) => a.sx !== undefined || a.app), homeSt)
    {
      // (back in the window: by their note only while it's on screen; one in a tab behind sent it to a file's row, far off)
      const { EventEmitter } = await import("node:events")
      type Got = { t: string; id?: string; agent?: string; note?: { id: string; answers?: object }; said?: { id?: string; text?: string; seen?: boolean }[] }
      const live = c.plugin.sockets.find((x: { pattern: string[] }) => x.pattern.join("/") === "companion/live")!
      const sock = (screen: boolean) => {
        const got: Got[] = []
        const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got, close() {}, ping() {}, terminate() {}, send(t: string) { got.push(JSON.parse(t)) } })
        live.fn(ws as never, { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as never, { query: screen ? { screen: "1" } : {}, wild: [] })
        return ws
      }
      const win = sock(false), where = (shown: string[]) => win.emit("message", Buffer.from(JSON.stringify({ t: "where", open: ["Notes/A.md"], shown, focus: { path: "Notes/A.md", line: 3 }, active: true })))
      const placed = async () => ((await api("POST", "ops/companion.status", {}))[1] as { agents: { name: string; path?: string }[] }).agents.find((a) => a.name === name)
      // (the ask over the window above, its session a stand-in, is answered late: wait for that turn to end first)
      await waitFor(async () => ((await api("POST", "ops/companion.status", {}))[1] as { notes: { kind: string; t: number }[] }).notes.some((n) => n.kind === "say" && n.t >= (there?.t ?? 0)), 8000, 100)
      where([]); c.comeBack(name)
      const behind = await placed()
      where(["Notes/A.md"]); c.comeBack(name)
      const shown = await placed()
      check("companion: back from the screen, by their note when it's shown, else home (never a tab behind's file row)", !!behind && !behind.path && shown?.path === "Notes/A.md", [behind, shown])
      check("companion: …moved there, not acting: its cursor rests at home", (shown as { rests?: boolean } | undefined)?.rests === true, shown)
      // (an exchange's answers were said by the pointer or in its box: once it's over, no window shows them again)
      const helper = sock(true)
      helper.emit("message", JSON.stringify({ t: "riding", agent: name }))
      helper.emit("message", JSON.stringify({ t: "answered", agent: name, heard: "how are you", said: "I'm good." }))
      const answer = win.got.filter((m) => m.t === "note").at(-1)?.note
      // (a summoned ask, its answer by the pointer: here, that its session can't start)
      c.addMoment({ kind: "ask", for: name, summoned: true, text: "open my page" })
      const late = () => win.got.find((m) => m.t === "note" && m.note?.id !== answer?.id && m.note?.answers)?.note
      for (let i = 0; i < 100 && !late(); i++) await $.sleep(50)
      helper.emit("message", JSON.stringify({ t: "riding", agent: "" }))
      const dropped = win.got.findIndex((m) => m.t === "drop" && m.id === answer?.id), over = win.got.findIndex((m) => m.t === "riding" && m.agent === "")
      const kept = win.got.filter((m) => m.t === "said").at(-1)?.said ?? []
      check("companion: its exchange over, its answers there leave the windows before its cursor shows there, kept in its history",
        !!answer && dropped >= 0 && dropped < over && kept.some((n) => n.text === "I'm good."), { answer, got: win.got.slice(-4) })
      const theirs = kept.find((n) => n.id === late()?.id)
      check("companion: …and seen there (by the pointer, in its box), so no unread dot for them", !!theirs?.seen, theirs)
      helper.emit("close"); win.emit("close")
    }
    check("companion: in quiet no edit reaches it, nor does the helper send one (it follows nothing on screen)", c.addMoment({ kind: "edit", path: "Notes/A.md", hunks: [] }) === null &&
      c.screenMoment({ kind: "edit", app: "com.apple.Terminal", window: 42, hunks: [{ line: 3, removed: [], added: ["ok"] }] }) === null)
    await api("PATCH", "config/plugin/companion", { mode: null })
  }
  {
    // The screen plugin: what's in front as the desktop app tells it (a private app: only that), and reading refused
    // with no desktop app attached.
    const front = () => api("POST", "ops/screen.front", {})
    let [, r] = await front()
    check("screen: nothing in front before the desktop app says", (r as { none?: boolean }).none === true, r)
    process.emit("message", { type: "desktop:event", name: "screen:front", data: { bundle: "com.apple.Safari", name: "Safari", title: "Inbox", window: 7 } }, undefined)
    ;[, r] = await front()
    check("screen: the app in front and its window's title", (r as { title?: string }).title === "Inbox" && (r as { app?: string }).app === "com.apple.Safari", r)
    process.emit("message", { type: "desktop:event", name: "screen:front", data: { bundle: "com.1password.1password", name: "1Password", title: "Bank login", window: 8 } }, undefined)
    ;[, r] = await front()
    check("screen: a private app in front is only that, no title", (r as { private?: boolean }).private === true && !JSON.stringify(r).includes("Bank"), r)
    const [st] = await api("POST", "ops/screen.text", {})
    check("screen: reading a window needs this Mac's desktop app", st === 409, st)
  }
  // screen.swift built and asked what costs nothing: no key tap (that's `fn`), no app's Accessibility tree.
  let tools = process.platform === "darwin"
  try { if (tools) execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore" }) } catch { tools = false }
  if (tools) {
    const { screenSwift } = await import("../../../electron/swiftbuild.ts")
    const bin = await screenSwift.build(path.join(tmp, "screen-helper"))
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
    const lines: Record<string, unknown>[] = []
    let buf = ""
    child.stdout.on("data", (b: Buffer) => { buf += b; for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) try { lines.push(JSON.parse(buf.slice(0, i))) } catch { /* not JSON */ } })
    child.stdin.write(['{"op":"trusted","id":1}', '{"op":"at","x":-100000,"y":-100000,"id":2}', '{"op":"window","window":2147483000,"id":3}', '{"op":"nope","id":4}', '{"op":"watch","windows":[2147483000],"id":5}'].join("\n") + "\n")
    for (let i = 0; i < 100 && lines.filter((l) => typeof l.id === "number").length < 5; i++) await new Promise((r) => setTimeout(r, 50))
    child.stdin.end()
    const by = (id: number) => lines.find((l) => l.id === id)
    check("screen helper: answers whether it's trusted, no window off every screen, none by an unknown number, and says an op is unknown",
      typeof by(1)?.trusted === "boolean" && by(2)?.window === 0 && by(3)?.window === 0 && by(4)?.error === "unknown op", lines)
    check("screen helper: watching a window that isn't there is no error", by(5)?.ok === true, lines)
    check("screen helper: tells what's in front unasked, metadata only", lines.some((l) => l.event === "front" && typeof l.bundle === "string" && !("text" in l)), lines)
    check("screen helper: never taps the keyboard unless asked", !lines.some((l) => l.event === "tap"))
  }
}
