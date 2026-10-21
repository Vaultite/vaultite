// Shields' lists built into an engine, in a worker so the half second of parsing never stalls the app (adblock.ts).
// The lists are uBlock Origin's defaults, fetched where uBlock fetches them; its scriptlets come as Ghostery builds them.
import { parentPort, workerData } from "node:worker_threads"
import fs from "node:fs"
import path from "node:path"
import { ElectronBlocker } from "@ghostery/adblocker-electron"

const UBO = "https://ublockorigin.github.io/uAssetsCDN"
const UBO_ALT = "https://ublockorigin.pages.dev"
/** Each list's address, then a mirror. */
const LISTS = [
  ["filters/filters.min.txt"], ["filters/badware.min.txt"], ["filters/privacy.min.txt"], ["filters/quick-fixes.min.txt"],
  ["filters/unbreak.min.txt"], ["thirdparties/easylist.txt"], ["thirdparties/easyprivacy.txt"],
].map(([p]) => [`${UBO}/${p}`, `${UBO_ALT}/${p}`])
  .concat([["https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext"]])
const RESOURCES = ["https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json",
  "https://cdn.jsdelivr.net/gh/ghostery/adblocker@master/packages/adblocker/assets/ublock-origin/resources.json"]
/** What uBlock's `!#if` lines ask, as uBlock in Chromium answers. */
const ENV: [string, boolean][] = [["env_chromium", true], ["ext_ublock", true], ["cap_user_stylesheet", true]]

async function get(urls: string[]) {
  let last: unknown
  for (const url of urls) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) })
        if (!r.ok) throw new Error(`${url}: ${r.status}`)
        const text = await r.text()
        if (text.length < 100) throw new Error(`${url}: empty`)
        return text
      } catch (e) { last = e }
    }
  }
  throw last
}

const { local } = workerData as { local: string }
const [lists, resources] = local
  ? [[fs.readFileSync(path.join(local, "filters.txt"), "utf8")], fs.existsSync(path.join(local, "resources.json")) ? fs.readFileSync(path.join(local, "resources.json"), "utf8") : ""]
  : await Promise.all([Promise.all(LISTS.map(get)), get(RESOURCES)])
const engine = ElectronBlocker.parse(lists.join("\n"), { loadPreprocessors: true, loadExtendedSelectors: true, guessRequestTypeFromUrl: true, enableHtmlFiltering: false })
engine.updateEnv(new Map(ENV))
if (resources) engine.updateResources(resources, `${resources.length}`)
const bytes = engine.serialize()
parentPort!.postMessage(bytes, [bytes.buffer as ArrayBuffer])
