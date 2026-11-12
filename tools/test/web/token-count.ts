import { check } from "../lib.ts"

// ---------- Token count's estimate (plugins/core/token-count/estimate.ts) ----------
{
  const { estimateTokens, tokenText } = await import("../../../plugins/core/token-count/estimate.ts")
  const prose = "The quick brown fox jumps over the lazy dog, then naps in the warm afternoon sun. ".repeat(40)
  const code = "const total = items.reduce((sum, x) => sum + x.price * x.qty, 0);\n  if (total > 100) { apply(discount); }\n".repeat(40)
  const pr = estimateTokens(prose), co = estimateTokens(code)
  check("tokens: prose near characters / 4", pr > prose.length / 5 && pr < prose.length / 3.3, [pr, prose.length])
  check("tokens: code costs more per character than prose", co / code.length > pr / prose.length && co < code.length / 2, [co, code.length])
  check("tokens: CJK about one a character, other scripts more than English", Math.abs(estimateTokens("東京の天気は晴れです") - 12) <= 2
    && estimateTokens("Привет, как дела у тебя сегодня") > estimateTokens("Hello, how are you doing today"), [estimateTokens("東京の天気は晴れです")])
  check("tokens: nothing is nothing", estimateTokens("") === 0 && estimateTokens("word") === 1)
  const big = (prose + code).repeat(200), exact = 200 * (estimateTokens(prose) + estimateTokens(code))
  check("tokens: a big text's, from samples, within 2%", big.length > 1 << 20 && Math.abs(estimateTokens(big) - exact) / exact < 0.02, [estimateTokens(big), exact])
  check("tokens: written short", [1, 840, 1000, 1240, 12_345, 999_499, 1_400_000].map(tokenText).join("|") === "~1 token|~840 tokens|~1k tokens|~1.2k tokens|~12k tokens|~999k tokens|~1.4M tokens",
    [1, 840, 1000, 1240, 12_345, 999_499, 1_400_000].map(tokenText))
}

// ---------- Token count's limits (plugins/core/token-count/limits.ts) ----------
{
  const { importsOf, levelOf, limitsOf, matches, ruleFor } = await import("../../../plugins/core/token-count/limits.ts")
  const l = limitsOf({ limits: { "Notes/**": 2000, "*.prompt.md": 500, "ME.md": 0 } }, { limit: 10000, limits: { "CLAUDE.md": 3000, ".vaultite/AGENTS.md": 1000, "AGENTS.md": 3000 } })
  check("limits: a name matches in any folder, case and all", matches("CLAUDE.md", "a/b/CLAUDE.md") && !matches("CLAUDE.md", "Dashboards/Claude.md") && matches("*.prompt.md", "x/y.prompt.md"))
  check("limits: a path matches from the vault's top, ** across folders", matches("Notes/**", "Notes/a/b.md") && !matches("Notes/**", "Old/Notes/b.md") && matches(".claude/skills/**/SKILL.md", ".claude/skills/x/SKILL.md"))
  check("limits: a path beats a name, max_tokens beats both, else the limit for any file", ruleFor(".vaultite/AGENTS.md", {}, l).limit === 1000 && ruleFor("AGENTS.md", {}, l).limit === 3000
    && ruleFor("Notes/x.md", { max_tokens: 40000 }, l).by === "max_tokens" && ruleFor("Other.md", null, l).limit === 10000 && ruleFor("ME.md", {}, l).limit === 0)
  check("limits: near at 80%, over past it, none with no limit", levelOf(799, 1000) === "ok" && levelOf(800, 1000) === "near" && levelOf(1001, 1000) === "over" && levelOf(1e9, 0) === "ok")
  check("limits: imports as Claude Code reads them (not in code, not an email, a trailing period off)",
    importsOf("@AGENTS.md\nSee @.vaultite/AGENTS.md.\nMail a@b.com, `@x.md`\n```\n@y.md\n```\n@~/z.md").join() === "AGENTS.md,.vaultite/AGENTS.md,~/z.md",
    importsOf("@AGENTS.md\nSee @.vaultite/AGENTS.md.\nMail a@b.com, `@x.md`\n```\n@y.md\n```\n@~/z.md"))
}
