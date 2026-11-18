// A page from before an update still loads its lazy chunks (core/keptassets.ts). `node tools/test_keptassets.ts` (npm test)
import fs from "node:fs"
import path from "node:path"
import { check, exit, freePort, summary, tempDir, testServer, waitFor } from "./test/lib.ts"
import { KEEP_DAYS, keepAssets, keptAsset } from "../core/keptassets.ts"
const began = Date.now()
const tmp = tempDir("vaultite-keptassets-test-")

function build(dist: string, n: number, files: Record<string, string>) {
  fs.rmSync(dist, { recursive: true, force: true })
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true })
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dist, "assets", name), text)
  fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html><html><head><script type="module" src="./assets/main-Build00${n}.js"></script></head><body></body></html>\n`)
}

const dist = path.join(tmp, "dist"), kept = path.join(tmp, "kept")
const DAY = 86_400_000, t = Date.UTC(2026, 10, 18)
build(dist, 1, { "main-Build001.js": "one", "View-AAAAAAAA.js": "old view", "shared-CCCCCCCC.js": "shared" })
await keepAssets(dist, kept, t)
build(dist, 2, { "main-Build002.js": "two", "View-BBBBBBBB.js": "new view", "shared-CCCCCCCC.js": "shared" })
await keepAssets(dist, kept, t + DAY)
check("a replaced build's asset is kept", fs.readFileSync(keptAsset(kept, "View-AAAAAAAA.js")?.file ?? path.join(kept, "-"), "utf8") === "old view")
check("the new build's assets are kept too", keptAsset(kept, "View-BBBBBBBB.js") !== null && keptAsset(kept, "shared-CCCCCCCC.js") !== null)
check("a name that isn't a hashed asset's is refused", keptAsset(kept, "seen.json") === null && keptAsset(kept, "../dist/index.html") === null)
await keepAssets(dist, kept, t + (KEEP_DAYS + 2) * DAY)
check(`gone ${KEEP_DAYS} days after its last build`, keptAsset(kept, "View-AAAAAAAA.js") === null && !fs.existsSync(path.join(kept, "main-Build001.js")))
check("the served build's stay", keptAsset(kept, "View-BBBBBBBB.js") !== null && keptAsset(kept, "shared-CCCCCCCC.js") !== null)

const VAULT = path.join(tmp, "vault"), WEB = path.join(tmp, "web")
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), "{}\n")
build(WEB, 1, { "main-Build001.js": "one", "View-AAAAAAAA.js": "export const view = 'old'\n" })
const port = await freePort(), local = path.join(tmp, "local")
const server = testServer({
  env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: local, VAULTITE_WEB_DIST: WEB, PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "" },
  stdio: "ignore",
})
const base = `http://127.0.0.1:${port}/`
try {
  const up = await waitFor(async () => (await fetch(`${base}api/loading`).then((r) => r.json(), () => null))?.ready === true, 120_000, 200)
  check("the server starts", up)
  check("keeps the build it serves", await waitFor(() => fs.existsSync(path.join(local, "web-assets", "View-AAAAAAAA.js")), 30_000, 200))
  build(WEB, 2, { "main-Build002.js": "two", "View-BBBBBBBB.js": "export const view = 'new'\n" })
  const old = await fetch(`${base}assets/View-AAAAAAAA.js`)
  check("a replaced build's chunk still loads, cached for good", old.status === 200 && (await old.text()).includes("'old'") &&
    /immutable/.test(old.headers.get("cache-control") ?? "") && /javascript/.test(old.headers.get("content-type") ?? ""), old.status)
  check("the new build's are served", (await fetch(`${base}assets/View-BBBBBBBB.js`)).status === 200)
  const none = await fetch(`${base}assets/Never-ZZZZZZZZ.js`)
  check("an asset no build had is still a 404", none.status === 404, none.status)
} finally {
  server.kill()
}
await exit(summary("keptassets", began))
