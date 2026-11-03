import { execFileSync, spawn } from "node:child_process"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, tmp } = $
  // The menu-bar helper (electron/helper.ts): fn as ⌘J, the overlay's scene, the screen plugin and the companion's
  // screen moments. Its native part (screen.swift) only answers here: no key is tapped, no app's tree is woken.
  {
    const { fnKey, fnActsToo } = await import("../../../core/fnkey.ts")
    const k = fnKey(450)
    const tap = [k.down(0, false), k.up(100)], again = [k.down(1000, true), k.up(1100)], held = [k.down(2000, false), k.up(2600)]
    check("fn: a tap starts and leaves it listening, the next press stops; held, it stops when let go",
      tap.join() === "start," && again.join() === "stop," && held.join() === "start,stop", { tap, again, held })
    const combo = [k.down(3000, false), k.other(), k.up(3100)]
    check("fn: a key pressed with it (fn+arrow) cancels what its press started, and nothing else", combo.join() === "start,cancel," && fnKey().other() === null, combo)
    check("fn: macOS's globe key acts too unless it's set to Do nothing", fnActsToo(null) && fnActsToo("2") && !fnActsToo("0\n"))
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
    const { hunksOf, pointIn, prefsOf, sceneFor } = await import("../../../electron/helperlogic.ts")
    const defaults = { dictation: { fn: { default: true } }, companion: { screen_cursor: { default: "dock" } }, screen: { private_apps: { default: ["1Password"] } } }
    const none = prefsOf({}, {}, {}, defaults), set = prefsOf({ fn: false }, { screen_cursor: "trail" }, { private_apps: [] }, defaults)
    check("helper: settings left out are the manifests' defaults; set ones win, an empty private list too",
      none.fn && none.cursor === "dock" && none.privateApps.join() === "1Password" && !set.fn && set.cursor === "trail" && set.privateApps.length === 0, { none, set })
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
    child.stdin.write(['{"op":"trusted","id":1}', '{"op":"at","x":-100000,"y":-100000,"id":2}', '{"op":"window","window":2147483000,"id":3}', '{"op":"nope","id":4}'].join("\n") + "\n")
    for (let i = 0; i < 100 && lines.filter((l) => typeof l.id === "number").length < 4; i++) await new Promise((r) => setTimeout(r, 50))
    child.stdin.end()
    const by = (id: number) => lines.find((l) => l.id === id)
    check("screen helper: answers whether it's trusted, no window off every screen, none by an unknown number, and says an op is unknown",
      typeof by(1)?.trusted === "boolean" && by(2)?.window === 0 && by(3)?.window === 0 && by(4)?.error === "unknown op", lines)
    check("screen helper: tells what's in front unasked, metadata only", lines.some((l) => l.event === "front" && typeof l.bundle === "string" && !("text" in l)), lines)
    check("screen helper: never taps the keyboard unless asked", !lines.some((l) => l.event === "tap"))
  }
}
