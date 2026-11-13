// The repo's lint rules (.oxlintrc.json, tools/oxlint/vaultite.ts) on the real mistakes they were made for, each from
// its commit, and the ratchet's comparison (tools/ratchet/compare.ts).
import { check, exit, section, summary } from "./test/lib.ts"
import { compare } from "./ratchet/compare.ts"
import { type Finding, lint } from "./ratchet/lint.ts"

const t0 = Date.now()
const rulesOf = (file: string, text: string) => lint(new Map([[file, text]]), false).map((f) => f.rule)
const fires = (rule: string, file: string, bad: string, good: string) => {
  check(`${rule} fires on the mistake`, rulesOf(file, bad).includes(rule), rulesOf(file, bad))
  check(`${rule} passes its fix`, !rulesOf(file, good).includes(rule), rulesOf(file, good))
}

await section("rules on past mistakes", () => {
  // b205569a typed the version reply by hand; the server's reply changed and 61ddf9551 had to fix the desktop app.
  fires("vaultite(no-unchecked-json)", "electron/main.ts",
    "fetch(u).then((r) => r.json()).then((j: { result?: { commit?: unknown } }) => String(j.result?.commit ?? \"\"))",
    "import * as z from \"zod\"\nconst Reply = z.object({ commit: z.string() })\nfetch(u).then((r) => r.json()).then((j) => Reply.parse(j).commit)")
  // aed5befa cast the cloud reply; 6f96b575 found its terms weren't always strings.
  fires("vaultite(no-cast)", "electron/dictation.ts",
    "const c = (r.ok ? await r.json() : {}) as Partial<Cloud> & { why?: string }",
    "const c = Cloud.partial().parse(r.ok ? await r.json() : {})")
  // dd2d9dbe slept 800 ms for a fade; on a busy machine it wasn't enough (875dcea8).
  fires("vaultite(no-sleep)", "web/qa/barfade.mjs",
    "await setLook({ fileBarFade: \"off\", translucency: 80 }); await wait(800)",
    "await setLook({ fileBarFade: \"off\", translucency: 80 }); await page.waitForFunction(() => !document.getAnimations().length)")
  check("a member wait() for a state isn't a sleep", !rulesOf("web/qa/x.mjs", "await ui.toast.wait(\"Saved\")").includes("vaultite(no-sleep)"))
  check("a member wait(ms) is", rulesOf("web/qa/x.mjs", "await page.wait(500)").includes("vaultite(no-sleep)"))
  fires("vaultite(disable-reason)", "web/src/x.tsx",
    "// eslint-disable-next-line react-hooks/exhaustive-deps\nconst a = 1",
    "// eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per pane: its id never changes\nconst a = 1")
  fires("eslint(no-console)", "plugins/core/companion/jobs.ts",
    "try { await go() } catch (e) { console.error(`companion: jobs: trust:`, e) }",
    "try { await go() } catch (e) { log.error(\"companion: jobs: trust\", { error: e }) }")
  check("console stays allowed in tools", !rulesOf("tools/x.ts", "console.log(1)").includes("eslint(no-console)"))
  fires("vaultite(no-node-module-mock)", "tools/test/x.ts", "mock.module(\"node:fs\", {})", "const fs = fakeFs()")
  // 48f09102 cut paragraphs like this one to 2 lines by hand, across 100 files.
  fires("vaultite(comment-length)", "core/grants.ts",
    "// What a plugin may write outside .vaultite/ on its own (core/writegate.ts): its manifest's `writes` declares where and\n// why, and the user answers once per plugin, kept in .vaultite/grants.json ({\"activity\": {\"Recaps\": \"allowed\"}}).\n// \"ask\": a write wanted it before the user was asked, so the app asks; \"not now\": asked, and not given.\nexport const a = 1",
    "// A plugin's writes outside .vaultite/ need the user's yes, once per plugin (core/writegate.ts).\nexport const a = 1")
  check("comment-lines counts each line, not directives", rulesOf("core/x.ts", "// a\n// b\n// oxlint-disable-next-line no-console -- why\nconst a = 1").filter((r) => r === "vaultite(comment-lines)").length === 2)
  check("a trailing comment doesn't join the lines above", !rulesOf("core/x.ts", "// a\n// b\nconst a = 1 // c").includes("vaultite(comment-length)"))
  fires("vaultite(no-title-attr)", "web/src/components/X.tsx", "export const X = () => <button title=\"Close\" />", "export const X = () => <button data-tip=\"Close\" />")
  fires("vaultite(git-env)", "tools/test/x.ts", "execFileSync(\"git\", [\"init\"], { cwd: dir })", "execFileSync(\"git\", [\"init\"], { cwd: dir, env: gitEnv() })")
  fires("typescript(no-explicit-any)", "core/x.ts", "let a: any = 1", "let a: number = 1")
})

const f = (rule: string, text: string, weight = 1, file = "a.ts"): Finding => ({ rule, file, line: 1, text, weight, message: "" })

section("ratchet")
check("a new finding grows its rule", compare([], [f("r", "x")]).map((g) => g.rule).join() === "r")
check("code moved to another file isn't new", !compare([f("r", "x", 1, "a.ts")], [f("r", "x", 1, "b.ts")]).length)
check("fewer findings pass", !compare([f("r", "x"), f("r", "y")], [f("r", "x")]).length)
const lines = "eslint(max-lines)"
check("a file over the limit may grow", !compare([f(lines, "", 100)], [f(lines, "", 120)]).length)
check("a split may leave pieces over the limit, less past it in all", !compare([f(lines, "", 900, "a.ts")], [f(lines, "", 50, "a.ts"), f(lines, "", 60, "b.ts")]).length)
check("a new file over the limit grows it", compare([], [f(lines, "", 20, "b.ts")]).length === 1)
check("only what's new is listed", compare([f("r", "x")], [f("r", "x"), f("r", "y")])[0]?.added.map((a) => a.text).join() === "y")

await exit(summary("lint", t0))
