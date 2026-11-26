// The web build's assets: kept past an update, sent compressed from the build's copies. `node tools/test_assets.ts` (npm test)
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import zlib from "node:zlib"
import { check, exit, freePort, summary, tempDir, testServer, waitFor } from "./test/lib.ts"
import { KEEP_DAYS, keepAssets, keptAsset } from "../core/keptassets.ts"
import { copyOf, ENCODINGS, precompress, pruneCache } from "../core/precompressed.ts"
import { dropPrecompressed } from "./phone_copy.ts"
const began = Date.now()
const tmp = tempDir("vaultite-assets-test-")

function build(dist: string, n: number, files: Record<string, string>) {
  fs.rmSync(dist, { recursive: true, force: true })
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dist, "assets", name), text)
  fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html><html><head><script type="module" src="./assets/main-Build00${n}.js"></script></head><body></body></html>\n`)
}
const code = (word: string) => `export const view = '${word}'\n` + `// ${word} `.repeat(400) + "\n"
const DAY = 86_400_000, t = Date.UTC(2026, 10, 18)

const phone = path.join(tmp, "phone")
fs.mkdirSync(path.join(phone, "assets"), { recursive: true })
for (const f of ["index.html", "assets/main-X.js", "assets/main-X.js.gz", "assets/main-X.js.br", "assets/a.css.gz"]) fs.writeFileSync(path.join(phone, f), f)
check("the phone apps' copy drops the precompressed copies", dropPrecompressed(phone) === 3 &&
  fs.readdirSync(phone, { recursive: true, encoding: "utf8" }).sort().join(",") === ["assets", path.join("assets", "main-X.js"), "index.html"].sort().join(","))

const dist = path.join(tmp, "dist"), kept = path.join(tmp, "kept")
build(dist, 1, { "main-Build001.js": "one", "View-AAAAAAAA.js": "old view", "shared-CCCCCCCC.js": "shared" })
fs.writeFileSync(path.join(dist, "assets", "View-AAAAAAAA.js.br"), "old view's copy")
await keepAssets(dist, kept, t)
build(dist, 2, { "main-Build002.js": "two", "View-BBBBBBBB.js": "new view", "shared-CCCCCCCC.js": "shared" })
await keepAssets(dist, kept, t + DAY)
check("a replaced build's asset is kept", fs.readFileSync(keptAsset(kept, "View-AAAAAAAA.js")?.file ?? path.join(kept, "-"), "utf8") === "old view")
check("with its compressed copy", fs.readFileSync(path.join(kept, "View-AAAAAAAA.js.br"), "utf8") === "old view's copy")
check("the new build's assets are kept too", keptAsset(kept, "View-BBBBBBBB.js") !== null && keptAsset(kept, "shared-CCCCCCCC.js") !== null)
check("a name that isn't a hashed asset's is refused", keptAsset(kept, "seen.json") === null && keptAsset(kept, "../dist/index.html") === null)
await keepAssets(dist, kept, t + (KEEP_DAYS + 2) * DAY)
check(`gone ${KEEP_DAYS} days after its last build, copies too`, keptAsset(kept, "View-AAAAAAAA.js") === null &&
  !fs.existsSync(path.join(kept, "main-Build001.js")) && !fs.existsSync(path.join(kept, "View-AAAAAAAA.js.br")))
check("the served build's stay", keptAsset(kept, "View-BBBBBBBB.js") !== null && keptAsset(kept, "shared-CCCCCCCC.js") !== null)

const made = path.join(tmp, "made"), cache = path.join(tmp, "cache")
fs.mkdirSync(made)
const files = { "big-DDDDDDDD.js": code("big"), "tiny-EEEEEEEE.js": "small", "icon-FFFFFFFF.png": "x".repeat(4096) }
for (const [n, text] of Object.entries(files)) fs.writeFileSync(path.join(made, n), text)
const all = Object.keys(files).map((n) => path.join(made, n)), big = all[0]
check("the build's copies: brotli and gzip", await precompress(all, cache) === 2 &&
  zlib.brotliDecompressSync(fs.readFileSync(copyOf(big, "br"))).toString() === files["big-DDDDDDDD.js"] &&
  zlib.gunzipSync(fs.readFileSync(copyOf(big, "gzip"))).toString() === files["big-DDDDDDDD.js"])
check("none for a small file or one that doesn't compress", !fs.existsSync(copyOf(all[1], "br")) && !fs.existsSync(copyOf(all[2], "gzip")))
for (const enc of ENCODINGS) fs.rmSync(copyOf(big, enc))
check("a build of the same asset takes the cache's copies", await precompress(all, cache) === 0 && fs.existsSync(copyOf(big, "br")))
fs.utimesSync(path.join(cache, "big-DDDDDDDD.js.gz"), new Date(Date.now() - 30 * DAY), new Date(Date.now() - 30 * DAY))
await pruneCache(cache)
check("the cache drops what no build used lately", !fs.existsSync(path.join(cache, "big-DDDDDDDD.js.gz")) && fs.existsSync(path.join(cache, "big-DDDDDDDD.js.br")))

type Got = { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
const get = (url: string, headers: Record<string, string> = {}) => new Promise<Got>((resolve, reject) => {
  http.get(url, { headers }, (r) => {
    const parts: Buffer[] = []
    r.on("data", (c: Buffer) => parts.push(c))
    r.on("end", () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(parts) }))
  }).on("error", reject)
})
const REMOTE = { "x-forwarded-host": "vault.example" }

const VAULT = path.join(tmp, "vault"), WEB = path.join(tmp, "web")
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), "{}\n")
build(WEB, 1, { "main-Build001.js": "one", "View-AAAAAAAA.js": code("old"), "Bare-GGGGGGGG.js": code("bare") })
await precompress([path.join(WEB, "assets", "View-AAAAAAAA.js")])
const port = await freePort(), local = path.join(tmp, "local")
const server = testServer({
  env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: local, VAULTITE_WEB_DIST: WEB, PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "" },
  stdio: "ignore",
})
const base = `http://127.0.0.1:${port}/`
try {
  const up = await waitFor(async () => (await fetch(`${base}api/loading`).then((r) => r.json(), () => null))?.ready === true, 120_000, 200)
  check("the server starts", up)
  const view = path.join(WEB, "assets", "View-AAAAAAAA.js")
  const br = await get(`${base}assets/View-AAAAAAAA.js`, { ...REMOTE, "accept-encoding": "gzip, deflate, br" })
  check("over the network, the build's brotli copy as it is", br.status === 200 && br.headers["content-encoding"] === "br" &&
    br.body.equals(fs.readFileSync(copyOf(view, "br"))) && br.headers["content-length"] === String(br.body.length) &&
    br.headers.vary === "Accept-Encoding" && /immutable/.test(br.headers["cache-control"] ?? ""), br.headers)
  const gz = await get(`${base}assets/View-AAAAAAAA.js`, { ...REMOTE, "accept-encoding": "gzip" })
  check("its gzip copy to a client without brotli", gz.headers["content-encoding"] === "gzip" && gz.body.equals(fs.readFileSync(copyOf(view, "gzip"))), gz.headers)
  const plain = await get(`${base}assets/View-AAAAAAAA.js`, REMOTE)
  check("the file itself to one that asks for neither", plain.headers["content-encoding"] === undefined && plain.body.equals(fs.readFileSync(view)) &&
    plain.headers["content-length"] === String(plain.body.length))
  const near = await get(`${base}assets/View-AAAAAAAA.js`, { "accept-encoding": "br" })
  check("on this machine, never compressed", near.headers["content-encoding"] === undefined && near.body.equals(fs.readFileSync(view)))

  const bare = await get(`${base}assets/Bare-GGGGGGGG.js`, { ...REMOTE, "accept-encoding": "br" })
  check("an asset the build made no copy of is compressed", bare.headers["content-encoding"] === "br" &&
    zlib.brotliDecompressSync(bare.body).toString() === code("bare") && bare.headers["content-length"] === String(bare.body.length))
  const keptCopy = path.join(local, "web-assets", "Bare-GGGGGGGG.js.br")
  check("once: its copy is kept", await waitFor(() => fs.existsSync(keptCopy), 5000, 50) && fs.readFileSync(keptCopy).equals(bare.body))

  const index = await get(base, REMOTE)
  const again = await get(base, { ...REMOTE, "if-modified-since": String(index.headers["last-modified"]) })
  check("a page not changed since is a 304", again.status === 304 && again.body.length === 0 && index.headers["cache-control"] === "no-cache", again.status)

  check("keeps the build it serves, with its copies", await waitFor(() => fs.existsSync(path.join(local, "web-assets", "View-AAAAAAAA.js.br")), 30_000, 200))
  build(WEB, 2, { "main-Build002.js": "two", "View-BBBBBBBB.js": code("new") })
  const old = await get(`${base}assets/View-AAAAAAAA.js`)
  check("a replaced build's chunk still loads, cached for good", old.status === 200 && old.body.toString().includes("'old'") &&
    /immutable/.test(old.headers["cache-control"] ?? "") && /javascript/.test(old.headers["content-type"] ?? ""), old.status)
  const oldBr = await get(`${base}assets/View-AAAAAAAA.js`, { ...REMOTE, "accept-encoding": "br" })
  check("compressed from its kept copy", oldBr.headers["content-encoding"] === "br" && zlib.brotliDecompressSync(oldBr.body).toString() === code("old"))
  check("the new build's are served", (await get(`${base}assets/View-BBBBBBBB.js`)).status === 200)
  const none = await get(`${base}assets/Never-ZZZZZZZZ.js`)
  check("an asset no build had is still a 404", none.status === 404, none.status)
} finally {
  server.kill()
}
await exit(summary("assets", began))
