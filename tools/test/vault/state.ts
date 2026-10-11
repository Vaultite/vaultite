import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read } = $
  let [, s] = await api("GET", "state")
  check("state loads", Array.isArray(s.people) && "vault" in s, Object.keys(s))
  check("no problems in the vault", !s.vault.problems.length, s.vault.problems.slice(0, 3))
  check("state: what kinds draw and keep (a person's Timeline; a note's UTC times), and only theirs",
    JSON.stringify(s.kinds.people?.sections) === '["timeline"]' && JSON.stringify(s.kinds.notes?.stamps) === '["created","updated"]' && !s.kinds.notes.sections.length, s.kinds)
  check("the rules are the app's own file, short, no index", read(".vaultite/AGENTS.md").includes("## Rules") && !read(".vaultite/AGENTS.md").includes("- `query`:")
    && Buffer.byteLength(read(".vaultite/AGENTS.md")) < 3_000, Buffer.byteLength(read(".vaultite/AGENTS.md")))
  check("the rules: each plugin that's on adds its line, a setting filled in", read(".vaultite/AGENTS.md").includes("\n## Plugins\n") && read(".vaultite/AGENTS.md").includes("\n- `ME.md` is the user")
    && !read(".vaultite/AGENTS.md").includes("`.vaultite/AGENTS.md` is the vault's rules"), read(".vaultite/AGENTS.md"))
  {
    const [lc, topics] = await api("GET", "docs")
    check("docs: every topic, the core's first", lc === 200 && topics[0].plugin === null && topics.some((t: Any) => t.id === "vault")
      && topics.some((t: Any) => t.id === "people" && t.plugin === "people"), topics)
    const [pc, people] = await api("GET", "docs/people")
    check("docs: a plugin's whole AGENTS.md, then its blocks from the manifest", pc === 200 && people.includes("## People") && people.includes("`moving_to")
      && !people.includes("<!-- docs -->") && people.includes("- `people-group`:"), people.slice(-400))
    const [qc, query] = await api("GET", "docs/Database%20views")
    check("docs: by a title's words", qc === 200 && query.startsWith("## Database views"), query.slice(0, 80))
    const [nc, near] = await api("GET", "docs/peple")
    check("docs: an unknown topic names the nearest", nc === 404 && near.error.includes("did you mean people"), near)
  }
}
