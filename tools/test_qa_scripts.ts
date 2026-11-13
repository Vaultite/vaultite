// Which QA script runs a change reaches (tools/qa_scripts.ts): a change only to a script's comments runs none. In npm test.
import { check, exit, section, summary } from "./test/lib.ts"
import { runsTheSame, usageArgs } from "./qa_scripts.ts"
const t0 = Date.now()

const script = `// Tabs: what a click opens.
//   node web/qa/tabs.mjs <base url> [out dir]
import { qa } from "./lib/qa.mjs"
// opens the note
const { args: [B] } = await qa(import.meta.url)
await fetch(B + "x") // (a request)
`
const edit = (from: string, to: string) => runsTheSame("web/qa/tabs.mjs", script, script.replace(from, to))

section("runsTheSame")
const rows: [string, boolean, boolean][] = [
  ["a body comment deleted", edit("// opens the note\n", ""), true],
  ["a trailing comment deleted", edit(" // (a request)", ""), true],
  ["the head's prose rewritten", edit("Tabs: what a click opens.", "Tabs."), true],
  ["code changed", edit('"x"', '"y"'), false],
  ["a comment-like string changed", runsTheSame("web/qa/a.mjs", 'const s = "// a"\n', 'const s = "// b"\n'), false],
  ["a usage argument dropped", edit(" [out dir]", ""), false],
  ["a parse error", edit("await fetch(", "await fetch(("), false],
]
for (const [name, got, want] of rows) check(name, got === want, got)

section("usage")
check("reads the usage line's arguments", usageArgs("tabs", script).join(" ") === "<base url> [out dir]", usageArgs("tabs", script))
check("none without one", usageArgs("other", script).length === 0)

await exit(summary("qa_scripts", t0))
