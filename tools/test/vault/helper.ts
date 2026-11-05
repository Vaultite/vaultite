import { execFileSync, spawn, spawnSync } from "node:child_process"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, tmp } = $
  // The menu-bar helper (electron/helper.ts): fn as ⌘J, the overlay's scene, the screen plugin and the companion's
  // screen moments. Its native part (screen.swift) only answers here: no key is tapped, no app's tree is woken.
  {
    const { fnKey, fnActsToo, controlActsToo, keyCodes, modKeys } = await import("../../../core/fnkey.ts")
    const k = fnKey(450)
    const tap = [k.down(0, false), k.up(100)], again = [k.down(1000, true), k.up(1100)], held = [k.down(2000, false), k.up(2600)]
    check("fn: a tap starts and leaves it listening, the next press stops; held, it stops when let go",
      tap.join() === "start," && again.join() === "stop," && held.join() === "start,stop", { tap, again, held })
    const combo = [k.down(3000, false), k.other(), k.up(3100)]
    check("fn: a key pressed with it (fn+arrow) cancels what its press started, and nothing else", combo.join() === "start,cancel," && fnKey().other() === null, combo)
    check("fn: macOS's globe key acts too unless it's set to Do nothing", fnActsToo(null) && fnActsToo("2") && !fnActsToo("0\n"))

    const ALL = ["fn", "right_option", "right_command", "double_control"]
    const CTRL = 59, ROPT = 61, RCMD = 54, LOPT = 58
    type Step = { code?: number; on?: boolean; alone?: boolean; at?: number; other?: boolean }
    const run = (steps: Step[], keys = ALL) => { const m = modKeys(keys); return steps.map((s) => m.heard(s)) }
    const fired = (steps: Step[], keys = ALL) => run(steps, keys).filter((r) => r.twice).length
    const press = (at: number, code = CTRL, long = 50): Step[] => [{ code, on: true, alone: true, at }, { code, on: false, alone: false, at: at + long }]
    const two = [...press(0), ...press(150)]
    const double = run(two).at(-1)!
    check("double Control: two quick taps are one tap of fn, on the second's release",
      double.twice === true && JSON.stringify(double.fn) === '[{"down":true},{"down":false}]' && run(two).slice(0, 3).every((r) => !r.fn.length), double)
    check("double Control: either side, the two sides mixed too", fired([...press(0, 62), ...press(150, 62)]) === 1 && fired([...press(0, 59), ...press(150, 62)]) === 1)
    check("double Control: a slow press isn't a tap, nor is a gap too long", fired([...press(0, CTRL, 500), ...press(600)]) === 0 && fired([...press(0), ...press(150, CTRL, 500)]) === 0 && fired([...press(0), ...press(1000)]) === 0)
    check("double Control: a shortcut between isn't one, a key or another modifier", fired([...press(0), { other: true }, ...press(100)]) === 0 &&
      fired([...press(0), { code: LOPT, on: true, alone: true, at: 70 }, { code: LOPT, on: false, at: 80 }, ...press(100)]) === 0 &&
      fired([{ code: CTRL, on: true, alone: true, at: 0 }, { other: true }, { code: CTRL, on: false, at: 40 }, ...press(100)]) === 0)
    check("double Control: with another modifier held, or both sides at once, it isn't one",
      fired([{ code: CTRL, on: true, alone: false, at: 0 }, { code: CTRL, on: false, at: 40 }, ...press(100)]) === 0 &&
      fired([{ code: 59, on: true, alone: true, at: 0 }, { code: 62, on: true, alone: false, at: 10 }, { code: 62, on: false, at: 20 }, { code: 59, on: false, at: 30 }, ...press(100)]) === 0)
    check("double Control: a third tap does nothing, a fourth neither; after a pause it works again",
      fired([...two, ...press(350)]) === 1 && fired([...two, ...press(350), ...press(600)]) === 1 && fired([...two, ...press(350), ...press(1500), ...press(1650)]) === 2)
    check("double Control: held isn't a tap", fired([...press(0), { code: CTRL, on: true, alone: true, at: 150 }, { code: CTRL, on: false, at: 2000 }]) === 0)

    const solo = (code: number) => { const m = modKeys(ALL); return { m, down: m.heard({ code, on: true, alone: true, at: 0 }), up: () => m.heard({ code, on: false, at: 100 }).fn } }
    const quick = solo(ROPT), quickUp = quick.up()
    check("right Option: it waits to see it's alone; let go first, it's a tap of fn", quick.down.wait === true && !quick.down.fn.length && JSON.stringify(quickUp) === '[{"down":true},{"down":false}]', quickUp)
    const long = solo(RCMD), settled = long.m.settled(), heldUp = long.up()
    check("right Command: still alone, it's fn down, then up when let go", JSON.stringify(settled) === '[{"down":true}]' && JSON.stringify(heldUp) === '[{"down":false}]', { settled, heldUp })
    const chord = solo(ROPT), chordKey = chord.m.heard({ other: true }).fn, chordSettled = chord.m.settled(), chordUp = chord.up()
    check("right Option + a key: nothing, it still types its accent", !chordKey.length && !chordSettled.length && !chordUp.length, { chordKey, chordSettled, chordUp })
    const slow = solo(ROPT), slowDown = slow.m.settled(), slowKey = slow.m.heard({ other: true }).fn, slowUp = slow.up()
    check("right Option + a key after it counted: that press is cancelled, as fn+key is", JSON.stringify(slowDown) === '[{"down":true}]' && JSON.stringify(slowKey) === '[{"other":true}]' && !slowUp.length, { slowKey, slowUp })
    const left = modKeys(ALL), leftDown = left.heard({ code: LOPT, on: true, alone: true, at: 0 })
    check("left Option: not a trigger", !leftDown.wait && !leftDown.fn.length && !left.settled().length && !left.heard({ code: LOPT, on: false, at: 100 }).fn.length)
    const withShift = modKeys(ALL), shifted = withShift.heard({ code: RCMD, on: true, alone: false, at: 0 })
    check("right Command with another modifier held: not a trigger", !shifted.wait && !withShift.settled().length && !withShift.heard({ code: RCMD, on: false, at: 100 }).fn.length)
    const both = modKeys(ALL)
    both.heard({ code: ROPT, on: true, alone: true, at: 0 })
    const second = both.heard({ code: RCMD, on: true, alone: false, at: 20 })
    check("right Option and Command together: neither", !second.wait && !both.settled().length && !both.heard({ code: ROPT, on: false, at: 50 }).fn.length && !both.heard({ code: RCMD, on: false, at: 60 }).fn.length)
    const defaults = ["fn", "double_control"], off = modKeys(defaults), offDown = off.heard({ code: ROPT, on: true, alone: true, at: 0 })
    check("a key not picked: not a trigger; double Control, unpicked, neither", !offDown.wait && !off.settled().length && !off.heard({ code: ROPT, on: false, at: 100 }).fn.length && fired(two, ["fn", "right_option"]) === 0 && fired(two, defaults) === 1)
    check("the tap hears the picked keys' codes", keyCodes(ALL).join() === "63,61,54,59,62" && keyCodes(["nope"]).length === 0 && keyCodes([]).length === 0)

    const hotKey = (type: string, modifiers: number, enabled = true) => JSON.stringify({ enabled, value: { type, parameters: [modifiers, modifiers] } })
    check("macOS's dictation shortcut as Control twice: it acts too; anything else doesn't",
      controlActsToo(hotKey("modifier", 0x40000), "1") && controlActsToo(hotKey("modifier", 0x40000), null) &&
      !controlActsToo(hotKey("modifier", 0x100008), "1") && !controlActsToo(hotKey("standard", 0x140000), "1") && !controlActsToo(hotKey("modifier", 0x40000, false), "1") &&
      !controlActsToo(hotKey("modifier", 0x40000), "0\n") && !controlActsToo(null, "1") && !controlActsToo("not json", "1"))
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
    const { hunksOf, pointIn, prefsOf, sceneFor, splitScene } = await import("../../../electron/helperlogic.ts")
    const defaults = { dictation: { fn: { default: true }, keys: { default: ["fn", "double_control"] } }, companion: { screen_cursor: { default: "dock" } }, screen: { private_apps: { default: ["1Password"] } } }
    const none = prefsOf({}, {}, {}, defaults), set = prefsOf({ fn: false, keys: ["right_option"] }, { screen_cursor: "trail" }, { private_apps: [] }, defaults)
    check("helper: settings left out are the manifests' defaults; set ones win, an empty private list too",
      none.fn && none.keys.join() === "fn,double_control" && set.keys.join() === "right_option" && none.cursor === "dock" && none.privateApps.join() === "1Password" && !set.fn && set.cursor === "trail" && set.privateApps.length === 0, { none, set })
    check("helper: it points at an element by its left edge's middle, at a window by its title bar",
      JSON.stringify(pointIn({ x: 100, y: 200, width: 80, height: 20 }, true)) === '{"x":116,"y":210}' &&
      JSON.stringify(pointIn({ x: 0, y: 30, width: 800, height: 600 }, false)) === '{"x":400,"y":42}')
    const h = hunksOf(["a", "b", "c"], ["a", "B", "c", "d"])
    check("helper: a followed window's change reads as hunks", h.length === 2 && h[0].line === 2 && h[0].removed[0] === "b" && h[0].added[0] === "B" && h[1].added[0] === "d", h)
    const left = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }, right = { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    const scene = { agents: [{ name: "Claude", tint: "orange", state: "thinking", sx: 1500, sy: 100 }], idle: { name: "Claude", tint: "orange", sx: 978, sy: 266, docked: true },
      pill: { level: 0.5, text: "hello", ready: true, display: 2 } }
    const l = sceneFor(left, scene, { x: 10, y: 10 }, [left, right]), r = sceneFor(right, scene, { x: 10, y: 10 }, [left, right])
    check("helper: each display draws what's on it, in its own points; the pill on its field's display",
      !l.agents.length && l.idle?.sx === 978 && !l.pill && r.agents[0]?.sx === 500 && !r.idle && r.pill?.text === "hello", { l, r })
    const noField = sceneFor(left, { ...scene, pill: { ...scene.pill, display: 9 } }, { x: 10, y: 10 }, [left, right])
    check("helper: with no field's display, the pill is on the pointer's", !!noField.pill)
    const crossing = { ...scene, agents: [{ ...scene.agents[0], from: { x: 900, y: 100 } }] }
    const cl = sceneFor(left, crossing, { x: 10, y: 10 }, [left, right]), cr = sceneFor(right, crossing, { x: 10, y: 10 }, [left, right])
    check("helper: a cursor on its way from one display to another is drawn on both, each in its own points",
      cl.agents[0]?.sx === 1500 && cl.agents[0]?.from?.x === 900 && cr.agents[0]?.sx === 500 && cr.agents[0]?.from?.x === -100, { cl, cr })
    const a = splitScene(r), moved = splitScene({ ...r, agents: [{ ...r.agents[0], sx: 510, from: { x: 1, y: 2 } }] }), said = splitScene({ ...r, agents: [{ ...r.agents[0], say: { id: "s1", text: "hi" } }] })
    check("helper: a cursor that only moved sends only its place; one that says something, the whole scene",
      a.shape === moved.shape && JSON.stringify(moved.at.agents) === '{"Claude":[510,100]}' && a.shape !== said.shape, { a, moved })
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
    // The companion hears the user on screen: an ask or a point with the window's text and picture, a change of a window
    // it follows (in quiet too: they dropped its cursor there).
    const c = await import("../../../plugins/core/companion/plugin.ts")
    await api("PATCH", "config/plugin/companion", { mode: "quiet" })
    const ask = c.addMoment({ kind: "ask", text: "what does this error mean?", app: "com.apple.Terminal", window: 42, title: "zsh", screen: "error: no such file\nline two", shot: "/tmp/x/screens/window-42-1.png" })
    const edit = c.addMoment({ kind: "edit", app: "com.apple.Terminal", window: 42, hunks: [{ line: 3, removed: [], added: ["ok"] }] })
    const text = ask ? c.momentsText([ask], "quiet", null) : ""
    check("companion: an ask on screen names the app and window, its picture and its text", !!ask && text.includes('on screen, "zsh" in com.apple.Terminal (window 42)') &&
      text.includes("its picture: /tmp/x/screens/window-42-1.png") && text.includes("    error: no such file"), text)
    const desk = c.addMoment({ kind: "ask", text: "what is this folder?", app: "com.apple.finder", sx: 812, sy: 440, under: 'Finder: folder "Taxes", in "Desktop"', shot: "/tmp/x/screens/region-1.png" })
    const deskText = desk ? c.momentsText([desk], "quiet", null) : ""
    const [, deskSt] = await api("POST", "ops/companion.status", {})
    check("companion: an ask from the desktop (no window) says what was under the pointer, its point, and the screen around it",
      deskText.includes('under their pointer (sx 812, sy 440): Finder: folder "Taxes", in "Desktop"') && deskText.includes("its picture: /tmp/x/screens/region-1.png (the screen around their pointer)") &&
      (deskSt as { agents?: { sx?: number }[] }).agents?.some((a) => a.sx === 812), [deskText, deskSt])
    check("companion: a followed window's change reaches it in quiet; a note's doesn't", edit?.kind === "edit" && c.addMoment({ kind: "edit", path: "Notes/A.md", hunks: [] }) === null)
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
    const { buildScreen } = await import("../../../electron/screen-build.ts")
    const bin = await buildScreen(path.join(tmp, "screen-helper"))
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
