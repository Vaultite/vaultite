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
    page = await app.serve("v", ext, ext.slice(1), {})
    const text = String((page?.body as Any)?.text ?? "")
    check("an allowed outside page is served sandboxed, its storage empty", page?.status === 200 && /connect-src 'none'/.test((page?.body as Any)?.headers["Content-Security-Policy"]) &&
      /^<!doctype html><html><head><script>/.test(text) && text.includes('"state":{}') && text.includes("made up"), [page?.status, text.slice(0, 80)])
    page = await app.serve("v", path.join(dir, "secret.txt"), "", {})
    check("nothing next to an outside page is served", page?.status === 404, page?.status)
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
