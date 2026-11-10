// What a new code root asks of each process (core/update/plan.ts): its rules as tables on a made-up graph, then a few
// rows on this checkout's own module graph. In npm test.
import path from "node:path"
import { check, exit, section, summary } from "./test/lib.ts"
import type { Hit } from "../core/update/closure.ts"
import { diskTree, graphOf } from "../core/update/closure.ts"
import { type Plan, type PlanInput, planUpdate } from "../core/update/plan.ts"
const t0 = Date.now()

const A = "a".repeat(40), B = "b".repeat(40), TO = "f".repeat(40), FP = "1".repeat(64)
// (a made-up graph: each entry reaches the files listed; "?" in a list is a loose end, so anything changed reaches it)
const reach: Record<string, string[]> = {
  server: ["server.ts", "core/vault.ts"], desktop: ["electron/main.ts", "core/vault.ts"], helper: ["electron/helper.ts"],
  web: ["web/src/app.tsx"], termd: ["plugins/core/terminal/termd/termd.ts"], chatd: ["?"],
}
const graph = { hit: (e: string, changed: string[]): Hit | null => {
  if (reach[e].includes("?")) return changed.length ? { file: changed[0], chain: [], unknown: { file: "x.ts", line: 3, kind: "import", text: "import(name)" } } : null
  const f = changed.find((c) => reach[e].includes(c))
  return f ? { file: f, chain: [f] } : null
} }
const all = { ui: A, server: { code: A, web: A }, main: A }
const plan = (changed: string[] | null, o: Partial<PlanInput> = {}) => planUpdate({ to: TO, running: all, changed: { [A]: changed }, graph, shell: { running: FP, root: FP }, ...o })
const row = (p: Plan) => `ui ${p.ui}, server ${p.server}, main ${p.main}, shell ${p.shell}${p.stale.length ? `, stale ${p.stale.join(" ")}` : ""}`

section("the table")
const rows: [string, string[] | null, Partial<PlanInput>, string][] = [
  ["nothing any process runs (docs, tests)", ["README.md", "tools/test_x.ts"], {}, "ui none, server none, main none, shell none"],
  ["the web app only: pages reload, the server takes the new build", ["web/src/app.tsx"], {}, "ui reload, server adopt-web, main none, shell none"],
  ["the server's code only", ["server.ts"], {}, "ui none, server restart, main none, shell none"],
  ["code both reach: both", ["core/vault.ts"], {}, "ui none, server restart, main relaunch, shell none"],
  ["the server's code and the web app: a restart serves the new build", ["server.ts", "web/src/app.tsx"], {}, "ui reload, server restart, main none, shell none"],
  ["the helper (a slice of main): main relaunches", ["electron/helper.ts"], {}, "ui none, server none, main relaunch, shell none"],
  ["what changed isn't known: everything that runs", null, {}, "ui reload, server restart, main relaunch, shell none"],
  ["no graph: everything that runs", ["README.md"], { graph: null }, "ui reload, server restart, main relaunch, shell none"],
  ["another shell: rebuilt, main and the servers on it", ["web/src/app.tsx"], { shell: { running: FP, root: "2".repeat(64) } }, "ui reload, server restart, main relaunch, shell rebuild"],
  ["a shell fingerprint not known: rebuilt", ["README.md"], { shell: { running: null, root: FP } }, "ui none, server restart, main relaunch, shell rebuild"],
  ["nothing running: nothing to do but the shell's", ["core/vault.ts"], { running: {} }, "ui none, server none, main none, shell none"],
  ["a process already on the new commit: left alone", ["core/vault.ts"], { running: { ui: TO, server: { code: TO, web: TO }, main: TO } }, "ui none, server none, main none, shell none"],
  ["the keepers are never restarted, only said stale", ["plugins/core/terminal/termd/termd.ts"], { running: { keepers: { termd: A, chatd: A } } }, "ui none, server none, main none, shell none, stale termd chatd"],
]
for (const [name, changed, o, want] of rows) {
  const p = plan(changed, o)
  check(name, row(p) === want, { got: row(p), want, why: p.why })
}

section("each process from its own commit")
{
  // (the server took a web-only update before: its code is older than the build it serves; the pages are newer still)
  const p = planUpdate({ to: TO, running: { ui: B, server: { code: A, web: B }, main: B }, changed: { [A]: ["server.ts", "web/src/app.tsx"], [B]: ["web/src/app.tsx"] }, graph, shell: { running: FP, root: FP } })
  check("each judged by what changed since its own start", row(p) === "ui reload, server restart, main none, shell none", { got: row(p), why: p.why })
  const q = planUpdate({ to: TO, running: { ui: B, server: { code: A, web: B }, main: A }, changed: { [B]: ["web/src/app.tsx"] }, graph, shell: { running: FP, root: FP } })
  check("one whose start isn't known: the heavier", row(q) === "ui reload, server restart, main relaunch, shell none" && /isn't known/.test(q.why.server ?? ""), { got: row(q), why: q.why })
}
check("why: the file and the chain", /server runs server\.ts, which changed/.test(plan(["server.ts"]).why.server ?? "") && /can't be followed past x\.ts:3/.test(plan(["x"], { running: { keepers: { chatd: A } } }).why.chatd ?? ""))

await section("on this checkout's own graph", async () => {
  const g = graphOf(diskTree(path.dirname(import.meta.dirname)))
  const real = (changed: string[]) => row(planUpdate({ to: TO, running: all, changed: { [A]: changed }, graph: g, shell: { running: FP, root: FP } }))
  check("a page's component: reload and adopt", real(["web/src/components/Toast.tsx"]) === "ui reload, server adopt-web, main none, shell none", real(["web/src/components/Toast.tsx"]))
  check("the menu-bar helper: main only", real(["electron/helper.ts"]) === "ui none, server none, main relaunch, shell none", real(["electron/helper.ts"]))
  check("a doc for people: nothing", real(["CHANGELOG.md"]) === "ui none, server none, main none, shell none", real(["CHANGELOG.md"]))
  check("the vault index: the server", real(["core/vault.ts"]).includes("server restart"), real(["core/vault.ts"]))
})

await exit(summary("plan", t0))
