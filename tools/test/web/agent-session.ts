import { check } from "../lib.ts"
import { type Any, web } from "./lib.ts"

const { groupsOf }: { groupsOf(entries: Any[], start: number): Any[] } = await web("components/sessionGroups.ts")
const tool = (id: string) => ({ kind: "tool", id, name: "Bash", summary: "", input: "", result: null, error: false, at: "" })
const said = (kind: string, text: string) => ({ kind, text, at: "" })
const drawn = (gs: Any[]) => gs.map((g) => (g.kind === "tools" ? `${g.at}:tools:${g.tools.map((t: Any) => t.id).join("+")}` : `${g.at}:${g.said.kind}`)).join(" ")
check("session groups: tool calls in a row are one group at the first's place, each message its own",
  drawn(groupsOf([said("user", "a"), tool("t1"), tool("t2"), said("assistant", "b"), said("assistant", "c"), tool("t3")], 10)) === "10:user 11:tools:t1+t2 13:assistant 14:assistant 15:tools:t3",
  drawn(groupsOf([said("user", "a"), tool("t1"), tool("t2"), said("assistant", "b"), said("assistant", "c"), tool("t3")], 10)))
check("session groups: a page starting on tool calls, and none", drawn(groupsOf([tool("t1"), tool("t2")], 0)) === "0:tools:t1+t2" && groupsOf([], 0).length === 0)
