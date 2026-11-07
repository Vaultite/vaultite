import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  // Take-over (electron/takeover.ts, takeover.swift; plugins/core/companion/takeover.ts): the companion acting in another
  // app. Its rules apart from the Mac, then act's way to the helper and back with a stand-in helper; nothing is clicked.
  const L = await import("../../../electron/takeoverlogic.ts")
  const T = await import("../../../plugins/core/companion/takeover.ts")
  const frame = { x: 100, y: 200, width: 80, height: 30 }, el = { frame, role: "button", label: "Save" }
  const mail = { ok: true, bundle: "com.example.mail", name: "Mail", role: "AXButton", actions: ["AXPress"] }
  const none = () => false, priv = (a: { bundle: string }) => a.bundle === "com.example.diary"
  check("takeover: Vaultite's own windows, private apps, password fields and words like a key are refused",
    /Vaultite's own/.test(L.refusal({ action: "click", el }, { ...mail, vaultite: true }, none) ?? "") &&
    /private/.test(L.refusal({ action: "click", el }, { ...mail, bundle: "com.example.diary" }, priv) ?? "") &&
    /password/.test(L.refusal({ action: "fill", el, value: "x" }, { ...mail, secure: true }, none) ?? "") &&
    /key or a password/.test(L.refusal({ action: "type", value: "my key is sk-abcdefghijklmnopqrstuv" }, mail, none) ?? "") &&
    L.refusal({ action: "click", el }, mail, none) === null && L.refusal({ action: "type", value: "Lighthouse" }, mail, none) === null)
  check("takeover: Esc is the user's, an unknown step or a gone element says why",
    /Esc/.test(L.refusal({ action: "press", key: "Escape" }, mail, none) ?? "") && /no step/.test(L.refusal({ action: "drag" }, mail, none) ?? "") &&
    /isn't there/.test(L.refusal({ action: "click", el }, { ok: false, why: "gone" }, none) ?? ""))
  check("takeover: a send, a post or a delete is asked each time, naming it; Return sends only in a messenger",
    L.outward({ action: "click", el: { ...el, label: "Send" } }, mail) === `Press "Send" in Mail?` && L.outward({ action: "click", el }, mail) === null &&
    L.outward({ action: "press", key: "Enter" }, { ...mail, bundle: "com.apple.MobileSMS", name: "Messages" }) === "Send it in Messages?" &&
    L.outward({ action: "press", key: "Enter" }, { ...mail, bundle: "com.apple.TextEdit" }) === null)
  check("takeover: Return in any field or page, a new line typed, cmd+Delete and a wordless button in a page are asked each time",
    L.outward({ action: "press", key: "Return" }, { ...mail, bundle: "com.google.Chrome", name: "Chrome", role: "AXGroup", web: true }) === "Send it in Chrome?" &&
    L.outward({ action: "press", key: "Enter" }, { ...mail, role: "AXTextArea" }) === "Send it in Mail?" &&
    L.outward({ action: "type", value: "hi\nthere" }, mail) === "Type it and send it in Mail?" && L.outward({ action: "type", value: "hi there" }, mail) === null &&
    L.outward({ action: "press", key: "cmd+Backspace" }, mail) === "Delete it in Mail?" && L.outward({ action: "press", key: "Backspace" }, mail) === null &&
    L.outward({ action: "click", el: { ...el, label: "" } }, { ...mail, label: "", bundle: "com.apple.Safari", name: "Safari" }) === "Press that button in Safari?" &&
    L.outward({ action: "click", el: { ...el, label: "" } }, { ...mail, label: "", bundle: "com.apple.calculator" }) === null)
  const ops = (plan: Any[][]) => plan.map((a) => a.map((c: Any) => c.op).join("+")).join(" | ")
  check("takeover: a click presses its element (Accessibility) before the pointer; a point is only clicked",
    ops(L.plan({ action: "click", el }, mail)) === "press | click" && ops(L.plan({ action: "click", at: { x: 5, y: 6 } }, mail)) === "click" &&
    L.plan({ action: "click", el }, mail)[1][0].x === 140 && ops(L.plan({ action: "dblclick", el }, mail)) === "press | click" &&
    L.plan({ action: "dblclick", el }, mail)[0][0].action === "AXOpen", L.plan({ action: "click", el }, mail))
  const scrolled = L.plan({ action: "scroll", direction: "down" }, { ...mail, frame: { x: 0, y: 40, width: 900, height: 24 } })[0][0]
  check("takeover: a point is acted at itself, not the middle of what's there; a scroll with no place goes where their pointer is",
    L.plan({ action: "click", at: { x: 5, y: 6 } }, { ...mail, frame: { x: 0, y: 0, width: 1400, height: 900 } })[0][0].x === 5 &&
    scrolled.op === "scroll" && scrolled.x === undefined && Number(scrolled.dy) < 0 && L.spotOf({ action: "scroll" }, mail) === null &&
    L.plan({ action: "scroll", el, direction: "up" }, mail)[0][0].x === 140 && Number(L.plan({ action: "scroll", el, direction: "up" }, mail)[0][0].dy) > 0, scrolled)
  check("takeover: a step through Accessibility needs nothing of their hands; the pointer and the keys wait for them",
    L.kindOf("press") === "ax" && L.kindOf("set") === "ax" && L.kindOf("focus") === "ax" && L.kindOf("click") === "pointer" && L.kindOf("scroll") === "pointer" &&
    L.kindOf("hover") === "pointer" && L.kindOf("type") === "keys" && L.kindOf("key") === "keys" && L.types({ action: "fill" }) && !L.types({ action: "click" }))
  check("takeover: each step's caption says what it does, its own words first, at most 52 characters",
    L.intentOf({ action: "click", el: { ...el, label: "Files" } }, mail) === "Clicking Files" && L.intentOf({ action: "fill", el: { ...el, label: "Title" }, value: "x" }, mail) === "Typing in Title" &&
    L.intentOf({ action: "type", value: "Lighthouse" }, mail) === 'Typing "Lighthouse"' && L.intentOf({ action: "press", key: "cmd+s" }, mail) === "Pressing ⌘S" &&
    L.intentOf({ action: "scroll", direction: "up" }, mail) === "Scrolling up" && L.intentOf({ action: "click", at: { x: 1, y: 2 } }, { ...mail, label: "" }) === "Clicking here" &&
    L.intentOf({ action: "fill", el, value: "x", doing: "Typing the title" }, mail) === "Typing the title" && L.intentOf({ action: "click", el, doing: "x".repeat(80) }, mail).length === 52 &&
    L.intentOf({ action: "click", el: { ...el, label: "A very long label that goes on and on past thirty" } }, mail) === "Clicking here")
  // Behind their windows: the step ladder and its read-back (the Mac's half is takeover.swift, tried by hand).
  const win = { ok: true, pid: 42, window: 7, name: "TextEdit", frame: { x: 100, y: 100, width: 400, height: 200 }, front: false, covered: 1, behind: true }
  check("takeover behind: an app not open, hidden, windowless or Vaultite itself says why; their own front app in view is done in front",
    /isn't open/.test(L.behindRefusal("Notes", { ok: false, why: "not-running" }) ?? "") && /hidden/.test(L.behindRefusal("Notes", { ok: false, why: "hidden", name: "Notes" }) ?? "") &&
    /no window/.test(L.behindRefusal("Notes", { ok: false, why: "no-window" }) ?? "") && /Vaultite itself/.test(L.behindRefusal("Vaultite", { ok: true, vaultite: true }) ?? "") &&
    L.behindRefusal("TextEdit", win) === null && !L.inFront(win) && L.inFront({ ...win, front: true, covered: 0 }) && !L.inFront({ ...win, front: true, covered: 0.4 }))
  check("takeover behind: Accessibility first, then events sent to its window; a hover (the real pointer's) isn't done behind",
    ops(L.behindPlan({ action: "click", el, app: "Mail" }, mail)) === "press | click" && ops(L.behindPlan({ action: "hover", el, app: "Mail" }, mail)) === "" &&
    ops(L.behindPlan({ action: "type", value: "hi", app: "Mail" }, mail)) === "type")
  check("takeover behind: a step counts as done only when read back: its field's value, its state, else its window changed",
    L.verified({ action: "fill", value: "Lighthouse" }, { value: "" }, { value: "Lighthouse" }) && !L.verified({ action: "fill", value: "Lighthouse" }, { digest: "a" }, { digest: "b", value: "Light" }) &&
    L.verified({ action: "type", value: "x" }, { value: "ab" }, { value: "axb" }) && L.verified({ action: "check" }, {}, { checked: true }) && !L.verified({ action: "uncheck" }, {}, { checked: true }) &&
    L.verified({ action: "click" }, { digest: "a" }, { digest: "b" }) && !L.verified({ action: "click" }, { digest: "a" }, { digest: "a" }) && !L.verified({ action: "press", key: "Enter" }, {}, {}))
  check("takeover behind: its card's cursor is where the step acts, as fractions of the window, kept inside it",
    JSON.stringify(L.cursorIn({ x: 300, y: 150 }, win.frame)) === '{"x":0.5,"y":0.25}' && L.cursorIn({ x: 0, y: 900 }, win.frame)?.y === 1 && L.cursorIn(null, win.frame) === null &&
    /Bring it forward/.test(L.unsureLine("TextEdit")))
  check("takeover behind: act's step carries the app and the words, and its answer says it was done behind and read back",
    T.stepOf({ action: "click", app: " Calculator ", find: "7", role: "button" }, []).app === "Calculator" && T.stepOf({ action: "click", app: "Calculator", find: "7" }, []).find === "7" &&
    T.stepOf({ action: "click", find: "7" }, []).find === undefined &&
    /^Done in Calculator, behind their window \(clicked there, their pointer untouched\), and read back/.test(T.doneText({ ok: true, how: "point", behind: true, app: "Calculator" })))
  check("takeover: a pause is said, and only a click, Esc or typing where it types stops it",
    L.pausedLine("mouse") === "Paused, you're using the mouse" && /typing/.test(L.pausedLine("keys")) && /clicked/.test(L.tookText("user-click")) && /Esc/.test(L.tookText("user-esc")) &&
    /typing where it was typing/.test(L.tookText("user-typing")) && /kept using/.test(L.tookText("paused")) && L.REST_MS === 1000)
  check("takeover: fill sets a native field's value, a web page's is typed (focused, all selected first)",
    ops(L.plan({ action: "fill", el, value: "x" }, { ...mail, valueSettable: true })) === "set | focus+key+type | click+key+type" &&
    ops(L.plan({ action: "fill", el, value: "x" }, { ...mail, valueSettable: true, web: true })) === "focus+key+type | click+key+type" &&
    ops(L.plan({ action: "type", value: "x" }, mail)) === "type" && ops(L.plan({ action: "press", key: "cmd+s" }, mail)) === "key")
  check("takeover: a box already as asked isn't pressed again",
    ops(L.plan({ action: "check", el }, { ...mail, checked: true })) === "" && ops(L.plan({ action: "uncheck", el }, { ...mail, checked: true })) === "press | click")
  check("takeover: a spoken yes or no answers an offer; anything longer is an ask",
    T.answerOf("Yes, please!") === true && T.answerOf("sure") === true && T.answerOf("okay, go ahead") === true && T.answerOf("No, not now") === false &&
    T.answerOf("don't") === false && T.answerOf("what does this button do?") === null && T.answerOf("") === null)
  check("takeover: a no anywhere is a no, and a yes is only yes words",
    T.answerOf("please stop") === false && T.answerOf("okay wait") === false && T.answerOf("sure, not that one") === false &&
    T.answerOf("yes but the other button") === null && T.answerOf("yes do it") === true)
  check("takeover: a private site (the page its window shows) is refused like a private app",
    /private/.test(L.refusal({ action: "click", el }, { ...mail, url: "https://diary.example.com/today" }, (a) => /diary\.example\.com/.test(a.url ?? "")) ?? ""))
  check("takeover: their yes outlasts a step's end, not their taking over or the exchange ending",
    L.keepsYes("done") && !L.keepsYes("user-click") && !L.keepsYes("user-typing") && !L.keepsYes("user-esc") && !L.keepsYes("ended") && !L.keepsYes("another") && !L.keepsYes("quit"))
  check("takeover: their hand coming off Do it isn't taking over; a spoken or an old yes has no grace",
    L.handGrace(10_000, 10_200) === L.HAND_MS - 200 && L.handGrace(10_000, 10_000 + L.HAND_MS + 1) === 0 && L.handGrace(0, 10_000) === 0)

  check("takeover: a spoken answer is for the offer under their pointer, else the nearest; none up, none",
    L.aimedAt([{ id: "a", rect: { x: 0, y: 0, width: 100, height: 50 } }, { id: "b", rect: { x: 0, y: 60, width: 100, height: 50 } }], { x: 10, y: 70 }) === "b" &&
    L.aimedAt([{ id: "a", rect: { x: 0, y: 0, width: 100, height: 50 } }, { id: "b", rect: { x: 0, y: 60, width: 100, height: 50 } }], { x: 300, y: 10 }) === "a" && L.aimedAt([], { x: 0, y: 0 }) === null)
  const area = { x: 0, y: 0, width: 1440, height: 900 }
  check("takeover: a second card goes below the one up, never over it, and stays on the screen",
    JSON.stringify(L.cardSpot({ x: 100, y: 100 }, { width: 368, height: 118 }, area, [])) === '{"x":118,"y":118}' &&
    JSON.stringify(L.cardSpot({ x: 100, y: 100 }, { width: 368, height: 118 }, area, [{ x: 118, y: 118, width: 368, height: 118 }])) === '{"x":118,"y":242}' &&
    L.cardSpot({ x: 1400, y: 880 }, { width: 368, height: 118 }, area, []).x === 1440 - 368 - 8 && L.cardSpot({ x: 1400, y: 880 }, { width: 368, height: 118 }, area, []).y === 900 - 118 - 8)
  const H = await import("../../../electron/helperlogic.ts")
  check("open on the Mac: an app by name or bundle, a pane's address, a path from home, an address in an app",
    JSON.stringify(H.openArgs({ app: "System Settings" }, "/Users/al")) === '["-a","System Settings"]' && JSON.stringify(H.openArgs({ app: "com.apple.calculator" }, "/h")) === '["-b","com.apple.calculator"]' &&
    JSON.stringify(H.openArgs({ url: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" }, "/h")) === '["x-apple.systempreferences:com.apple.Keyboard-Settings.extension"]' &&
    JSON.stringify(H.openArgs({ path: "~/Downloads" }, "/Users/al")) === '["/Users/al/Downloads"]' && JSON.stringify(H.openArgs({ app: "Safari", url: "https://example.com" }, "/h")) === '["-a","Safari","https://example.com"]')
  check("open on the Mac: no script or data address, no relative path, no flag for an app's name",
    "why" in (H.openArgs({ url: "javascript:alert(1)" }, "/h") as object) && "why" in (H.openArgs({ url: "file:///etc/passwd" }, "/h") as object) && "why" in (H.openArgs({ path: "Downloads" }, "/h") as object) &&
    "why" in (H.openArgs({ app: "-n; rm" }, "/h") as object) && "why" in (H.openArgs({}, "/h") as object))
  check("open on the Mac: a System Settings pane is in front once it's open", H.openedBundle({ url: "x-apple.systempreferences:com.apple.BluetoothSettings" }) === "com.apple.systempreferences" &&
    H.openedBundle({ app: "com.apple.finder" }) === "com.apple.finder" && H.openedBundle({ url: "mailto:a@example.com" }) === "")
  check("open: an app, another scheme's address or a path outside the vault is the Mac's; the vault's, a view and the web aren't",
    JSON.stringify(T.macOpen("", "Calculator", "/v", "/h")) === '{"app":"Calculator"}' && JSON.stringify(T.macOpen("x-apple.systempreferences:com.apple.Keyboard-Settings.extension", "", "/v", "/h")) === '{"url":"x-apple.systempreferences:com.apple.Keyboard-Settings.extension"}' &&
    JSON.stringify(T.macOpen("~/Downloads", "", "/v", "/h")) === '{"path":"/h/Downloads"}' && T.macOpen("/v/Notes/A.md", "", "/v", "/h") === null && T.macOpen("Notes/A.md", "", "/v", "/h") === null &&
    T.macOpen("view:graph", "", "/v", "/h") === null && T.macOpen("https://example.com", "", "/v", "/h") === null && JSON.stringify(T.macOpen("https://example.com", "Safari", "/v", "/h")) === '{"app":"Safari","url":"https://example.com"}')
  const { byLabel } = await import("../../../plugins/core/companion/screenmarks.ts")
  const keys = [{ label: "Keyboard brightness" }, { label: "Press 🌐︎ key to" }]
  check("open on the Mac: the fn key's setting is found by its words, said fn or globe (macOS shows a 🌐)",
    byLabel(keys, "Press fn key to")?.label === "Press 🌐︎ key to" && byLabel(keys, "press globe key")?.label === "Press 🌐︎ key to" && byLabel(keys, "brightness")?.label === "Keyboard brightness")
  const R = await import("../../../plugins/core/companion/reach.ts")
  const never = (cmd: string) => R.NEVER_RUN.some((n) => new RegExp(n, "i").test(cmd))
  check("summoned: keys and secrets are never run, whoever asks; their names in other words are",
    ["cat ~/.ssh/id_ed25519", "ls /Users/al/.ssh", "security find-generic-password -s x -w", "cat .env", "cat app/.env.local", "cp ~/Library/Keychains/login.keychain-db /tmp", "cat data/config.json", "openssl rsa -in server.pem"].every(never) &&
    !["ls ~/Downloads", "cat notes/environment.md", "grep ssh README.md", "defaults read com.apple.HIToolbox", "echo key", "cat .envelope"].some(never))

  // ---------- act on the screen, through a stand-in helper
  const c = await import("../../../plugins/core/companion/plugin.ts")
  // (its summoned session off: asks here start no agent)
  await api("PATCH", "config/plugin/companion", { mode: "quiet", summoned_model: "companion" })
  const { EventEmitter } = await import("node:events")
  const live = c.plugin.sockets.find((x: Any) => x.pattern.join("/") === "companion/live")!
  let answer: (m: Any, ws: Any) => void = () => {}
  const helper: Any = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as Any[], close() {}, send(t: string) { const m = JSON.parse(t); helper.got.push(m); answer(m, helper) } })
  const from = (m: object) => helper.emit("message", JSON.stringify(m))
  live.fn(helper, { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as Any, { query: { screen: "1" }, wild: [] })
  const bare = { state: {}, actions: [], inside: [] }
  const near = [{ id: "a1", role: "button", label: "Save", frame, ...bare }, { id: "a2", role: "text field", label: "Name", frame: { x: 100, y: 260, width: 200, height: 24 }, ...bare }]
  // (the helper's moment says where its steps go; the ask itself as screenMoment takes it, with no request to start one)
  from({ t: "moment", kind: "none" })
  const ask = () => c.screenMoment({ kind: "ask", text: "save it for me", app: "com.example.mail", sx: 120, sy: 210, near })
  const seq0 = ask()?.seq ?? 0
  const steps = () => helper.got.filter((m: Any) => m.t === "takeover")
  answer = (m) => { if (m.t === "takeover") setImmediate(() => from({ t: "takeover-done", id: m.id, ok: true, how: "ax", app: "Mail", title: "Draft", near: [{ id: "a1", role: "menu item", label: "Save as", frame: { x: 1, y: 2, width: 3, height: 4 } }] })) }
  let [st, r] = await api("POST", "ops/companion.act", { action: "click", ax: "a1", ask: "Want me to save it?" })
  const s1 = steps().at(-1), me = (await api("POST", "ops/companion.status", {}))[1].agents.find((a: Any) => a.name === "Claude")
  check("takeover: act --ax sends the helper the element's step and its offer, its cursor flown there first",
    st === 200 && s1?.step.action === "click" && s1.step.el.label === "Save" && s1.step.el.frame.width === 80 && s1.ask === "Want me to save it?" && s1.agent === "Claude" && Array.isArray(s1.apps) && Array.isArray(s1.sites) && me?.sx !== undefined, [st, r, s1, me])
  check("takeover: it answers how it went and what's there now, by fresh ids", /^Done \(through Accessibility\)\. Now in Mail, "Draft"\.\nNear it now/.test(r.text) && /a1 menu item "Save as"/.test(r.text), r)
  check("takeover: a scroll that moved nothing says so, not done", /^Scrolled \(with the pointer\), but nothing there moved/.test(T.doneText({ ok: true, how: "point", moved: false })) && /^Done/.test(T.doneText({ ok: true, how: "point" })))
  check("takeover: its words for the caption go with the step (--doing), at most 52", T.stepOf({ action: "fill", ax: "a2", value: "x", doing: " Typing the title " }, near).doing === "Typing the title" && !("doing" in T.stepOf({ action: "click", ax: "a1" }, near)))
  ;[st, r] = await api("POST", "ops/companion.act", { action: "click", ax: "a2" })
  check("takeover: the next step points by the last step's ids", st === 404 && /no element a2/.test(r.error), [st, r])
  // (an ask there, no element: the field with the keys)
  ;[st, r] = await api("POST", "ops/companion.act", { action: "type", value: "Lighthouse" })
  check("takeover: asked on the screen, act with no place types into the field with the keys", st === 200 && steps().at(-1)?.step.action === "type" && !steps().at(-1).step.el && !steps().at(-1).step.at, [st, r])
  // (an offer up: a spoken yes answers it and isn't an ask; a Talk key's press doesn't stop the turn)
  answer = (m) => { if (m.t === "takeover") setImmediate(() => from({ t: "takeover-asking", id: m.id, agent: "Claude" })); if (m.t === "takeover-answer") setImmediate(() => from({ t: "takeover-done", id: steps().at(-1).id, ok: !!m.yes, ...(m.yes ? { how: "point" } : { why: "declined", text: "they didn't say yes" }) })) }
  const asked = api("POST", "ops/companion.act", { action: "click", sx: 400, sy: 300 })
  await waitFor(() => steps().at(-1)?.step.at?.x === 400, 3000, 10)
  await new Promise((done) => setTimeout(done, 30))
  from({ t: "interrupt" })
  from({ t: "moment", kind: "ask", text: "Yeah, go ahead", app: "com.example.mail", sx: 1, sy: 1 })
  ;[st, r] = await asked
  check("takeover: their spoken yes answers the offer (sent to the helper), not kept as an ask", st === 200 && helper.got.some((m: Any) => m.t === "takeover-answer" && m.yes === true) &&
    ask()?.seq === seq0 + 1 && /with the pointer/.test(r.text), [st, r, seq0])
  const no = api("POST", "ops/companion.act", { action: "click", sx: 400, sy: 300 })
  await waitFor(() => steps().length >= 4, 3000, 10)
  await new Promise((done) => setTimeout(done, 30))
  from({ t: "moment", kind: "ask", text: "no", app: "com.example.mail", sx: 1, sy: 1 })
  ;[st, r] = await no
  check("takeover: a no comes back as theirs, for it to tell them how instead", st === 200 && r.ok === false && r.why === "declined", r)
  // (an offer waits while they could still answer it; their next ask instead moves on from it, and stays an ask)
  const other = api("POST", "ops/companion.act", { action: "click", sx: 400, sy: 300 })
  await waitFor(() => steps().length >= 5, 3000, 10)
  await new Promise((done) => setTimeout(done, 30))
  const seqOther = ask()?.seq ?? 0
  from({ t: "moment", kind: "ask", text: "what does this button do?", app: "com.example.mail", sx: 1, sy: 1 })
  ;[st, r] = await other
  check("takeover: an offer waits minutes for their answer, not seconds, and the act's wait on the server is the helper's own",
    L.OFFER_MS >= 5 * 60_000 && helper.got.filter((m: Any) => m.t === "takeover-answer").length >= 2, L.OFFER_MS)
  check("takeover: their next ask while an offer waits moves on from it (withdrawn, act told why) and is kept as an ask",
    st === 200 && r.ok === false && helper.got.findLast((m: Any) => m.t === "takeover-answer")?.asked === true && ask()?.seq === seqOther + 2 && /asked something else/.test(L.declined.asked),
    [r, helper.got.filter((m: Any) => m.t === "takeover-answer"), seqOther])
  // (asked from their browser: a web page opens there, by the helper, not in a pane of Vaultite's behind it)
  const bar = { id: "a1", role: "text field", label: "Address and search bar", frame: { x: 266, y: 44, width: 929, height: 24 } }
  c.screenMoment({ kind: "ask", text: "open internal.example.com here", app: "com.google.Chrome", window: 5, title: "New Tab - Google Chrome", sx: 598, sy: 189, near: [bar],
    ink: [{ shape: "ring", box: { x: 0, y: 101, width: 293, height: 146 }, points: [[0, 101], [293, 247]] }] })
  const found = { role: "button", label: "Bookmarks", frame: { x: 1200, y: 44, width: 30, height: 24 } }
  answer = (m) => {
    if (m.t === "open") setImmediate(() => from({ t: "takeover-done", id: m.id, ok: true, how: "open" }))
    if (m.t === "find") setImmediate(() => from({ t: "takeover-done", id: m.id, ...(m.text === "Bookmarks" ? { ok: true, found: { id: "", ...found } } : { ok: false, why: "none" }) }))
  }
  ;[st, r] = await api("POST", "ops/companion.open", { path: "https://internal.example.com" })
  const opened = helper.got.filter((m: Any) => m.t === "open").at(-1)
  check("takeover: a web page asked for from their browser opens there (the helper), said so",
    st === 200 && opened?.url === "https://internal.example.com" && opened.app === "com.google.Chrome" && r.in === "com.google.Chrome", [st, r, opened])
  // (marks name what's there: an element of the ask by its words, else the window's own, found by the helper)
  const drawn = () => helper.got.filter((m: Any) => m.t === "drawing" && m.drawing).at(-1)?.drawing
  ;[st, r] = await api("POST", "ops/companion.draw", { marks: [{ type: "frame", at: { find: "Address and search" } }, { type: "ring", at: { find: "Bookmarks" } }] })
  const d = drawn()
  check("takeover: a mark's words find the ask's element saying them, else the window's (asked of the helper), its place in the drawing",
    st === 200 && d?.places?.["find:Address and search"]?.w === 929 && d.places["find:Bookmarks"]?.x === 1200 && !helper.got.some((m: Any) => m.t === "find" && m.text === "Address and search") &&
    helper.got.some((m: Any) => m.t === "find" && m.text === "Bookmarks"), [st, r, d?.places])
  ;[st, r] = await api("POST", "ops/companion.draw", { marks: [{ type: "ring", at: { find: "Nowhere" } }] })
  check("takeover: words nothing on the screen says aren't drawn anywhere: it says so", st === 409 && /nothing on the user's screen says "Nowhere"/.test(r.error), [st, r])
  await api("POST", "ops/companion.draw", { marks: [{ type: "ring", at: [100, 200] }, { type: "ring", at: [700, 50] }] })
  const snapped = drawn()?.marks.slice(-2).map((m: Any) => m.at)
  check("takeover: a ring at a guessed pixel goes round what they drew there, or the element it's on",
    JSON.stringify(snapped?.[0]) === '{"x":0,"y":101,"w":293,"h":146}' && snapped?.[1].el === "a1", snapped)
  // (on their Mac: a System Settings pane opens there, its window's elements the ids to point at, its words found in them)
  const pane = "x-apple.systempreferences:com.apple.Keyboard-Settings.extension"
  const fnRow = { id: "a1", role: "pop up button", label: "Press fn key to", frame: { x: 700, y: 400, width: 160, height: 22 }, state: {}, actions: [], inside: [] }
  answer = (m) => { if (m.t === "open") setImmediate(() => from({ t: "takeover-done", id: m.id, ok: true, how: "open", app: "System Settings", bundle: "com.apple.systempreferences", title: "Keyboard",
    frame: { x: 400, y: 100, width: 715, height: 600 }, near: [fnRow] })) }
  c.screenMoment({ kind: "ask", text: "show me where fn's setting is", app: "com.example.mail", sx: 10, sy: 10, near: [] })
  ;[st, r] = await api("POST", "ops/companion.open", { path: pane })
  const toPane = helper.got.filter((m: Any) => m.t === "open").at(-1)
  check("open on the Mac: a System Settings pane goes to the helper, answering the window in front and its elements by id",
    st === 200 && toPane?.url === pane && !toPane.app && r.in === "System Settings" && r.title === "Keyboard" && r.near?.[0]?.label === "Press fn key to", [st, r, toPane])
  ;[st, r] = await api("POST", "ops/companion.draw", { marks: [{ type: "ring", at: { find: "Press fn key to" } }] })
  const ring = helper.got.filter((m: Any) => m.t === "drawing" && m.drawing).at(-1)?.drawing
  check("open on the Mac: a mark's words land on that window's element (its frame), never on nothing", st === 200 && ring?.places?.["find:Press fn key to"]?.x === 700 && ring.places["find:Press fn key to"].w === 160, [st, r, ring?.places])
  answer = (m) => { if (m.t === "takeover") setImmediate(() => from({ t: "takeover-done", id: m.id, ok: true, how: "ax" })) }
  ;[st, r] = await api("POST", "ops/companion.act", { action: "click", ax: "a1" })
  check("open on the Mac: act on its ids goes there (a step for that element)", steps().at(-1)?.step.el?.label === "Press fn key to", steps().at(-1))
  await api("POST", "ops/companion.clear", {})
  answer = (m) => { if (m.t === "open") setImmediate(() => from({ t: "takeover-done", id: m.id, ok: m.path !== "/nope", ...(m.path === "/nope" ? { why: "failed", text: "there's no /nope on this Mac" } : { how: "open" }) })) }
  ;[st, r] = await api("POST", "ops/companion.open", { app: "Calculator" })
  check("open on the Mac: an app by its name", st === 200 && helper.got.filter((m: Any) => m.t === "open").at(-1)?.app === "Calculator", [st, r])
  ;[st, r] = await api("POST", "ops/companion.open", { path: "/nope" })
  check("open on the Mac: what doesn't open says why", st === 409 && /there's no \/nope/.test(r.error), [st, r])
  await api("POST", "ops/companion.clear", {})
  c.screenMoment({ kind: "ask", text: "and this?", app: "com.example.mail", sx: 1, sy: 1 })
  ;[st, r] = await api("POST", "ops/companion.act", { action: "click", ax: "a1" })
  check("takeover: a later ask with no elements takes the last ask's ids away (never pointed at on another screen)", st === 404 && /no element a1/.test(r.error), [st, r])
  // (no helper: says so; the pane path untouched)
  helper.emit("close")
  ;[st, r] = await api("POST", "ops/companion.act", { action: "click", sx: 1, sy: 1 })
  check("takeover: with no helper that asked, act on the screen says so", st === 200 && r.ok === false && /no Mac's helper/.test(r.text), r)
  ;[st, r] = await api("POST", "ops/companion.act", { action: "focus", pane: "tnope" })
  check("takeover: a step only for another app isn't sent to a page", st === 400 && /another app/.test(r.error), [st, r])
  await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: null })
  {
    // One UI model in other apps (plugins/core/companion/uimodel.ts): a fold pressed only when it isn't so, a step's
    // element read back before and after, and an answer that says plainly when it didn't change
    const tri = { ...mail, role: "AXDisclosureTriangle" }
    check("takeover: expand and collapse press only when the fold isn't so already",
      ops(L.plan({ action: "expand", el }, { ...tri, expanded: false })) === "press | click" && ops(L.plan({ action: "expand", el }, { ...tri, expanded: true })) === "" &&
      ops(L.plan({ action: "collapse", el }, { ...tri, expanded: true })) === "press | click" && L.STEPS.includes("expand"))
    const p = L.probeThing({ ...tri, label: "Advanced", frame, expanded: false, actions: ["AXPress"] })
    check("takeover: a probe read as a thing", p?.role === "button" && p.state.expanded === false && p.actions[0] === "press" && L.probeThing({ ok: false }) === null, p)
    const before = { ...p!, state: { expanded: false } }, near = [{ id: "a1", ...before }]
    const still = T.effectOf("expand", { ok: true, before, target: before, near }, near), opened = T.effectOf("click", { ok: true, before, target: { ...before, state: { expanded: true } } }, near)
    check("takeover: a fold that didn't change says so; one that did says it's open",
      still?.ok === false && /still folded/.test(still.saw) && opened?.ok === true && /open now/.test(opened.saw) &&
      /didn't|but "Advanced" is still folded/.test(T.doneText({ ok: true, effect: still })) && T.doneText({ ok: true, how: "ax", effect: opened }).startsWith("Done (through Accessibility): \"Advanced\" is open now"))
    const plain = { ...before, role: "button", state: {} }
    check("takeover: a plain button with nothing near it changed isn't called a failure", T.effectOf("click", { ok: true, before: plain, target: plain, near }, near)?.ok === true)
  }

  // (Windows runs no script by its #! line, and has no Mac helpers to run)
  if (process.platform !== "win32") {
    // The Mac helpers' line protocol (electron/linehelper.ts), with a stand-in helper: answers, events, a timeout, a death.
    const { lineHelper } = await import("../../../electron/linehelper.ts")
    const bin = path.join($.tmp, "line-helper")
    fs.writeFileSync(bin, `#!${process.execPath}\nrequire("node:readline").createInterface({ input: process.stdin }).on("line", (l) => { const m = JSON.parse(l)
  if (m.op === "die") process.exit(1); if (m.op === "slow") return; if (m.op === "event") process.stdout.write(JSON.stringify({ event: "x" }) + "\\n")
  process.stdout.write(JSON.stringify({ id: m.id, ok: true, pid: process.pid }) + "\\n") })\n`)
    fs.chmodSync(bin, 0o755)
    const events: unknown[] = []
    let exits = 0
    const h = lineHelper({ binary: async () => bin, event: (m) => events.push(m), exited: () => exits++ })
    const a = await h.ask<{ ok?: boolean; pid?: number }>({ op: "hi" }), e = await h.ask({ op: "event" }), slow = await h.ask<{ why?: string }>({ op: "slow" }, 200)
    check("mac helpers: an ask is answered, an event heard, a slow one times out", a.ok === true && (e as Any).ok === true && events.length === 1 && slow.why === "timeout", { a, events, slow })
    const pending = h.ask<{ why?: string }>({ op: "slow" }, 5000), died = await h.ask<{ why?: string }>({ op: "die" }, 5000), lost = await pending
    const again = await h.ask<{ ok?: boolean; pid?: number }>({ op: "hi" })
    check("mac helpers: one that dies answers what it held, and the next ask starts another", died.why === "helper" && lost.why === "helper" && exits === 1 && again.ok === true && again.pid !== a.pid, { died, lost, exits, again })
    h.quit()
    const gone = lineHelper({ binary: async () => path.join($.tmp, "no-such-helper"), exited: () => exits++ })
    check("mac helpers: one that can't start answers so, nothing thrown", (await gone.ask<{ why?: string }>({ op: "hi" }, 3000)).why === "helper" && !gone.running())
  }
}
