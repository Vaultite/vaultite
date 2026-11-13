import { check } from "../lib.ts"
import { same } from "./lib.ts"

// ---------- Browser: a page kept over its box (plugins/core/web-viewer/placement.ts) ----------
{
  const pl = await import("../../../plugins/core/web-viewer/placement.ts")
  type S = ReturnType<typeof pl.placementStart>
  type E = Parameters<typeof pl.placeStep>[1]
  type Cover = "app" | "through" | null
  const A = pl.boxAt(0, 40, 800, 600), B = pl.boxAt(240, 40, 560, 600), C = pl.boxAt(900, 40, 300, 300)
  const name = (b: typeof A | null) => (b === null ? "-" : pl.sameBox(b, A) ? "A" : pl.sameBox(b, B) ? "B" : pl.sameBox(b, C) ? "C" : JSON.stringify(b))
  const say = (f: ReturnType<typeof pl.placeStep>["do"][number]) => [f.do, ..."cover" in f ? [f.cover ?? "-"] : [], ..."at" in f ? [name(f.at)] : [],
    ..."to" in f ? [name(f.to)] : [], ..."n" in f ? [f.n] : [], ..."motion" in f ? [f.motion] : [], ..."on" in f ? [f.on] : []].join(" ")
  const drive = (events: E[], from: S = pl.placementStart(false), covers: { hits?: Cover; floats?: Cover } = {}) => {
    let s = from, hit = 0
    const look = { hits: () => { hit++; return covers.hits ?? null }, floats: () => covers.floats ?? null }
    const did = events.map((e) => { const r = pl.placeStep(s, e, look); s = r.to; return r.do.map(say).join(", ") })
    return { s, did, hit, phase: s.phase.kind, where: s.where.kind }
  }
  const seen = (area = A, o: Partial<{ error: boolean; passkey: boolean; held: boolean; keysFree: boolean; paneFocused: boolean; radius: number }> = {}) =>
    ({ type: "frame" as const, seen: { area, radius: 0, error: false, passkey: false, held: false, keysFree: true, paneFocused: true, ...o } })
  const placed = (n: number, to: typeof A | null, o: Partial<{ shown: boolean; focused: boolean; radius: number }> = {}) =>
    ({ type: "placed" as const, n, to, radius: 0, shown: true, focused: false, ...o })
  const tick = { type: "tick" as const }, changed = (change: "hits" | "floats" | null) => ({ type: "changed" as const, change })
  const over = (at = A) => drive([tick, seen(at), placed(1, at)]).s
  const stop = (motion: number, area = B) => ({ type: "stopped" as const, motion, seen: seen(area).seen })

  {
    const r = drive([tick, seen(), placed(1, A)])
    check("page placement: the first look tests what covers it, places it at once (nowhere to shrink from), then opens the hole there and gives it the keyboard in the focused pane",
      same(r.did, ["ask", "cover -, place A 1", "on-screen true, hole A, focus"]) && r.hit === 1 && r.where === "over" && r.phase === "idle", r)
    const elsewhere = drive([tick, seen(A, { paneFocused: false }), placed(1, A)])
    const had = drive([tick, seen(A, { paneFocused: false }), placed(1, A)], pl.placementStart(true))
    const asked = drive([tick, seen(A, { paneFocused: false }), placed(1, A, { focused: true })])
    const typing = drive([tick, seen(A, { keysFree: false }), placed(1, A, { focused: true })], pl.placementStart(true))
    check("page placement: shown in another pane it takes the keyboard only if it had it when its tab hid, or has it now; never while typing elsewhere",
      elsewhere.did[2] === "on-screen true, hole A" && had.did[2] === "on-screen true, hole A, focus, spent" && !had.s.hadKeysWhenHidden
      && asked.did[2] === "on-screen true, hole A, focus" && typing.did[2] === "on-screen true, hole A, spent" && !typing.s.hadKeysWhenHidden, { elsewhere, had, asked, typing })
  }
  {
    const r = drive([tick, seen()], over())
    check("page placement: where it was with nothing changed, a look does nothing, not even a hit test", same(r.did, ["ask", ""]) && r.hit === 0 && r.phase === "idle", r)
    const f = drive([changed("floats"), seen()], over(), { hits: "app", floats: "through" })
    check("page placement: a change only to floats (a toast) looks at them, not the hit tests", same(f.did, ["ask", "cover through"]) && f.hit === 0, f)
    const h = drive([changed("hits"), changed("floats"), seen()], over(), { hits: "app" })
    check("page placement: what may change the hit tests runs them, a floats change after it doesn't undo that", same(h.did, ["ask", "", "cover app"]) && h.hit === 1, h)
    check("page placement: a change that changes nothing asks for nothing", same(drive([changed(null)], over()).did, [""]))
  }
  {
    const r = drive([tick, seen(B), { type: "painted", n: 2 }, placed(2, B)], over())
    check("page placement: moving, the hole shrinks to what both places share and paints before the page goes; it grows only once the page is there",
      same(r.did, ["ask", "cover -, hole B, paint 2", "place B 2", "on-screen true, hole B"]) && r.where === "over" && r.hit === 1, r)
    const grows = drive([tick, seen(A)], over(B))
    check("page placement: growing from inside where it is, the page goes at once (the hole has nothing to give up)", grows.did[1] === "cover -, place A 2", grows)
    const away = drive([tick, seen(C), { type: "painted", n: 2 }], over())
    check("page placement: to somewhere it shares nothing with, the hole closes first", away.did[1] === "cover -, hole -, paint 2" && away.did[2] === "place C 2", away)
    const round = drive([tick, seen(A, { radius: 10 })], over())
    check("page placement: its corners changing is a move", round.did[1] === "cover -, place A 2", round)
  }
  {
    const r = drive([tick, seen(B), changed("hits"), tick, { type: "painted", n: 2 }, placed(2, B), seen(B)], over(), { hits: "through" })
    check("page placement: one look at a time: what changes while the page moves is looked at once it's there",
      same(r.did, ["ask", "cover through, hole B, paint 2", "", "", "place B 2", "on-screen true, hole B, ask", "cover through"]) && r.hit === 2, r)
    const stale = drive([tick, seen(B), { type: "painted", n: 1 }, placed(1, A)], over())
    check("page placement: an older move's answers change nothing", same(stale.did.slice(2), ["", ""]) && stale.phase === "moving", stale)
  }
  {
    const first = drive([tick, seen(A, { error: true }), placed(1, null)])
    check("page placement: an error before its first look hides the page web:open showed", same(first.did, ["ask", "cover -, place - 1", "on-screen false, hole -"]) && first.where === "off" && first.hit === 0, first)
    check("page placement: hidden and nothing wrong (a tab too small to show it), a page web:open showed stays as it is",
      same(drive([tick, seen(pl.boxAt(0, 0, 1, 600))]).did, ["ask", "cover -"]))
    for (const why of ["error", "passkey", "held"] as const) {
      const r = drive([changed("hits"), seen(A, { [why]: true }), { type: "painted", n: 2 }, placed(2, null)], over())
      check(`page placement: ${why === "held" ? "an agent holding it" : `a ${why}`} takes the page off its box, the hole closed first`,
        same(r.did, ["ask", "cover -, hole -, paint 2", "place - 2", "on-screen false, hole -"]) && r.where === "off", r)
    }
  }
  {
    const r = drive([changed("hits"), seen()], { ...over(), cover: "app" })
    const busy = drive([changed("hits"), seen(A, { keysFree: false })], { ...over(), cover: "app" })
    check("page placement: back from under a menu with the keyboard nowhere in particular, the page has it again", r.did[1] === "cover -, focus" && busy.did[1] === "cover -", { r, busy })
  }
  {
    const m = (motion: number) => ({ type: "motion" as const, motion })
    const r = drive([m(1), { type: "shot", motion: 1, ok: true }, { type: "drawn", motion: 1 }, tick, changed("hits"), seen(), stop(1),
      placed(3, B), { type: "painted", n: 3 }, seen(B)], over(), { hits: "through" })
    check("page placement: its pane moving, the window goes over the page till its picture's up, the page goes off the window once that's drawn, and comes back where the pane stopped before its picture goes",
      same(r.did, ["cover through, shoot 1", "picture, hole -", "off, cover -", "", "", "", "place B 3", "on-screen true, hole B, paint 3", "unpicture, ask", "cover through"])
      && r.where === "over" && r.hit === 1, r)
    const covered = drive([m(1)], { ...over(), cover: "app" })
    check("page placement: already covered, the window stays as it was while the picture's taken", covered.did[0] === "shoot 1", covered)
    const nowhere = drive([m(1), stop(1)], pl.placementStart(false))
    check("page placement: a page not over its box takes no picture", same(nowhere.did, ["", ""]) && nowhere.phase === "idle", nowhere)
  }
  {
    const m = (motion: number) => ({ type: "motion" as const, motion })
    const again = drive([m(1), { type: "shot", motion: 1, ok: true }, m(2), { type: "drawn", motion: 1 }, stop(1), stop(2)], over())
    check("page placement: moving again before it stopped takes no second picture, and comes back once the last move stops",
      same(again.did, ["cover through, shoot 1", "picture, hole -", "", "", "", "place B 2"]) && again.phase === "thawing", again)
    const retake = drive([m(1), m(2), { type: "shot", motion: 1, ok: true }, { type: "shot", motion: 2, ok: true }], over())
    check("page placement: moving again while its picture's taken takes another, the first one dropped", same(retake.did, ["cover through, shoot 1", "shoot 2", "", "picture, hole -"]), retake)
    const failed = drive([m(1), { type: "shot", motion: 1, ok: false }, seen()], over())
    check("page placement: no picture, it's looked at again at once", same(failed.did, ["cover through, shoot 1", "ask", "cover -"]) && failed.phase === "idle", failed)
    const early = drive([m(1), stop(1), { type: "shot", motion: 1, ok: true }], over())
    check("page placement: stopped before its picture came, it's looked at again and the late picture is dropped", same(early.did, ["cover through, shoot 1", "ask", ""]) && early.phase === "due", early)
    const broke = drive([m(1), { type: "shot", motion: 1, ok: true }, { type: "drawn", motion: 1 }, { ...stop(1), seen: seen(B, { error: true }).seen }], over())
    check("page placement: an error by the time it stopped: its picture goes and the page stays off", broke.did[3] === "unpicture, ask" && broke.where === "off", broke)
  }
  {
    const r = drive([tick, seen(B), { type: "motion", motion: 1 }, { type: "painted", n: 2 }, { type: "shot", motion: 1, ok: true }], over())
    check("page placement: its pane moving while the page waits for the hole's paint, the page isn't sent at all",
      same(r.did, ["ask", "cover -, hole B, paint 2", "cover through, shoot 1", "", "picture, hole -"]) && r.phase === "pictured", r)
    const sent = drive([tick, seen(B), { type: "painted", n: 2 }, { type: "motion", motion: 1 }, placed(2, B)], over())
    check("page placement: a move's answer while its picture's taken: the hole follows the page", sent.did[4] === "on-screen true, hole B" && sent.where === "over" && sent.phase === "shooting", sent)
    const late = drive([tick, seen(B), { type: "painted", n: 2 }, { type: "motion", motion: 1 }, { type: "shot", motion: 1, ok: true }, { type: "drawn", motion: 1 }, placed(2, B)], over())
    check("page placement: an answer that comes after the page was sent off the window is old: the page stays off", late.did[6] === "" && late.where === "off", late)
    const r2 = drive([{ type: "motion", motion: 1 }, tick, seen(), changed("hits"), stop(1), seen()], over(), { hits: "app" })
    check("page placement: what changed while its pane moved is looked at as it stops (a look asked meanwhile isn't lost)",
      same(r2.did, ["cover through, shoot 1", "", "", "", "ask", "cover app"]) && r2.hit === 1, r2)
  }
  check("page placement: a look's heartbeat isn't traced, a move is",
    !pl.worthTracing({ ...over(), phase: { kind: "idle" } }, { ...over(), phase: { kind: "due" } }) && pl.worthTracing(over(), drive([tick, seen(B)], over()).s))
}
