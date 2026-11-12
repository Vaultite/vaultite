import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const S = await import("../../../electron/stack.ts")
const P = await import("../../../electron/pagespot.ts")

function order(check: Check) {
  type V = { name: string; role: "window" | "page" | "full" | "chrome" }
  const v = (name: string, role: V["role"]): V => ({ name, role })
  const win = v("win", "window"), a = v("a", "page"), b = v("b", "page"), f = v("f", "full"), strip = v("strip", "chrome")
  const order = (views: V[], raise: "app" | "through" | null, top?: V) => S.stackOrder(views, (x) => x.role, raise, top).map((x) => x.name).join(" ")
  check("stack: pages over the window's page, which goes over them only while raised",
    order([win, a, b], null) === "win a b" && order([a, b, win], null) === "win a b" &&
    order([win, a, b], "app") === "a b win" && order([win, a, b], "through") === "a b win")
  check("stack: a page shown afresh goes over the other pages, still under a raised window",
    order([win, a, b], null, a) === "win b a" && order([a, b, win], "through", a) === "b a win")
  check("stack: a page not in the window yet comes in where its role says",
    order([win, a], "app", b) === "a b win" && order([win, a], null, b) === "win a b")
  check("stack: a page full screen stays over the raised window, and chrome over everything",
    order([strip, f, win, a], "app") === "a win f strip" && order([f, strip, a, win], null) === "win a f strip" &&
    order([win, a, strip], "app", v("g", "full")) === "a win g strip")
}

function pointer(check: Check) {
  type E = Parameters<typeof S.pointerStep>[1]
  const run = (events: E[], from = S.NO_POINTER) => events.reduce((acc, e) => {
    const r = S.pointerStep(acc.s, e)
    return { s: r.to, did: [...acc.did, r.do.map((x) => x.do === "send" ? `send:${x.buttons}` : x.do === "pinch" ? `pinch:${x.on}` : x.do).join(",")] }
  }, { s: from, did: [] as string[] })
  const pass = (kind: "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel", button: "left" | "right" | "middle" = "left", page = 1): E => ({ type: "pass", page, kind, button })
  const raise = (how: "app" | "through" | null): E => ({ type: "raise", how })
  const read = (m: unknown) => { const r = S.PASSED.safeParse(m); return r.success ? r.data : null }

  check("pointer: raising restacks, a pinch stops going to the page, and only letting it through asks what's under it",
    run([raise("app")]).did[0] === "restack" && run([raise("through")]).did[0] === "restack,hover" && run([raise(null)]).did[0] === "restack")
  check("pointer: nothing reaches a page unless the window lets the pointer through",
    run([pass("mouseDown")]).did[0] === "" && run([raise("app"), pass("mouseMove")]).did[1] === "")
  const press = run([raise("through"), pass("mouseMove"), pass("mouseDown"), pass("mouseDown", "right"), pass("mouseUp")])
  check("pointer: let through, moves and presses reach the page with the buttons held, and a pinch goes to it",
    press.did.slice(1).join(" | ") === "pinch:true,send:0 | send:1 | send:3 | send:2" && press.s.pinch, press.did)
  const after = run([raise("through"), pass("mouseDown"), raise("app"), pass("mouseMove"), pass("mouseUp"), pass("mouseMove")])
  check("pointer: a press passed while through is let go in its page though the window rose over it meanwhile",
    after.did.slice(2).join(" | ") === "restack,pinch:false | send:1 | send:0 | ", after.did)
  check("pointer: leaving the page ends its press, tells it as a plain leave, and the pinch is the window's again",
    run([raise("through"), pass("mouseDown"), pass("mouseLeave"), raise("app"), pass("mouseUp")]).did.slice(2).join(" | ") === "pinch:false,leave | restack | ")
  check("pointer: a page that ended holds nothing",
    run([raise("through"), pass("mouseDown", "left", 7), { type: "gone", page: 7 }, raise(null), pass("mouseUp", "left", 7)]).did.at(-1) === "")
  check("pointer: what the window's page sends is read as an event, anything else as none",
    read({ type: "mouseDown", x: 3, y: 4, button: "right", clickCount: 9, keys: ["meta", "nope"] })?.clickCount === 3 &&
    read({ type: "mouseDown", keys: ["meta", "nope", "alt"] })?.keys.join() === "alt,meta" && read({ type: "mouseDown" })?.button === "left" &&
    read({ type: "mouseWheel", dx: "x" })?.dx === 0 && read({ type: "click" }) === null && read(null) === null)
  check("pointer: anything but a known raise reads as none", S.RAISE.parse("app") === "app" && S.RAISE.parse("through") === "through" && S.RAISE.parse("x") === null && S.RAISE.parse(undefined) === null)
}

function overlay(check: Check) {
  const win = { x: 400, y: 0, width: 700, height: 600 }, bar = { x: 300, y: 0, width: 120, height: 32 }
  const takes = (at: { x: number; y: number }, o: Partial<{ boxes: typeof bar[]; pressing: boolean; shown: boolean; stalled: boolean }> = {}) =>
    S.overlayTakes({ win, at, boxes: [bar], pressing: false, shown: true, stalled: false, ...o })
  check("overlay: takes the pointer over a box its page marked", takes({ x: 760, y: 10 }))
  check("overlay: lets it through over its see-through rest, with or without boxes",
    !takes({ x: 700, y: 400 }) && !takes({ x: 760, y: 10 }, { boxes: [] }))
  check("overlay: a press begun on one keeps it over the window, never off it",
    takes({ x: 700, y: 400 }, { boxes: [], pressing: true }) && !takes({ x: 1200, y: 10 }, { pressing: true }) && !takes({ x: 760, y: 700 }, { pressing: true }))
  check("overlay: hidden or not answering, it never takes it",
    !takes({ x: 760, y: 10 }, { shown: false }) && !takes({ x: 760, y: 10 }, { stalled: true, pressing: true }))
  check("levels: the island over a cursor's conversation over the companion's screen, a kept-on-top window under them all",
    S.LEVELS.island[1] > S.LEVELS.panel[1] && S.LEVELS.panel[1] > S.LEVELS.screen[1] && S.LEVELS.panel[0] === S.LEVELS.screen[0] && S.LEVELS.onTop[0] === "floating")
}

function spot(check: Check) {
  type E = Parameters<typeof P.spotStep>[1]
  const run = (events: E[], from: Parameters<typeof P.spotStep>[0] = P.HIDDEN) => events.reduce((acc, e) => {
    const r = P.spotStep(acc.s, e)
    return { s: r.to, did: [...acc.did, r.do.join(",")] }
  }, { s: from, did: [] as string[] })
  const fit = (o: Partial<{ fill: boolean; rect: boolean; drawn: boolean; now: number }> = {}): E => ({ type: "fit", fill: false, rect: false, drawn: false, now: 5, ...o })
  check("spot: a tab's page shown in its pane, then hidden, takes the keyboard out with it; hidden again does nothing",
    run([fit({ rect: true }), fit(), fit()]).did.join(" | ") === "to-tab,show | keys-out,hide | ", run([fit({ rect: true }), fit(), fit()]).did)
  check("spot: full screen or its player fills, from anywhere, and back in its tab without being raised",
    run([fit({ rect: true }), fit({ fill: true }), fit({ rect: true })]).did.slice(1).join(" | ") === "to-fill,show | to-tab,show")
  const agent = run([{ type: "park", now: 1 }, fit({ drawn: true }), { type: "rest" }, { type: "rest" }, fit({ drawn: true, now: 9 })])
  check("spot: an agent's page parks out of sight drawing, rests hidden and throttled, and wakes on the next fit",
    agent.did.join(" | ") === "unfocus,unthrottle,to-parked,show |  | hide,throttle |  | unfocus,unthrottle,to-parked,show" && agent.s.at === "parked" && "woke" in agent.s && agent.s.woke === 9, agent)
  check("spot: a parked page put in its tab comes over the window's other pages and is checked to draw",
    run([{ type: "park", now: 1 }, fit({ rect: true, drawn: true })]).did[1] === "hide,raise,to-tab,show,see" &&
    run([fit({ rect: true, drawn: true })]).did[0] === "to-tab,show,see" && run([{ type: "park", now: 1 }, { type: "rest" }, fit({ rect: true })]).did[2] === "hide,raise,to-tab,show")
  check("spot: let go by its tab, a page hides with the keyboard left as it is, an agent's parks",
    run([fit({ rect: true }), { type: "stow", drawn: false, now: 1 }]).did[1] === "hide" && run([fit({ rect: true }), { type: "stow", drawn: true, now: 1 }]).s.at === "parked")
  check("spot: taken out of its window, it's hidden, never parked unseen",
    run([{ type: "park", now: 1 }, { type: "hide" }]).s.at === "hidden" && !P.shown({ at: "parked", woke: 0 }) && P.shown({ at: "fill" }) && P.shown({ at: "tab" }))
}

export default async ($: VaultTest) => { for (const t of [order, pointer, overlay, spot]) t($.check) }
