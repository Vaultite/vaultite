import { check, section } from "../lib.ts"
import { type Any, same, web } from "./lib.ts"

await section("view switch", async () => {
  const vs: Any = await web("components/viewSwitch.ts")
  const spot = { box: null, y: 300, ratio: 0.5, line: 12 }
  const at = { line: 4, col: 0 }
  const drive = (events: Any[], from: Any = vs.SWITCH_START) => {
    let s = from
    const did = events.map((e) => { const r = vs.stepSwitch(s, e); s = r.state; return r.effects.join(" ") })
    return { s, did, label: vs.switchLabel(s) }
  }
  const shownLive = { type: "shown", shown: "live", canFocus: true, editor: true, coming: false }
  const toLive = [{ type: "pick", to: "live", shown: "read" }, { type: "noted", spot }, shownLive]
  {
    const r = drive([...toLive, { type: "placed", n: 1 }, { type: "held", n: 1 }, { type: "left" }])
    check("view switch: read to live notes the place, holds it hidden, shows it once there, then the cursor goes in",
      same(r.did, ["note leave pick", "", "place", "shown land", "show", "halt"]) && r.label === "steady", r)
  }
  {
    const r = drive([{ type: "pick", to: "source", shown: "live" }, { type: "noted", spot }, { ...shownLive, shown: "source", editor: false, coming: true },
      { type: "ready" }, { type: "gave-up", n: 1 }, { type: "placed", n: 1 }, { type: "left" }])
    check("view switch: into source, it waits for the new editor, places on it, and a late 5 s fallback is dropped",
      same(r.did, ["note leave pick", "", "wait", "place", "", "shown land", "show halt"]), r)
  }
  {
    const r = drive([...toLive, { type: "pick", to: "read", shown: "live" }, { type: "noted", spot }, { type: "left" },
      { type: "shown", shown: "read", canFocus: true, editor: true, coming: false }, { type: "placed", n: 1 }, { type: "held", n: 1 }])
    check("view switch: a second switch while placing ends the first (shown, its cursor started and stopped), and the first's late outcomes are dropped",
      same(r.did, ["note leave pick", "", "place", "note leave blur pick", "", "show land halt", "place", "", ""]) && r.label === "placing 2", r)
  }
  {
    const r = drive([{ type: "pick", to: "read", shown: "live" }, { type: "noted", spot }, { ...shownLive, shown: "read" }, { type: "held", n: 1 }])
    check("view switch: into reading, the place is kept and the cursor stays out", same(r.did, ["note leave blur pick", "", "place", "shown"]) && r.label === "landed 1", r)
  }
  {
    const r = drive([{ type: "edit-at", shown: "read", to: "live", at }, { type: "elsewhere", to: "live", shown: "read", follows: true }, { type: "noted", spot }, shownLive])
    check("view switch: an edit at a line from reading goes to editing, veiled, and keeps no place of its own (the line is its place)",
      same(r.did, ["cancel pick veil line", "note", "", ""]) && r.s.run === null && r.s.open === "took", r)
    const live = drive([{ type: "edit-at", shown: "live", to: "live", at }])
    check("view switch: an edit at a line while editing only moves the cursor", same(live.did, ["cancel line"]), live)
  }
  {
    const r = drive([{ type: "elsewhere", to: "read", shown: "live", follows: true }, { type: "noted", spot }, { ...shownLive, shown: "read" }, { type: "placed", n: 1 }])
    const off = drive([{ type: "elsewhere", to: "read", shown: "live", follows: false }, { type: "elsewhere", to: "live", shown: "live", follows: true }])
    const mine = drive([{ type: "elsewhere", to: "live", shown: "read", follows: true }], drive(toLive.slice(0, 2)).s)
    check("view switch: another window's switch keeps the place, the cursor left out; ignored when the view doesn't follow the tab, or a place is noted",
      same(r.did, ["note", "", "place", "shown"]) && same(off.did, ["", ""]) && same(mine.did, [""]), { r, off, mine })
  }
  {
    const p = (shown: string, hidden: boolean) => drive([{ type: "properties", shown, to: hidden ? "source" : "live", hidden }]).did[0]
    check("view switch: This file's properties goes to editing from reading, to source when they're hidden, else stays",
      p("read", false) === "pick" && p("live", false) === "" && p("live", true) === "pick" && p("source", true) === "", [p("read", false), p("live", false), p("live", true)])
  }
  {
    const r = drive([{ type: "mounted", opens: true }, { type: "framed", typing: false }, { type: "found" }, { type: "edit-at", shown: "live", to: "live", at }, { type: "mounted", opens: true }])
    check("view switch: a file opening puts the cursor back once its place is found; an edit at a line takes over for good",
      same(r.did, ["frames", "await", "focus", "unopen cancel line", ""]) && r.s.open === "took", r)
    const early = drive([{ type: "mounted", opens: true }, { type: "edit-at", shown: "live", to: "live", at }, { type: "framed", typing: false }, { type: "unmounted" }])
    const press = drive([{ type: "mounted", opens: true }, { type: "framed", typing: false }, { type: "pressed" }, { type: "found" }])
    const typing = drive([{ type: "mounted", opens: true }, { type: "framed", typing: true }])
    check("view switch: ...before its frames too; a press or typing elsewhere cancels it",
      same(early.did, ["frames", "cancel line", "", ""]) && same(press.did, ["frames", "await", "unopen", ""]) && typing.s.open === "none", { early, press, typing })
  }
  {
    const r = drive([{ type: "ready" }, { type: "left" }, { type: "placed", n: 0 }])
    const gone = drive([{ type: "pick", to: "source", shown: "live" }, { type: "noted", spot }, { ...shownLive, shown: "source", editor: false, coming: true }, { type: "left" }, { type: "late-shown", n: 1 }])
    check("view switch: an editor ready with no switch hands over to a restore; one gone mid-wait is shown and its timers dropped",
      same(r.did, ["resume", "", ""]) && same(gone.did, ["note leave pick", "", "wait", "halt show", ""]), { r, gone })
  }
})
