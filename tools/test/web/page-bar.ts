import { check } from "../lib.ts"
import { same } from "./lib.ts"

// ---------- Browser: the hidden page bar coming and going (plugins/core/web-viewer/barout.ts) ----------
{
  const b = await import("../../../plugins/core/web-viewer/barout.ts")
  type E = Parameters<typeof b.barStep>[1]
  const say = (f: ReturnType<typeof b.barStep>["do"][number]) => (f.do === "show" ? (f.out ? "out" : "in") : f.do === "wait" ? `wait ${f.ms}` : "stop")
  const drive = (events: E[], from = b.barStart) => {
    let s = from
    const did = events.map((e) => { const r = b.barStep(s, e); s = r.to; return r.do.map(say).join(", ") })
    return { s, did, kind: s.kind }
  }
  const page = (at: boolean, o: Partial<{ now: boolean; left: boolean }> = {}): E => ({ type: "page", at, now: false, left: false, ...o })
  const over = (paneTop: boolean): E => ({ type: "over", paneTop })
  const move = (onIt: boolean): E => ({ type: "move", onIt })
  const press = (on: "top" | "top-control" | "bar" | "elsewhere"): E => ({ type: "press", on })
  const waited = (menu = false): E => ({ type: "waited", menu })
  const out = drive([page(true), waited()]).s

  {
    const rest = drive([page(true), page(true), waited()])
    const pass = drive([page(true), page(false)])
    const click = drive([page(true, { now: true })])
    check("page bar: the pointer resting at the page's top brings it after a rest (told again meanwhile, one wait), a quick pass doesn't, a click at once",
      same(rest.did, [`wait ${b.REST_MS}`, "", "out"]) && rest.kind === "out" && same(pass.did, [`wait ${b.REST_MS}`, "stop"]) && pass.kind === "in"
      && same(click.did, ["out"]) && click.kind === "out", { rest, pass, click })
  }
  {
    const rest = drive([over(true), waited()])
    const click = drive([press("top")]), control = drive([press("top-control")]), resting = drive([over(true), press("top")])
    const elsewhere = drive([over(false), press("elsewhere"), press("bar")])
    check("page bar: its pane's top brings it after a rest, a click there at once (stopping the rest); its buttons and other places don't",
      same(rest.did, [`wait ${b.REST_MS}`, "out"]) && same(click.did, ["out"]) && same(control.did, [""]) && control.kind === "in"
      && same(resting.did, [`wait ${b.REST_MS}`, "stop, out"]) && same(elsewhere.did, ["", "", ""]) && elsewhere.kind === "in", { rest, click, control, resting, elsewhere })
  }
  {
    const late = drive([over(true), page(false, { left: true })])
    const lower = drive([over(true), page(false)])
    const intoPage = drive([page(true), over(true), page(false, { left: true })])
    check("page bar: the page telling it left after the window heard the pane's top still counts; moved lower in the page, it doesn't",
      same(late.did, [`wait ${b.REST_MS}`, ""]) && late.kind === "resting" && same(lower.did, [`wait ${b.REST_MS}`, "stop"]) && lower.kind === "in"
      && intoPage.kind === "resting", { late, lower, intoPage })
  }
  {
    const stays = drive([move(true), move(true)], out)
    const goes = drive([move(false), move(false), waited()], out)
    const back = drive([move(false), move(true), move(false)], out)
    check("page bar: out, it stays while the pointer's on it, goes once it's been off it a moment (one wait however it moves), coming back stops that",
      same(stays.did, ["", ""]) && stays.kind === "out" && same(goes.did, [`wait ${b.LINGER_MS}`, "", "in"]) && goes.kind === "in"
      && same(back.did, [`wait ${b.LINGER_MS}`, "stop", `wait ${b.LINGER_MS}`]) && back.kind === "lingering", { stays, goes, back })
  }
  {
    const menu = drive([move(false), waited(true), move(false)], out)
    check("page bar: off it while a menu's open, it stays till the pointer moves off again with none",
      same(menu.did, [`wait ${b.LINGER_MS}`, "", `wait ${b.LINGER_MS}`]) && menu.kind === "lingering", menu)
  }
  {
    const click = drive([press("elsewhere")], out), lingering = drive([move(false), press("elsewhere")], out)
    const onIt = drive([press("bar"), press("top"), press("top-control")], out)
    check("page bar: out, a click elsewhere puts it away at once (stopping the wait), one on it, a menu or the pane's top doesn't",
      same(click.did, ["in"]) && click.kind === "in" && same(lingering.did, [`wait ${b.LINGER_MS}`, "stop, in"]) && same(onIt.did, ["", "", ""]) && onIt.kind === "out",
      { click, lingering, onIt })
  }
  {
    const quiet = drive([page(true), over(true), page(true, { now: true }), page(false)], out)
    const inMoves = drive([move(false), move(true)])
    const after = drive([move(false), waited(), over(false)], out)
    check("page bar: out, the tops' signals start no rest (it's out already); in, the pointer's moves start no wait; gone, the page's last word on its top still counts",
      same(quiet.did, ["", "", "", ""]) && quiet.kind === "out" && same(inMoves.did, ["", ""]) && inMoves.kind === "in"
      && same(after.did, [`wait ${b.LINGER_MS}`, "in", `wait ${b.REST_MS}`]) && after.kind === "resting", { quiet, inMoves, after })
  }
}
