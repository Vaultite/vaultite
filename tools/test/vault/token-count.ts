import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, app, check, vault, write } = $
  // Token count: each Markdown file against its limit, and what a CLAUDE.md loads with its @imports (token-count/plugin.ts).
  {
    write("Size/CLAUDE.md", "Short.\n@rules.md and @./deep/a.md\n`@code.md`, @alice, @~/elsewhere.md, @gone.md.\n\n```\n@fenced.md\n```\n")
    write("Size/rules.md", "word ".repeat(1500) + "\n@CLAUDE.md\n")
    write("Size/deep/a.md", "@../rules.md\nThe end.\n")
    write("Size/code.md", "Not imported.\n")
    write("Size/Long.md", "---\nmax_tokens: 100\n---\n" + "word ".repeat(200))
    write(".claude/skills/demo/SKILL.md", "word ".repeat(6000))
    await vault.synced()
    const sized = async (params: Any) => { const { op, params: p, result } = await app.runOp("token-count.size", params); return { r: result as Any, text: op.text!(result, p) } }
    const { r, text } = await sized({})
    const root = r.files.find((s: Any) => s.path === "Size/CLAUDE.md")
    check("token-count: a CLAUDE.md's chain follows its imports (relative ones too), once each, not in code or fences", root?.chain.map((c: Any) => c.path).join() === "Size/rules.md,Size/deep/a.md"
      && root.total === root.tokens + root.chain.reduce((n: number, c: Any) => n + c.tokens, 0), root)
    check("token-count: imports outside the vault and missing ones are named, a mention isn't", root?.outside?.join() === "~/elsewhere.md" && root?.missing?.join() === "gone.md", root)
    check("token-count: a file's own max_tokens is its limit", r.files.find((s: Any) => s.path === "Size/Long.md")?.level === "over")
    check("token-count: agent files in hidden folders count (a skill over 5k)", r.files.find((s: Any) => s.path === ".claude/skills/demo/SKILL.md")?.limit === 5000)
    check("token-count: an ordinary note has no limit by default", r.files.every((s: Any) => s.path !== "Size/code.md" || s.limit === 0) &&
      (await sized({ path: "Size/code.md" })).r.files[0]?.limit === 0)
    check("token-count: the text says what's over", /Over their limit[\s\S]*Size\/Long\.md[\s\S]*Loaded at startup[\s\S]*@Size\/rules\.md/.test(text), text)
    const st = (await app.state()).tokenCount
    check("token-count: the app gets the flagged files and the chains, not every file", st.files.some((s: Any) => s.path === "Size/CLAUDE.md") && !st.files.some((s: Any) => s.path === "Size/code.md") && st.limits.limits["CLAUDE.md"] === 3000, st)
    const one = await sized({ path: path.join(VAULT, "Size/Long.md"), over: true })
    check("token-count: an absolute path inside the vault (a hook's) answers that file", one.r.files.length === 1 && one.text.startsWith("Over its limit:"), one)
    check("token-count: --over says nothing for a file under its limit or outside the vault", (await sized({ path: "Size/code.md", over: true })).text === ""
      && (await sized({ path: "/etc/hosts", over: true })).text === "")
    write(".vaultite/plugins/token-count/data.json", JSON.stringify({ limit: 50, limits: { "Size/deep/*.md": 0 } }) + "\n")
    await vault.synced()
    const set = (await sized({ path: "Size/code.md" })).r.files[0], deep = (await sized({ path: "Size/deep/a.md" })).r.files[0]
    check("token-count: settings change the limits, a pattern of 0 turns one off, the others stay", set.limit === 50 && deep.limit === 0 && deep.level === "ok"
      && (await sized({ path: "Size/CLAUDE.md" })).r.files[0].limit === 3000, [set, deep])
    for (const p of ["Size", ".claude", ".vaultite/plugins/token-count"]) fs.rmSync(path.join(VAULT, p), { recursive: true, force: true })
  }
}
