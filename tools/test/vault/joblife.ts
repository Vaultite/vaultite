import type { Any, VaultTest } from "./harness.ts"
import * as L from "../../../plugins/core/companion/joblife.ts"

export default async ($: VaultTest) => {
  const { check } = $
  const P = { ...L.PACE }, c7 = "1a2b3c4d5e", landed = L.going(undefined, { type: "landed", commit: c7 }, 1000), g = landed.going!
  const V = (v: Any, now: number, at = g) => L.going(at, { type: "verdict", commit: c7, since: 1000, v, where: "Studio" }, now)
  const live = V({ live: true, final: true, why: "" }, 2000), red = V({ live: false, final: true, red: c7, why: "CI failed on it" }, 2000)
  const redAgain = V({ live: false, final: true, red: c7, why: "CI failed on it" }, 2000, { ...g, fixes: L.FIXES })
  const blocked = V({ live: false, final: true, why: "1a2b3c4 won't be live here: its checkout has uncommitted changes" }, 2000)
  const pending = V({ live: false, final: false, why: "1a2b3c4 isn't live here yet: CI runs on it" }, 2000)
  check("joblife: a landed commit is waited on, its job working; live, it's landed; CI red, sent back to fix it forward twice, then the user's; blocked, said and landed",
    g.state === "waiting" && g.since === 1000 && g.fixes === 0 && landed.ev === "working" && g.why === "Merged 1a2b3c4: waiting for it to go live" &&
    live.going?.state === "live" && live.going.why === "Live: 1a2b3c4 runs on Studio" && live.ev === "landed" &&
    red.going?.state === "fixing" && red.going.fixes === 1 && red.fix === "CI failed on it" && !red.ev && red.going.why === "CI failed on 1a2b3c4: sent back to fix it forward" &&
    redAgain.going?.state === "stuck" && redAgain.ev === "asks" && redAgain.going.why === "CI failed on 1a2b3c4 after 2 fixes forward: it needs you" &&
    blocked.going?.state === "stuck" && blocked.ev === "landed" && blocked.going.why === "Merged 1a2b3c4, not live: its checkout has uncommitted changes" &&
    pending.going?.state === "waiting" && !pending.ev && pending.going.why === "Merged 1a2b3c4: waiting for it to go live (CI runs on it)", { live, red, redAgain, blocked, pending })
  const hour = V(null, 1000 + L.LIVE_WAIT - 1), late = V(null, 1000 + L.LIVE_WAIT)
  check("joblife: a landed commit no answer says is live is waited on an hour, then said on its job, landed",
    hour.going?.state === "waiting" && !hour.ev && late.going?.state === "stuck" && late.ev === "landed" && late.going.why === "Merged 1a2b3c4, not live: Studio didn't say it is after 60 min", [hour, late])
  const other = L.going(g, { type: "verdict", commit: "9f8e7d6c5b", since: 1000, v: { live: true, final: true, why: "" }, where: "Studio" }, 2000)
  const again = L.going(g, { type: "verdict", commit: c7, since: 999, v: { live: true, final: true, why: "" }, where: "Studio" }, 2000)
  const unsent = L.going(red.going, { type: "unsent", commit: c7, why: "its terminal can't be reached" }, 3000)
  check("joblife: a verdict or a failed send for a going no longer asked about changes nothing; a fix that can't be sent back needs the user",
    other.going === g && !other.ev && again.going === g && L.going(g, { type: "unsent", commit: c7, why: "x" }, 3000).going === g &&
    unsent.going?.state === "stuck" && unsent.ev === "asks" && unsent.going.why === "CI failed on 1a2b3c4, and it couldn't be sent back: its terminal can't be reached", unsent)
  const fixed = L.going(red.going, { type: "landed", commit: "5e6f7a8b" }, 5000).going
  check("joblife: working again after it went live is about something else; after it was stuck, it's fixing; its fix's turn over ends it, its fix landed is waited on, its count kept",
    L.going(live.going, { type: "worked" }, 4000).going === undefined && L.going(blocked.going, { type: "worked" }, 4000).going?.state === "fixing" &&
    L.going(red.going, { type: "rested" }, 4000).going === undefined && L.going(g, { type: "rested" }, 4000).going === g &&
    fixed?.state === "waiting" && fixed.fixes === 1 && fixed.since === 5000 && L.going(g, { type: "landed", commit: "" }, 4000).going === undefined &&
    L.goingLine(g) === g.why && L.goingLine(red.going) === "" && L.waitsLive(g) && L.waitsLive(blocked.going) && !L.waitsLive(red.going) && !L.waitsLive(live.going), fixed)

  const job = { state: "working" as const, going: undefined, exited: undefined, session: "s1", at: 0 }, idle = { running: true, state: "idle" }
  const R = (c: Any, now: number, o: Any = {}, j: Any = job, w: Any = idle) => L.read(j, c, w, now, { sending: false, pace: P, ...o })
  const first = R({}, 10_000), early = R(first.clock, 11_499), held = R(first.clock, 11_500)
  check("joblife: its worker at rest is read again a moment later; at rest for hold, that's its turn's end; while it's being typed into, it isn't",
    first.clock.rest === 10_000 && JSON.stringify(first.next) === JSON.stringify([{ do: "again", ms: P.hold + 100 }]) && !first.ev && early.next.length === 0 &&
    JSON.stringify(held.next) === JSON.stringify([{ do: "finish" }]) && R(first.clock, 11_500, { sending: true }).next.length === 0 && R(first.clock, 11_500, { sending: true }).clock.rest === undefined, [first, early, held])
  const on = L.turnOver(job, held.clock, "working", "", 11_500), soon = R(on.clock, 20_000), later = R(on.clock, 11_500 + P.read)
  check("joblife: a turn over with its work going on (its background tasks) stays working, read again only after read",
    on.ev === "working" && on.clock.goingOn === 11_500 && on.clock.rest === 10_000 && soon.next.length === 0 && JSON.stringify(later.next) === JSON.stringify([{ do: "finish" }]), [on, soon, later])
  const busy = R(on.clock, 30_000, {}, job, { running: true, state: "working" })
  const waits = R(first.clock, 11_500, {}, { ...job, going: g })
  check("joblife: working again clears its rest; a landed commit waited on holds its turn's end; one ended is read once",
    busy.ev === "working" && busy.clock.rest === undefined && busy.clock.goingOn === undefined && busy.next.length === 0 && waits.next.length === 0 &&
    JSON.stringify(R({}, 1, {}, job, { running: false }).next) === JSON.stringify([{ do: "end" }]) && R({}, 1, {}, { ...job, exited: 1 }, { running: false }).next.length === 0 &&
    R({}, 1, {}, job, { running: true, state: "blocked" }).ev === "asks" && R({}, 1, {}, job, { running: true, state: "error" }).ev === "error")
  const nobody = { ...job, session: undefined }, asked = R({}, 1000, {}, nobody, { running: true, state: "working" })
  check("joblife: its session asked for while it works, at most every learn",
    asked.next.some((x) => x.do === "learn") && !R(asked.clock, 1000 + P.learn - 1, {}, nobody, { running: true, state: "working" }).next.length &&
    R(asked.clock, 1000 + P.learn, {}, nobody, { running: true, state: "working" }).next.some((x) => x.do === "learn"), asked)
  const done = { ...job, state: "done" as const, at: 50_000 }
  check("joblife: one done keeps its terminal for grace after it moved or was opened, then it's closed",
    !R({}, 50_000 + P.grace - 1, {}, done).next.length && R({}, 50_000 + P.grace, {}, done).next[0]?.do === "tidy" &&
    !R({ opened: 100_000 }, 50_000 + P.grace, {}, done).next.length && !R({}, 50_000 + P.grace, {}, done, { running: true, state: "working" }).next.some((x) => x.do === "tidy"))
  const kept = L.turnOver(job, held.clock, "landed", c7, 12_000), plain = L.turnOver(job, held.clock, "landed", "", 12_000), back = L.turnOver({ going: red.going }, held.clock, "changed", "", 12_000)
  check("joblife: its turn over having landed where its server takes main waits for its commit, working; else it's landed; a fix's turn over ends its going live",
    kept.ev === "working" && kept.going?.state === "waiting" && kept.going.commit === c7 && kept.clock.rest === undefined && plain.ev === "landed" && !plain.going &&
    back.ev === "changed" && !back.going, [kept, plain, back])
  const cut = L.going(red.going, { type: "ended" }, 13_000), calm = L.going(kept.going, { type: "ended" }, 13_000)
  check("joblife: its terminal ending while it fixed forward leaves it stuck, needing the user; ending while it waits to go live changes nothing",
    cut.going?.state === "stuck" && cut.ev === "asks" && cut.going.why === "1a2b3c4 isn't live, and its terminal ended before a fix landed: it needs you" &&
    calm.going === kept.going && !calm.ev, [cut, calm])

  const W = (o: Any = {}) => ({ machine: "", label: "M", cwd: "/r", repo: "r", agent: "claude", account: "", harness: "", model: "", effort: "", why: "", ...o })
  const D = (j: Any, c: Any, n: number, now: number) => L.due({ at: now, exited: undefined, going: undefined, pruned: undefined, ...j, where: W(j.where) }, c, n, now, P)
  const here = { state: "working" }, far = { state: "working", where: { machine: "studio" } }, ready = { state: "ready for review" }
  check("joblife: a live job's worker read every other tick, on another machine every tick; one ready for review looked for on main every ship, however old",
    D(here, {}, 2, 0).read && !D(here, {}, 3, 0).read && D(far, {}, 3, 0).read && D(ready, {}, 7, 0).ship && !D(ready, { ship: 1000 }, 7, 1000 + P.ship - 1).ship &&
    D(ready, { ship: 1000 }, 7, 1000 + P.ship).ship && D({ ...ready, at: 0 }, {}, 10, 7 * 3600_000).ship && !D({ ...ready, at: 0 }, {}, 10, 7 * 3600_000).read &&
    D(ready, {}, 10, 0).read && !D(ready, {}, 9, 0).read && !D({ ...ready, where: { repo: "" } }, {}, 7, 0).ship)
  const closed = { state: "done", exited: 5, where: { tree: "/r-j1" } }
  check("joblife: its landed commit looked for live every live; a closed job's worktree looked at every 20 ticks, an hour apart, only once its terminal's gone",
    D({ going: g }, {}, 1, 0).live && !D({ going: g }, { live: 0 }, 1, P.live - 1).live && D({ going: g }, { live: 0 }, 1, P.live).live && !D({ going: red.going }, {}, 1, 0).live &&
    D(closed, {}, 20, 0).prune && !D(closed, {}, 19, 0).prune && !D(closed, { prune: 0 }, 40, P.prune - 1).prune && !D({ ...closed, exited: undefined }, {}, 20, 0).prune &&
    D({ ...closed, state: "stopped", exited: undefined }, {}, 20, 0).prune && !D({ ...closed, pruned: 1 }, {}, 20, 0).prune)
}
