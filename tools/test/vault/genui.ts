import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, write } = $
  // Live answers (plugins/core/genui): DIL read into a tree, run as the sandbox runs it, its values kept in the fence,
  // a ChatGPT answer fenced, and both fences as text for agents.
  const dil = await import("../../../plugins/core/genui/dil.ts")
  const { workerMain } = await import("../../../plugins/core/genui/sandbox.ts")
  const { chartData, chartText } = await import("../../../plugins/core/genui/chartdata.ts")
  const SRC = [
    "Pick a size.",
    "",
    "{@body const sizes = [{id: \"s\", label: \"Small\", ml: 250}, {id: \"l\", label: \"Large\", ml: 500}]}",
    "{@body const [size, setSize] = DIL.useState(\"s\")}",
    "{@body const [n, setN] = DIL.useState(1)}",
    "<box gap={2}>",
    "  <select value={size} onChange={setSize} options={sizes.map(s => ({value: s.id, label: s.label}))}/>",
    "  {#each sizes as s, i}",
    "    <text>{i + 1}. {s.label}</text>",
    "  {/each}",
    "  {#if n > 2}<caption>Lots</caption>{:else}<caption>Some</caption>{/if}",
    "  <title>{n * (sizes.find(s => s.id === size).ml)} ml in total</title>",
    "  <button onClick={() => setN(n + 1)}>Add one</button>",
    "  <code>`{not an expression}`</code>",
    "</box>",
  ].join("\n")
  const nodes = dil.parse(SRC)
  const kinds = (ns: Any[]): string[] => ns.flatMap((n) => [n.t === "el" ? n.name : n.t, ...kinds(n.kids ?? n.branches?.flatMap((b: Any) => b.kids) ?? [])])
  check("genui: DIL reads into prose, statements, tags, loops and branches", kinds(nodes).join() === "md,body,body,body,box,select,each,text,md,if,caption,md,caption,md,title,md,button,md,code,md", kinds(nodes))
  check("genui: useState values are named for saving", dil.stateNames(nodes).join() === "size,n", dil.stateNames(nodes))
  check("genui: a { inside inline code stays text", JSON.stringify(nodes).includes("`{not an expression}`"))

  // Run it the way the sandbox does (its source, nothing else in scope), seeded from saved values.
  const got: Any[] = []
  let send: Any = null
  // (in a context of its own: it takes fetch and the rest off its globals)
  const vm = await import("node:vm")
  const io = { post: (m: Any) => got.push(JSON.parse(JSON.stringify(m))), listen: (f: Any) => { send = (m: Any) => f(JSON.parse(JSON.stringify(m))) } }
  vm.runInNewContext(`(${workerMain.toString()})(io)`, vm.createContext({ io, fetch: () => {} }))
  send({ type: "run", nodes, names: dil.stateNames(nodes), state: { size: "l" } })
  await new Promise((r) => setTimeout(r, 5))
  const said = (t: Any) => JSON.stringify(t)
  const first = got.find((m) => m.type === "tree")
  check("genui: runs with its saved values (500 ml, two items, the else branch)", first && said(first.tree).includes("500 ml in total") && said(first.tree).includes("2. Large") && said(first.tree).includes("Some"), first)
  const button = (ts: Any[]): Any => ts.map((t) => (t.n === "button" ? t : t.k && button(t.k))).find(Boolean)
  got.length = 0
  send({ type: "call", fn: button(first.tree).p.onClick.$fn, args: [] })
  await new Promise((r) => setTimeout(r, 5))
  send({ type: "call", fn: button(got.filter((m) => m.type === "tree").pop().tree).p.onClick.$fn, args: [] })
  await new Promise((r) => setTimeout(r, 5))
  const last = got.filter((m) => m.type === "tree").pop()
  check("genui: a handler changes state and it draws again", last && said(last.tree).includes("1500 ml") && said(last.tree).includes("Lots"), got)
  check("genui: changed values are sent to keep", got.some((m) => m.type === "state" && m.state.n === 3 && m.state.size === "l"), got)
  got.length = 0
  send({ type: "run", nodes: dil.parse("{@body while (fetch) {}}<text>{typeof fetch}</text>"), names: [], state: {} })
  await new Promise((r) => setTimeout(r, 5))
  check("genui: the program can't reach the network", said(got).includes("undefined"), got)
  check("genui: and the tests' own process keeps it", typeof fetch === "function")

  // Its values, kept in the fence's {@state} line.
  const kept = dil.withState(SRC, { size: "l", n: 3 })
  check("genui: values kept on a {@state} line, read back, replaced, removed", dil.savedState(kept).n === 3 &&
    dil.savedState(dil.withState(kept, { n: 4 })).n === 4 && dil.withState(kept, {}) === SRC && !dil.parse(kept).some((n: Any) => n.t === "body" && n.js.includes("state")), kept)

  // A ChatGPT answer: the markup fenced, the prose around it Markdown.
  const answer = `Here's a calculator.\n\n${SRC.split("\n").slice(2).join("\n")}\n\n## Why\n\nBecause.`
  const fenced = dil.fenceDil(answer)
  check("genui: a ChatGPT answer's markup goes in a genui fence, its prose stays out", fenced.startsWith("Here's a calculator.\n\n```genui\n{@body") && fenced.endsWith("```\n\n## Why\n\nBecause."), fenced)
  check("genui: plain Markdown isn't fenced", dil.fenceDil("A <b>bold</b> answer.\n\n- one") === "A <b>bold</b> answer.\n\n- one")
  const quiz = dil.fenceDil('Try it.\n\n<LearningQuiz\n  title="Q"\n  questions={[\n    {"question": "a?"}\n  ]}\n/>\n\nDone.')
  check("genui: a component written over many lines is fenced whole", quiz === 'Try it.\n\n```genui\n<LearningQuiz\n  title="Q"\n  questions={[\n    {"question": "a?"}\n  ]}\n/>\n```\n\nDone.', quiz)
  const inline = dil.fenceDil('The <Entity value="X"/> is good.\n\nMore.')
  check("genui: a sentence with a component in it is fenced, and draws it in its line", inline.startsWith("```genui\nThe <Entity") &&
    (dil.parse('The <Entity value="X"/> is good.')[0] as Any).parts[1].el.name === "Entity", inline)
  check("genui: a fence inside it gets a longer fence", dil.fenceDil("<box>\n```js\nx\n```\n</box>").startsWith("````genui"))

  // Charts: rows or Chart.js' datasets; both fences read as text.
  const c = chartData({ data: [{ m: "Jan", a: 1, b: "2" }, { m: "Feb", a: 3, b: 4 }] })
  check("genui: chart rows into categories and number series", c.cats.join() === "Jan,Feb" && c.series.map((s: Any) => s.key).join() === "a,b" && c.series[1].values[0] === 2, c)
  check("genui: Chart.js data works too", chartData({ labels: ["x", "y"], datasets: [{ label: "S", data: [1, 2] }] }).series[0].values.join() === "1,2")
  write("Notes/Live answer.md", `# Live answer\n\n\`\`\`genui\n${kept}\n\`\`\`\n\n\`\`\`chart\ntype: bar\ndata:\n  - {m: Jan, a: 1}\n\`\`\`\n`)
  const [code, out] = await api("GET", "render?path=Notes/Live answer.md")
  check("genui: render shows a genui's prose and labels and a chart's table, not their source", code === 200 && out.includes("Pick a size.") && out.includes("[Add one]") &&
    out.includes("| Jan | 1 |") && !out.includes("useState") && !out.includes("@state"), out)
  check("genui: chart text names an unreadable spec", chartText("type: [").includes("couldn't be read"))
}
