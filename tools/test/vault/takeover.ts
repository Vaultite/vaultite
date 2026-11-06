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
    L.plan({ action: "click", el }, mail)[1][0].x === 140 && ops(L.plan({ action: "dblclick", el }, mail)) === "click", L.plan({ action: "click", el }, mail))
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
    L.keepsYes("done") && !L.keepsYes("user-mouse") && !L.keepsYes("user-esc") && !L.keepsYes("ended") && !L.keepsYes("another") && !L.keepsYes("quit"))
  check("takeover: their hand coming off Do it isn't taking over; a spoken or an old yes has no grace",
    L.handGrace(10_000, 10_200) === L.HAND_MS - 200 && L.handGrace(10_000, 10_000 + L.HAND_MS + 1) === 0 && L.handGrace(0, 10_000) === 0)

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
  const near = [{ id: "a1", role: "button", label: "Save", frame }, { id: "a2", role: "text field", label: "Name", frame: { x: 100, y: 260, width: 200, height: 24 } }]
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
  // (no helper: says so; the pane path untouched)
  helper.emit("close")
  ;[st, r] = await api("POST", "ops/companion.act", { action: "click", sx: 1, sy: 1 })
  check("takeover: with no helper that asked, act on the screen says so", st === 200 && r.ok === false && /no Mac's helper/.test(r.text), r)
  ;[st, r] = await api("POST", "ops/companion.act", { action: "focus", pane: "tnope" })
  check("takeover: a step only for another app isn't sent to a page", st === 400 && /another app/.test(r.error), [st, r])
  await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: null })
}
