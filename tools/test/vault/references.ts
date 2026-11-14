import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { z } from "zod"
import { citationsIn } from "../../../plugins/core/references/cite.ts"
import type { VaultTest } from "./harness.ts"

const BIB = String.raw`@article{bush1945,
  author = {Bush, Vannevar}, title = {As We May Think}, journal = {The Atlantic Monthly},
  year = 1945, month = jul, volume = 176, number = 1, pages = {101--108}
}
@book{kuhn1962,
  author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions},
  publisher = {University of Chicago Press}, address = {Chicago}, year = 1962
}
@article{merton1968,
  author = {Merton, Robert K.}, title = {The {Matthew} Effect in Science}, journal = {Science},
  year = 1968, volume = 159, number = 3810, pages = {56--63}, doi = {10.1126/science.159.3810.56}
}`

type Stub = { server: http.Server; url: string; hits: string[] }
async function stub(answer: (url: string, body: string) => [number, string, Record<string, string>?]): Promise<Stub> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      hits.push(`${req.method} ${req.url}`)
      const [status, text, headers] = answer(req.url ?? "", body)
      res.writeHead(status, { "Content-Type": "application/json", ...headers })
      res.end(text)
    })
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const at = server.address()
  return { server, url: `http://127.0.0.1:${at instanceof Object ? at.port : 0}`, hits }
}

type Fields = Record<string, string | number | { family: string; given: string }[] | { "date-parts": number[][] }>
type Params = Record<string, string | boolean | string[]>
const zItem = (key: string, version: number, csl: Fields, extra = "") =>
  ({ key, version, data: { key, itemType: "journalArticle", extra }, csljson: { id: `1/${key}`, ...csl } })
const all = (...conds: boolean[]) => conds.every(Boolean)

const Results = z.object({ results: z.array(z.object({ key: z.string(), title: z.string(), from: z.string() })) })
const Got = z.object({ references: z.array(z.object({ text: z.string(), links: z.object({ doi: z.string() }) })) })
const Formatted = z.object({ citations: z.array(z.object({ text: z.string() })) })
const Status = z.object({ zotero: z.object({ local: z.object({ state: z.string(), items: z.number(), bbt: z.string().nullable() }) }) })
const Made = z.object({ path: z.string(), created: z.boolean() })
const Added = z.object({ key: z.string(), path: z.string().nullable(), already: z.boolean() })
type Ctx = VaultTest & { op: <S extends z.ZodType>(id: string, p: Params, schema: S) => Promise<z.infer<S>>; render: (rel: string) => Promise<string> }

function citations({ check }: Ctx) {
  const cites = citationsIn("---\ntitle: '@nope'\n---\nSee [@bush1945, p. 101; see @kuhn1962, pp. 3-5, my emphasis], and @merton1968 [chap. 2] or [-@kuhn1962].\n" +
    "Not these: a@b.com, `[@code]`, [[@wiki]], [^1], [link](http://x/@y), [@doe.2020] is.\n```\n[@fenced]\n```\n")
  const [a, b, c, d] = cites
  check("references: Pandoc's citations are read (prefix, locator and its label, suffix, author suppressed, in text, dotted keys)",
    all(cites.length === 4, a.items[0].locator === "101", a.items[1].prefix === "see", a.items[1].label === "page", a.items[1].suffix === "my emphasis",
      b.inText, b.items[0].label === "chapter", c.items[0].suppressAuthor, d.items[0].key === "doe.2020"), cites)
}

async function agentsRead({ check, write, vault, render }: Ctx) {
  write("Library.bib", BIB)
  write("Papers/Draft.md", "---\ntitle: Draft\n---\nMemory machines [@bush1945, p. 101] and paradigms [@kuhn1962]. @merton1968 named it. Hi @alice.\n")
  await vault.sync()
  let out = await render("Papers/Draft.md")
  check("references: a note's citations read in the user's style (APA) to agents, its references after, a mention left alone",
    all(out.includes("Memory machines (Bush, 1945, p. 101)"), out.includes("(Kuhn, 1962)"), out.includes("Merton (1968) named it"), out.includes("Hi @alice."),
      /## References[\s\S]*Bush, V\. \(1945\)\. As We May Think[\s\S]*Kuhn, T\. S\. \(1962\)[\s\S]*https:\/\/doi\.org\/10\.1126\/science\.159\.3810\.56/.test(out)), out)
  write("Papers/Draft.md", "---\ntitle: Draft\ncsl: ieee\n---\nFirst [@kuhn1962], then [@bush1945; @nobody].\n")
  await vault.sync()
  out = await render("Papers/Draft.md")
  check("references: a note's own style (csl:) numbers in order of citation, and says what isn't in the library",
    all(out.includes("First [1], then [2]"), /\[1\] T\. S\. Kuhn/.test(out), out.includes("@nobody")), out)
}

async function placedReferences({ check, write, vault, render }: Ctx) {
  write("Papers/Ends.md", "Memory machines [@bush1945].\n\n# References\n")
  write("Papers/Div.md", "Paradigms [@kuhn1962].\n\n::: {#refs}\n:::\n\n## Appendix\n\nMore.\n")
  await vault.sync()
  const ends = await render("Papers/Ends.md"), div = await render("Papers/Div.md")
  check("references: a note ending with its own References heading gets the list under it, no second heading",
    all((ends.match(/References/g) ?? []).length === 1, /# References\n\n- Bush, V\. \(1945\)/.test(ends)), ends)
  check("references: Pandoc's ::: {#refs} is where the list goes", all(/\n- Kuhn, T\. S\. \(1962\)[\s\S]*## Appendix/.test(div), !div.includes("{#refs}"), !div.includes("## References")), div)
}

async function agentOps({ check, op }: Ctx) {
  const found = await op("references.search", { query: "kuhn revolutions" }, Results)
  check("references: search finds by author and title words", found.results[0]?.key === "kuhn1962", found)
  const got = await op("references.get", { keys: ["@merton1968"], style: "chicago" }, Got)
  const ref = got.references[0]
  check("references: get formats in the style asked, with its DOI's link",
    all(!!ref?.text.startsWith("Merton, Robert K. 1968. “The Matthew Effect in Science.”"), ref?.links.doi === "https://doi.org/10.1126/science.159.3810.56"), got)
  const formatted = await op("references.format", { citations: ["[@bush1945, p. 33]", "@kuhn1962"], style: "apa" }, Formatted)
  check("references: format writes given citations", formatted.citations.map((c) => c.text).join(" | ") === "(Bush, 1945, p. 33) | Kuhn (1962)", formatted)
}

async function ownBibliography({ check, write, vault, render }: Ctx) {
  write("Papers/Thesis/refs.json", JSON.stringify([{ id: "merton-matthew", type: "article-journal", title: "The Matthew effect in science", DOI: "10.1126/SCIENCE.159.3810.56", author: [{ family: "Merton", given: "Robert K." }], issued: { "date-parts": [[1968]] } },
    { id: "local1", type: "book", title: "Only here", author: [{ family: "Park", given: "Alice" }], issued: { "date-parts": [[2026]] } }]))
  write("Papers/Thesis/Chapter.md", "---\nbibliography: refs.json\n---\nAs [@local1] and [@merton1968] say.\n")
  await vault.sync()
  const out = await render("Papers/Thesis/Chapter.md")
  check("references: a note's bibliography: (beside it) is cited from, and one work under two keys is one reference", all(out.includes("(Park, 2026)"), (out.match(/Matthew effect/gi) ?? []).length === 1), out)
}

function zoteroAnswer(url: string, body: string): [number, string, Record<string, string>?] {
  if (url.startsWith("/api/users/0/items/top?format=versions")) return [200, JSON.stringify({ AAAA1111: 3, BBBB2222: 4, NOTE0001: 2 }), { "Last-Modified-Version": "4" }]
  if (url.startsWith("/api/users/0/items?itemKey=")) return [200, JSON.stringify([
    zItem("AAAA1111", 3, { type: "book", title: "How to take smart notes", author: [{ family: "Ahrens", given: "Sönke" }], issued: { "date-parts": [[2017]] } }, "Citation Key: ahrens2017"),
    zItem("BBBB2222", 4, { type: "article-journal", title: "The extended mind", author: [{ family: "Clark", given: "Andy" }, { family: "Chalmers", given: "David" }], issued: { "date-parts": [[1998]] } }),
    { key: "NOTE0001", version: 2, data: { key: "NOTE0001", itemType: "note", note: "<p>x</p>" } }])]
  if (url.startsWith("/api/users/0/groups")) return [200, "[]"]
  if (url === "/better-bibtex/json-rpc") return [200, JSON.stringify({ result: body.includes("api.ready") ? { betterbibtex: "7.0.5", zotero: "7.0.11" } : { BBBB2222: "clark1998" } })]
  if (url.startsWith("/api/users/0/items/AAAA1111/children")) return [200, JSON.stringify([{ key: "PDF00001", version: 1, data: { key: "PDF00001", itemType: "attachment", contentType: "application/pdf" } },
    { key: "NOTE0002", version: 1, data: { key: "NOTE0002", itemType: "note", note: "<p>Read in <b>2024</b>.</p>" } }])]
  if (url.startsWith("/api/users/0/items/PDF00001/children")) return [200, JSON.stringify([{ key: "ANN00001", version: 1, data: { key: "ANN00001", itemType: "annotation", annotationText: "Writing is thinking", annotationComment: "Key claim", annotationPageLabel: "12", annotationSortIndex: "00001" } }])]
  return [404, "{}"]
}

async function zoteroLocal({ check, op, read, exists }: Ctx): Promise<string> {
  const zlocal = await stub(zoteroAnswer)
  process.env.VAULTITE_ZOTERO_URL = zlocal.url
  const status = await op("references.status", { sync: true }, Status)
  check("references: Zotero's local library is read, its keys from Zotero or Better BibTeX, notes left out",
    all(status.zotero.local.state === "ready", status.zotero.local.items === 2, status.zotero.local.bbt === "7.0.5"), status.zotero)
  const z = await op("references.search", { query: "1998" }, Results)
  check("references: a Zotero item is cited by its Better BibTeX key", z.results.some((r) => r.key === "clark1998" && r.from === "Zotero"), z)
  const hits = zlocal.hits.length
  await op("references.status", { sync: true }, Status)
  check("references: synced again with nothing changed, only Zotero's versions are asked", zlocal.hits.slice(hits).every((h) => !h.includes("itemKey=")), zlocal.hits.slice(hits))
  const note = await op("references.note", { key: "ahrens2017" }, Made)
  const text = exists(note.path) ? read(note.path) : ""
  check("references: a literature note is made with its citekey, its reference, Zotero's annotations (linked to their page) and notes",
    all(note.created, note.path === "Literature/ahrens2017.md", text.includes("type: reference"), text.includes("citekey: ahrens2017"),
      text.includes("> Writing is thinking ([p. 12](zotero://open-pdf/library/items/PDF00001?page=12))"), text.includes("Key claim"), text.includes("Read in **2024**.")), text)
  const again = await op("references.note", { key: "ahrens2017" }, Made)
  check("references: asked again, it's the note there is", all(!again.created, again.path === note.path), again)
  zlocal.server.close()
  await op("references.status", { sync: true }, Status)
  const closed = await op("references.status", {}, Status)
  const still = await op("references.search", { query: "ahrens" }, Results)
  check("references: Zotero closed is a state, not an error, and what it had is still cited",
    all(closed.zotero.local.state === "unreachable", closed.zotero.local.items === 2, still.results[0]?.key === "ahrens2017"), [closed.zotero, still])
  process.env.VAULTITE_ZOTERO_URL = "http://127.0.0.1:9"
  return note.path
}

async function byIdentifier({ check, op, read, exists, vault }: Ctx): Promise<string> {
  const paper = { type: "journal-article", title: "A stand-in paper", author: [{ family: "Park", given: "Alice" }], issued: { "date-parts": [[2025, 3]] }, DOI: "10.5555/stand.in", "container-title": "Journal of Tests" }
  const doi = await stub((url) => (url.startsWith("/10.5555/") ? [200, JSON.stringify(paper)] : [404, "{}"]))
  process.env.VAULTITE_DOI_URL = doi.url
  const added = await op("references.add", { identifier: "https://doi.org/10.5555/stand.in" }, Added)
  const text = added.path && exists(added.path) ? read(added.path) : ""
  check("references: a DOI is looked up and kept as a reference note holding its details",
    all(!added.already, added.key === "park2025", /item-type: article-journal/.test(text), text.includes("DOI: 10.5555/stand.in")), [added, text])
  await vault.sync()
  const twice = await op("references.add", { identifier: "doi:10.5555/STAND.IN" }, Added)
  check("references: the same DOI again adds nothing", all(twice.already, twice.key === "park2025"), twice)
  doi.server.close()
  process.env.VAULTITE_DOI_URL = "http://127.0.0.1:9"
  return added.path ?? ""
}

async function zoteroWeb({ check, op }: Ctx) {
  let version = 10
  const titles = new Map([["WEB00001", "First"], ["WEB00002", "Second"]])
  const web = await stub((url) => {
    if (url === "/keys/current") return [200, JSON.stringify({ userID: 42, username: "alice" })]
    if (url.startsWith("/users/42/groups")) return [200, JSON.stringify([{ id: 7, data: { name: "Lab" } }])]
    if (url.startsWith("/users/42/items/top?format=versions")) return [200, JSON.stringify(Object.fromEntries([...titles.keys()].map((k) => [k, k === "WEB00002" ? version : 10]))), { "Last-Modified-Version": String(version) }]
    if (url.startsWith("/groups/7/items/top?format=versions")) return [200, "{}", { "Last-Modified-Version": "1" }]
    const keys = /itemKey=([\w,]+)/.exec(url)?.[1]?.split(",") ?? []
    if (url.startsWith("/users/42/items?")) return [200, JSON.stringify(keys.map((k) => zItem(k, k === "WEB00002" ? version : 10, { type: "book", title: titles.get(k) ?? "", author: [{ family: "Kim", given: "Dave" }], issued: { "date-parts": [[2020]] } })))]
    return [404, "{}"]
  })
  process.env.VAULTITE_ZOTERO_API = web.url
  await op("references.zotero-key", { key: "abcdefghijklmnop1234" }, z.looseObject({}))
  const first = await op("references.search", { query: "kim" }, Results)
  check("references: the zotero.org library is read with the key, groups too", all(first.results.length === 2, first.results.every((r) => r.from === "Zotero (web)")), first)
  version = 11
  titles.set("WEB00002", "Second, revised")
  const hits = web.hits.length
  await op("references.status", { sync: true }, Status)
  const asked = web.hits.slice(hits).filter((h) => h.includes("itemKey="))
  const after = await op("references.search", { query: "revised" }, Results)
  check("references: synced again, only what changed on zotero.org is fetched", all(asked.length === 1, asked[0]?.includes("itemKey=WEB00002") ?? false, after.results.length === 1), [asked, after])
  await op("references.zotero-key", { remove: true }, z.looseObject({}))
  web.server.close()
  process.env.VAULTITE_ZOTERO_API = "http://127.0.0.1:9"
}

function citeprocAsTaken({ check }: Ctx) {
  const D = path.join(import.meta.dirname, "../../../plugins/core/references/citeproc")
  const lib = fs.readFileSync(path.join(D, "citeproc.mjs"), "utf8")
  const taken = crypto.createHash("sha256").update(lib.split("\n").filter((l) => !l.includes("// vaultite: ")).join("\n")).digest("hex")
  check("references: citeproc is the upstream build PROVENANCE.md names, but for the line marked as ours",
    all(fs.readFileSync(path.join(D, "PROVENANCE.md"), "utf8").includes(taken), lib.split("// vaultite: ").length - 1 === 1), taken)
}

export default async ($: VaultTest) => {
  const ctx: Ctx = {
    ...$,
    op: async (id, p, schema) => schema.parse((await $.app.callOp(id, p)).result),
    render: async (rel) => String((await $.api("GET", `render?path=${rel}`))[1]),
  }
  citations(ctx)
  citeprocAsTaken(ctx)
  await agentsRead(ctx)
  await placedReferences(ctx)
  await agentOps(ctx)
  await ownBibliography(ctx)
  const note = await zoteroLocal(ctx)
  const added = await byIdentifier(ctx)
  await zoteroWeb(ctx)
  for (const f of ["Library.bib", "Papers/Draft.md", "Papers/Ends.md", "Papers/Div.md", "Papers/Thesis/refs.json", "Papers/Thesis/Chapter.md", note, added]) await $.api("DELETE", "file", { path: f })
}
