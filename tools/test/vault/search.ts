import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  let res: Any
  // Search syntax (core/searchquery.ts): operators, properties, tags, scopes, sorting, errors.
  let [code] = await api("POST", "file", { path: "Searchy/Budget plan.md", text: "---\nstatus: seed\ntags: [finance]\n---\n# Rent\nPay the rent and buy food\n- [ ] call the landlord about rent\n- [x] buy food for the week\n\n## Trips\nA trip to Lisbon #travel/europe\n" })
  ;[code] = await api("POST", "file", { path: "Searchy/Other.md", text: "---\nstatus: exploring\n---\nRent elsewhere, food later.\nRENT in capitals\n" })
  // (this helper passes the query string as it is: no encoding)
  const paths = async (q: string, more = "") => { const [c, r] = await api("GET", `search?q=${q}&folder=Searchy${more}`); return c === 200 ? (r as Any[]).map((x) => x.path.slice(8)).sort().join(",") : `${c} ${r.error}` }
  for (const [q, want] of [
    ["rent food", "Budget plan.md,Other.md"], ['"rent and buy"', "Budget plan.md"], ["rent -lisbon", "Other.md"], ["lisbon OR elsewhere", "Budget plan.md,Other.md"],
    ["file:budget", "Budget plan.md"], ["path:searchy rent", "Budget plan.md,Other.md"], ["searchy", ""], ["content:budget", ""],
    ["tag:#travel", "Budget plan.md"], ["tag:travel/europe", "Budget plan.md"], ["tag:trav", ""], ["tag:finance", "Budget plan.md"],
    ["line:(rent food)", "Budget plan.md,Other.md"], ["line:(landlord food)", ""], ["block:(landlord food)", "Budget plan.md"], ["section:(rent lisbon)", ""],
    ["section:(trip lisbon)", "Budget plan.md"], ["task-todo:landlord", "Budget plan.md"], ["task-done:landlord", ""], ["task-done:", "Budget plan.md"],
    ["match-case:RENT", "Other.md"], ["[status]", "Budget plan.md,Other.md"], ["[status:seed]", "Budget plan.md"], ["[status:seed OR exploring]", "Budget plan.md,Other.md"],
    ["[nope]", ""], ["/l[a-z]+d/", "Budget plan.md"], ["(lisbon OR elsewhere) -[status:seed]", "Other.md"],
  ]) check(`search: ${q}`, (await paths(q)) === want, await paths(q))
  check("search: case=1 matches in case", (await paths("RENT", "&case=1")) === "Other.md", await paths("RENT", "&case=1"))
  check("search: a query it can't read is a 400 saying why", (await paths('"open')).startsWith("400 A quote isn't closed"), await paths('"open'))
  check("search: a bad regex too", (await paths("/(/")).startsWith("400 /(/ isn't a regular expression"), await paths("/(/"))
  ;[code, res] = await api("GET", "search?q=rent&folder=Searchy&sort=name-desc")
  check("search: sorted by name, Z to A", code === 200 && res.map((r: Any) => r.title).join() === "Other,Budget plan", res)
  ;[code] = await api("GET", "search?q=rent&sort=nope")
  check("search: an unknown sort is a 400", code === 400, code)
  ;[, res] = await api("GET", "search?q=landlord&folder=Searchy&lines=5&context=1")
  check("search: lines with context around them, numbered as the file's (frontmatter counted)", res[0]?.matches?.map((m: Any) => `${m.line}${m.ctx ? "c" : ""}`).join() === "6c,7,8c" && res[0].count === 1, res[0]?.matches)
  ;[, res] = await api("GET", "search?q=rent&folder=Searchy&sort=name&lines=1&total=1&limit=1")
  check("search: total=1 says how many files and lines matched in all, past the page", res.files === 2 && res.results.length === 1 && res.results[0].title === "Budget plan" && res.lines >= 3, res)
  ;[, res] = await api("GET", "search?q=rent&folder=Searchy&sort=name&limit=1&offset=1")
  check("search: offset gives the next page", res.length === 1 && res[0].title === "Other", res)
  ;[, res] = await api("GET", "search?q=rent&path=Searchy/Budget plan.md&lines=100")
  check("search: path= only that file, every line", res.length === 1 && res[0].matches.length === res[0].count, res)
  ;[, res] = await api("GET", "search?q=tag:travel&folder=Searchy&lines=5")
  check("search: a tag marks its line", res[0]?.matches?.length === 1 && res[0].matches[0].text.includes("#travel/europe"), res[0])
  ;[, res] = await api("GET", "search?q=[status:seed]&folder=Searchy&lines=5")
  check("search: a property alone lists no lines", res[0]?.count === 0, res[0])
  {
    const sq = await import("../../../core/searchquery.ts")
    const n = sq.parse('budget (rent OR "buy food") -tag:done')
    check("searchquery: explain", sq.explain(n) === 'Files where the name or text has "budget", and (either the name or text has "rent", or the name or text has "buy food"), and not (it\'s tagged #done)', sq.explain(n))
    check("searchquery: plain words", sq.isPlain(sq.parse("budget rent")) && !sq.isPlain(n) && !sq.isPlain(sq.parse("a OR b")), null)
    check("searchquery: marks what matched, not what's excluded", JSON.stringify(sq.highlighter(n)("buy food, rent, done")) === "[[0,8],[10,14]]", sq.highlighter(n)("buy food, rent, done"))
    const ex = sq.excerpt("one two three four five six seven eight nine ten budget eleven", sq.wordRanges("one two three four five six seven eight nine ten budget eleven", ["budget"]), 30, 10)
    check("searchquery: an excerpt around the match", ex.text.startsWith("…") && ex.text.slice(ex.ranges[0][0], ex.ranges[0][1]) === "budget", ex)
  }
  await api("DELETE", "file?path=Searchy")
}
