import { check, section } from "../lib.ts"
import { type Any, same, web } from "./lib.ts"

await section("closed tabs toast", async () => {
  const co: Any = await web("core/closedoffer.ts")
  const drive = (events: Any[]) => {
    let s = co.QUIET
    const did = events.map((e) => { const r = co.stepOffer(s, e); s = r.state; return r.effects.map((x: Any) => x.do).join(" ") })
    return { s, did }
  }
  const r = drive([{ type: "closed", id: "a", n: 3 }, { type: "changed", closed: ["a"] }, { type: "closed", id: "b", n: 2 },
    { type: "changed", closed: ["b"] }, { type: "changed", closed: [] }, { type: "changed", closed: [] }])
  check("closed tabs toast: offered while they're closed, the next close replacing it, gone once they're back (by any way), with nothing left watching",
    same(r.did, ["offer watch", "", "unwatch offer watch", "", "dismiss unwatch", ""]) && r.s.kind === "quiet", r)
})
