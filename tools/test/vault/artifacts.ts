import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, tmp, vault, write } = $
  // Artifacts (.html) and tables (.csv): in the file list, written like other files, shown as text, their storage.
  write("Money/Spend.html", '<!doctype html><html><head><title>Spend</title><meta name="vaultite:icon" content="wallet"></head>' +
    '<body><h1>Spending</h1><script>vau.csv("Tx.csv")</script></body></html>')
  write("Money/Tx.csv", 'date,amount,note\n2026-01-01,-5.20,"Coffee, large"\n2026-01-02,1200,Pay\n')
  write("Money/Board.md", "# Board\n\n![[Spend.html]]\n\n![[Tx.csv]]\n")
  let [, s] = await api("GET", "files")
  const art = s.files.find((f: Any) => f.path === "Money/Spend.html")
  check("an artifact is a file, with its title and icon", art && art.title === "Spend" && art.icon === "wallet", art)
  check("a table is a file", s.files.some((f: Any) => f.path === "Money/Tx.csv") && !s.others.some((f: Any) => f.path === "Money/Tx.csv"))
  let out: Any
  let [code] = await api("PUT", "file", { path: "Money/Tx.csv", text: read("Money/Tx.csv") + "2026-01-03,-9,Books\n", base: read("Money/Tx.csv") })
  check("a table can be written", code === 200 && read("Money/Tx.csv").endsWith("Books\n"), code)
  ;[, out] = await api("GET", "render?path=Money/Board.md")
  check("embeds render as text", out.includes("Reads: `Money/Tx.csv`") && out.includes("| 2026-01-01 | -5.20 | Coffee, large |") && out.includes("_3 rows._"), out)
  write("Money/Long.csv", "n,sq\n" + Array.from({ length: 120 }, (_, i) => `${i},${i * i}`).join("\n") + "\n")
  ;[, out] = await api("GET", "render?path=Money/Long.csv")
  check("a table's text has every row", out.includes("| 119 | 14161 |") && out.includes("_120 rows._"), out.slice(-200))
  fs.rmSync(path.join(VAULT, "Money/Long.csv"))
  ;[code] = await api("PUT", "artifact/state", { path: "Money/Spend.html", data: { view: "12m" } })
  check("an artifact's storage is kept in .vaultite", code === 200 && JSON.parse(read(".vaultite/artifacts/Money/Spend.html.json")).view === "12m", code)
  ;[code] = await api("PUT", "artifact/state", { path: ".vaultite/x.html", data: {} })
  check("only artifacts in the vault have storage", code === 400, code)
  ;[, out] = await api("POST", "artifact/stat", { paths: ["Money/Tx.csv", "Nope.csv", ".vaultite/plugins.json"] })
  check("stat: mtimes, null when missing or hidden", typeof out["Money/Tx.csv"] === "number" && out["Nope.csv"] === null && out[".vaultite/plugins.json"] === null, out)
  await api("POST", "file/move", { from: "Money", to: "Finance" })
  check("an artifact's storage follows it", exists(".vaultite/artifacts/Finance/Spend.html.json") && !exists(".vaultite/artifacts/Money/Spend.html.json"))
  // The HTML plugin serves them outside /api/ (plugin.serve), sandboxed; with HTML and Tables off they're plain files.
  let page = await app.serve("v", "Finance/Spend.html", "Finance/Spend.html?theme=dark", { theme: "dark" })
  const wrap = String((page?.body as Any)?.text ?? "")
  check("an artifact is framed by a page that keeps its frame on this server", page?.status === 200 && /frame-src 'self'/.test((page?.body as Any)?.headers["Content-Security-Policy"])
    && /^sandbox /.test((page?.body as Any)?.headers["Content-Security-Policy"]) && wrap.includes('src="Spend.html?theme=dark&amp;frame=1"') && !wrap.includes("parseCsv"), [page?.status, wrap.slice(0, 300)])
  page = await app.serve("v", "Finance/Spend.html", "Finance/Spend.html?theme=dark&frame=1", { theme: "dark", frame: "1" })
  const pageText = String((page?.body as Any)?.text ?? "")
  check("an artifact is served sandboxed, with its bridge first", page?.status === 200 && /connect-src 'none'/.test((page?.body as Any)?.headers["Content-Security-Policy"])
    && /^<!doctype html><html><head><script>/.test(pageText) && pageText.includes("parseCsv"), [page?.status, pageText.slice(0, 80)])
  page = await app.serve("v", ".vaultite/plugins.json", ".vaultite/plugins.json", {})
  check("hidden files aren't served to artifacts", page?.status === 400, page?.status)
  page = await app.serve("v", "../outside.html", "../outside.html", {})
  check("nothing outside the vault is", page?.status === 400, page?.status)
  {
    // A page from outside the vault: only once the desktop app allowed it, sandboxed, with no storage of the vault's;
    // nothing next to it.
    const O = await import("../../../core/outside.ts")
    const dir = path.join(tmp, "Downloads")
    fs.mkdirSync(dir, { recursive: true })
    const ext = path.join(dir, "Chart.html")
    fs.writeFileSync(ext, "<!doctype html><html><head><title>Chart</title></head><body>made up</body></html>")
    fs.writeFileSync(path.join(dir, "secret.txt"), "x")
    page = await app.serve("v", ext, ext.slice(1), {})
    check("an outside page nobody allowed isn't served", page?.status === 404, page?.status)
    O.allow([ext])
    page = await app.serve("v", ext, `${ext.slice(1)}?frame=1`, { frame: "1" })
    const text = String((page?.body as Any)?.text ?? "")
    check("an allowed outside page is served sandboxed, its storage empty", page?.status === 200 && /connect-src 'none'/.test((page?.body as Any)?.headers["Content-Security-Policy"]) &&
      /^<!doctype html><html><head><script>/.test(text) && text.includes('"state":{}') && text.includes("made up"), [page?.status, text.slice(0, 80)])
    page = await app.serve("v", path.join(dir, "secret.txt"), "", {})
    check("nothing next to an outside page is served", page?.status === 404, page?.status)
  }

  {
    // claude.ai artifacts: their db and window.storage in a sidecar that follows the file, publish rewriting the page
    // (unless it changed since it loaded), sample allowed per page on this machine, the runtime in the page.
    write("Claude/Drill.html", "<!doctype html><html><head><meta charset=utf8></head><body><title>Drill</title><p>x</p></body></html>")
    ;[code] = await api("POST", "artifact/data", { path: "Claude/Drill.html", db: [{ path: "data/users/u_owner/bests", data: { pairs: { "A-D": 31 } } }, { path: "x/gone", data: { a: 1 } }, { path: "x/gone", data: null }],
      storage: [{ key: "k", value: "v" }, { shared: true, key: "s", value: 2 }] })
    let side = JSON.parse(read(".vaultite/artifacts/Claude/Drill.html.data.json"))
    check("artifact data: documents and storage kept beside it", code === 200 && side.db["data/users/u_owner/bests"].pairs["A-D"] === 31 && !side.db["x/gone"] &&
      side.storage.personal.k === "v" && side.storage.shared.s === "2", side)
    ;[code] = await api("POST", "artifact/data", { path: "Claude/Drill.html", db: [{ path: "odd", data: {} }] })
    check("artifact data: a document path has an even number of segments", code === 400, code)
    page = await app.serve("v", "Claude/Drill.html", "Claude/Drill.html?frame=1", { frame: "1" })
    const served = String((page?.body as Any)?.text ?? "")
    check("the page starts with its data and the runtime", served.includes('"pairs":{"A-D":31}') && served.includes("claudeRuntime") && served.includes("u_owner"), served.slice(0, 200))
    const st = await import("../../../plugins/core/html/claude.ts")
    const version = st.versionOf(vault, "Claude/Drill.html")
    ;[code, out] = await api("POST", "artifact/publish", { path: "Claude/Drill.html", html: "<p>no doctype</p>", version })
    check("publish: only a whole page", code === 400, code)
    ;[code, out] = await api("POST", "artifact/publish", { path: "Claude/Drill.html", html: "<!doctype html><title>Drill</title><p>two</p>", version: version - 5 })
    check("publish: a page that changed since it loaded is a conflict", code === 409 && out.live === String(version) && read("Claude/Drill.html").includes("<p>x</p>"), [code, out])
    ;[code, out] = await api("POST", "artifact/publish", { path: "Claude/Drill.html", html: "<!doctype html><title>Drill</title><p>two</p>", version })
    check("publish rewrites the page", code === 200 && read("Claude/Drill.html").includes("<p>two</p>") && out.version === String(st.versionOf(vault, "Claude/Drill.html")), [code, out])
    const html = (await import("../../../plugins/core/html/plugin.ts")).plugin
    check("sample: not allowed until the owner says so", !html.allows(st.sampleGrant("Claude/Drill.html")))
    ;[code] = await api("POST", "artifact/allow", { path: "Claude/Drill.html" })
    check("sample: allowed for that page", code === 200 && html.allows(st.sampleGrant("Claude/Drill.html")), code)
    await api("POST", "file/move", { from: "Claude/Drill.html", to: "Claude/Chords.html" })
    side = JSON.parse(read(".vaultite/artifacts/Claude/Chords.html.data.json"))
    check("its data and its yes follow a move", side.db["data/users/u_owner/bests"] && !exists(".vaultite/artifacts/Claude/Drill.html.data.json") && html.allows(st.sampleGrant("Claude/Chords.html")))

    // The runtime's pure parts: queries and reading a JSON reply.
    const { queryDocs, parseReply } = await import("../../../plugins/core/html/runtime.ts")
    const docs = new Map<string, Record<string, unknown>>([["t/a", { n: 3, tags: ["x"] }], ["t/b", { n: 1 }], ["t/c", { n: 2, tags: ["x", "y"] }], ["t/d", {}], ["t/a/sub/z", { n: 9 }], ["u/a", { n: 5 }]])
    const q = (o: Partial<Parameters<typeof queryDocs>[1]>) => queryDocs(docs, { coll: "t", where: [], order: null, limit: null, ...o })
    check("query: a collection's own documents, by id", q({}).join() === "t/a,t/b,t/c,t/d", q({}))
    check("query: orderBy, missing fields last; limit", q({ order: ["n", "desc"], limit: 3 }).join() === "t/a,t/c,t/b" && q({ order: ["n", "asc"] }).at(-1) === "t/d", q({ order: ["n", "desc"] }))
    check("query: where", q({ where: [["n", ">=", 2]] }).join() === "t/a,t/c" && q({ where: [["tags", "array-contains", "y"]] }).join() === "t/c" &&
      q({ where: [["n", "in", [1, 3]]] }).join() === "t/a,t/b" && q({ where: [["n", "!=", 1]] }).join() === "t/a,t/c")
    check("json replies: whole, fenced, or one value among words", (parseReply('{"a":1}') as Any).a === 1 && (parseReply("Here:\n```json\n[1,2]\n```") as Any)[1] === 2 &&
      (parseReply('Sure. {"ok": true} Done.') as Any).ok === true && parseReply("no json here") === undefined)

    // The service "sample" runs `claude -p` (here a fake one): text streamed, the tier's model, a named one that fails
    // falls back.
    const bin = path.join(tmp, "fakebin")
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh
cat > /dev/null
case "$*" in *claude-gone-1*) echo '{"type":"result","is_error":true,"result":"no such model","api_error_status":404}'; exit 0;; esac
for w in "Hello" " there"; do echo "{\\"type\\":\\"stream_event\\",\\"event\\":{\\"type\\":\\"content_block_delta\\",\\"delta\\":{\\"type\\":\\"text_delta\\",\\"text\\":\\"$w\\"}}}"; done
echo "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"result\\":\\"Hello there\\",\\"stop_reason\\":\\"end_turn\\",\\"args\\":\\"$*\\"}"
`, { mode: 0o755 })
    const oldPath = process.env.PATH
    process.env.PATH = `${bin}:${oldPath}`
    try {
      const { sample } = await import("../../../plugins/core/claude-code/sample.ts")
      const deltas: string[] = []
      const r = await sample({ prompt: "hi", system: "s", tier: "quick", model: "claude-gone-1", onText: (d) => deltas.push(d) }, path.join(tmp, "claude-home"))
      check("sample: streamed text, a missing model falls back to the tier", r.text === "Hello there" && deltas.join("|") === "Hello| there" && !r.model, [r, deltas])
      const ctl = new AbortController()
      ctl.abort()
      const e = await sample({ prompt: "hi", system: "s", tier: "default", signal: ctl.signal }, tmp).catch((x) => x)
      check("sample: an aborted call is cancelled", e?.code === "cancelled", e)
    } finally {
      process.env.PATH = oldPath
    }
  }

  // Files dropped in from a browser: a free name like Finder's, bytes never over an existing file.
  let up: Any
  await api("POST", "folder", { path: "Inbox" })
  ;[code, up] = await api("POST", "upload/name", { folder: "Inbox", name: "Dropped.md" })
  check("upload: a free name", code === 200 && up.path === "Inbox/Dropped.md", up)
  ;[code] = await api("POST", "upload", { path: up.path, bytes: Buffer.from("# Dropped\n") })
  check("upload: the bytes land", code === 201 && read("Inbox/Dropped.md") === "# Dropped\n", code)
  ;[, up] = await api("POST", "upload/name", { folder: "Inbox", name: "Dropped.md" })
  check("upload: a clash gets \" 1\"", up.path === "Inbox/Dropped 1.md", up)
  ;[code] = await api("POST", "upload", { path: "Inbox/Dropped.md", bytes: Buffer.alloc(0) })
  check("upload: never over a file", code === 409, code)
  ;[code] = await api("POST", "upload", { path: ".vaultite/x.json", bytes: Buffer.alloc(0) })
  check("upload: not into hidden folders", code === 400, code)
  {
    // Streamed, any size: never all in memory, nothing left beside it.
    const { Readable } = await import("node:stream")
    const piece = Buffer.alloc(1 << 20, 7)
    ;[code] = await api("POST", "upload", { path: "Inbox/Big.bin", bytes: Readable.from((function* () { for (let i = 0; i < 40; i++) yield piece })()) })
    check("upload: a stream of 40 MB lands whole", code === 201 && fs.statSync(path.join(VAULT, "Inbox/Big.bin")).size === 40 << 20 &&
      !fs.readdirSync(path.join(VAULT, "Inbox")).some((f) => f.includes(".upload-")), code)
    // An op that takes bytes gets them as the raw body, its parameters in the query (file.upload, any size).
    const raw = Object.assign(Readable.from([piece, piece]), { headers: { "content-type": "application/octet-stream" } }) as unknown as IncomingMessage
    const [c2, r2] = await api("POST", "ops/file.upload?name=Raw.bin&folder=Inbox", {}, raw)
    check("file.upload: the raw body is the file", c2 === 200 && r2.path === "Inbox/Raw.bin" && fs.statSync(path.join(VAULT, "Inbox/Raw.bin")).size === 2 << 20, [c2, r2])
    for (const f of ["Big.bin", "Raw.bin"]) fs.rmSync(path.join(VAULT, "Inbox", f))
  }

  // Files from outside the vault (desktop app): only paths its main process allowed.
  const { allow } = await import("../../../core/outside.ts")
  const outsideFile = path.join(tmp, "Outside.md")
  fs.writeFileSync(outsideFile, "Outside text.\n")
  ;[code] = await api("GET", `file?path=${outsideFile}`)
  check("outside: not allowed, not there", code === 404, code)
  allow([outsideFile])
  let o: Any
  ;[code, o] = await api("GET", `file?path=${outsideFile}`)
  check("outside: an allowed file opens", code === 200 && o.text === "Outside text.\n", o)
  ;[code, o] = await api("PUT", "file", { path: outsideFile, text: "Outside text.\nMore.\n", base: "Outside text.\n" })
  check("outside: saves in place", code === 200 && fs.readFileSync(outsideFile, "utf8") === "Outside text.\nMore.\n", o)
  check("outside: not indexed", ![...vault.entries.keys()].some((k) => k.includes("Outside")))
}
