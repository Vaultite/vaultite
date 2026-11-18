import { execFile } from "node:child_process"
import { z } from "zod"
import type { CloudPr } from "./cloud.ts"

const PrNode = z.object({ number: z.number(), url: z.string().regex(/^https:\/\//), state: z.unknown().optional(), isDraft: z.unknown().optional() })
const Prs = z.object({ data: z.record(z.string(), z.object({ pullRequests: z.object({ nodes: z.array(z.unknown()) }) }).nullable().catch(null)) })

/** Each ref's newest pull request, in one GraphQL query; null when GitHub couldn't be asked (no login, offline). */
export function askGitHub(gh: string, refs: [string, string][]): Promise<Map<string, CloudPr> | null> {
  const vars: string[] = [], parts: string[] = [], decl: string[] = []
  refs.forEach(([repo, branch], i) => {
    const [owner, name] = repo.split("/")
    decl.push(`$o${i}: String!, $n${i}: String!, $b${i}: String!`)
    parts.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequests(headRefName: $b${i}, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number url state isDraft } } }`)
    vars.push("-f", `o${i}=${owner}`, "-f", `n${i}=${name}`, "-f", `b${i}=${branch}`)
  })
  const query = `query(${decl.join(", ")}) { ${parts.join(" ")} }`
  return new Promise((done) => execFile(gh, ["api", "graphql", "-f", `query=${query}`, ...vars], { timeout: 20_000, maxBuffer: 4 << 20 }, (_e, out) => {
    // (a repository it can't see answers null among the rest: the others still count)
    let answer: unknown
    try { answer = JSON.parse(out) } catch { return done(null) }
    const prs = Prs.safeParse(answer)
    if (!prs.success) return done(null)
    const got = new Map<string, CloudPr>()
    refs.forEach(([repo, branch], i) => {
      const node = PrNode.safeParse(prs.data.data[`r${i}`]?.pullRequests.nodes[0])
      if (!node.success) return
      const n = node.data
      const state = n.state === "MERGED" ? "merged" : n.state === "CLOSED" ? "closed" : n.isDraft ? "draft" : "open"
      got.set(`${repo} ${branch}`, { number: n.number, url: n.url, state })
    })
    done(got)
  }))
}
