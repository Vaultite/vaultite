import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, tmp, write, TOOLS } = $
  const { vplugin, vau, conf } = $.vars
  // Plugins from elsewhere (core/installs.ts) from made-up git repos, and tools/plugin-index.ts on made-up GitHub.
  // Signing off: a global commit.gpgSign or tag.gpgSign would ask for a key, or a message, in these repos.
  {
    const { execFileSync } = await import("node:child_process")
    const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "init.defaultBranch=main",
      "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd, stdio: "pipe" }).toString()
    const repo = (name: string, files: Record<string, string>, tag: string | null, message = "x") => {
      const d = path.join(tmp, "repos", name)
      for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t) }
      if (!fs.existsSync(path.join(d, ".git"))) g(d, "init", "-q")
      g(d, "add", "-A"); g(d, "commit", "-q", "-m", message)
      if (tag) g(d, "tag", tag)
      return d
    }
    const manifest = (o: Any = {}) => JSON.stringify({ id: "harbor", name: "Harbor", description: "A made-up plugin: the harbour's tides.", version: "1.0.0", author: "Alice Park",
      repo: "alicepark/harbor", apiVersion: 1, disclosures: { network: ["tides.example.com"] }, ...o }, null, 2)
    const PLUGIN_TS = 'import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\nplugin.route("GET", "harbor", () => ({ tide: "high" }))\n'
    const HARBOR = repo("harbor", { "manifest.json": manifest(), "plugin.ts": PLUGIN_TS, "AGENTS.md": "## Harbor\n", ".github/workflows/ci.yml": "on: push\n" }, "v1.0.0")
    const harbor = async () => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "harbor")
    let [ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR })
    const lock = () => conf("plugins-lock")
    check("install: from a git repository at its newest version tag, off", ic === 200 && io.id === "harbor" && io.tag === "v1.0.0" && !io.untagged && exists(".vaultite/plugins/harbor/plugin.ts")
      && !(conf("plugins").enabled ?? []).includes("harbor") && !(await harbor()).loaded, [ic, io])
    check("install: only what the app reads is copied (no .git, no hidden files)", !exists(".vaultite/plugins/harbor/.git") && !exists(".vaultite/plugins/harbor/.github"))
    check("install: the lock file says where it came from", lock().harbor?.tag === "v1.0.0" && lock().harbor.version === "1.0.0" && /^[0-9a-f]{40}$/.test(lock().harbor.commit) &&
      lock().harbor.source === HARBOR && lock().harbor.hash === (await harbor()).hash && /^\d{4}-\d\d-\d\d$/.test(lock().harbor.installed), lock())
    const listed = await harbor()
    check("install: its manifest's version, author, repo and disclosures are listed, with its source", listed.version === "1.0.0" && listed.author === "Alice Park" && listed.repo === "alicepark/harbor" &&
      JSON.stringify(listed.disclosures) === '{"network":["tides.example.com"]}' && listed.source?.tag === "v1.0.0", listed)
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR })
    check("install: again is refused (update it instead)", ic === 409 && io.error.includes("plugin update"), [ic, io])
    const BADTAG = repo("badtag", { "manifest.json": manifest({ id: "badtag", version: "1.0.0" }) }, "v1.0.1")
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: BADTAG })
    check("install: a version that isn't its tag's is refused, with the problem", ic === 422 && io.problems?.some((p: string) => p.includes("version is 1.0.0, but its tag is v1.0.1")) && !exists(".vaultite/plugins/badtag"), [ic, io])
    const CLASH = repo("clash", { "manifest.json": manifest({ id: "people" }) }, "v1.0.0")
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: CLASH })
    check("install: an app plugin's id is refused", ic === 409 && io.error.includes("one of the app's own plugins"), [ic, io])
    const BADCODE = repo("badcode", { "manifest.json": manifest({ id: "badcode" }), "plugin.ts": 'import "../../../core/app.ts"\n' }, "v1.0.0")
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: BADCODE })
    check("install: a plugin breaking the rules is refused", ic === 422 && io.problems?.some((p: string) => p.includes("its own folder")), [ic, io])
    const NOTAGS = repo("notags", { "manifest.json": manifest({ id: "notags", version: "0.1.0" }) }, null)
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: NOTAGS })
    check("install: no tags at all is the default branch, flagged, followed by commit", ic === 200 && io.untagged && lock().notags?.tag === null && lock().notags.commit, [ic, io, lock().notags])
    // One requiring another that's installed, importing a module it exports (Grok Bot's on Cursor's account).
    const PIER = repo("pier", { "manifest.json": manifest({ id: "pier", exports: ["lamp"] }), "lamp.ts": "export const lit = () => true\n" }, "v1.0.0")
    const DOCK = repo("dock", { "manifest.json": manifest({ id: "dock", requires: ["pier"] }),
      "plugin.ts": 'import { Plugin } from "@vaultite/core/plugins.ts"\nimport { lit } from "@plugins/pier/lamp"\nexport const plugin = new Plugin(import.meta.url)\nplugin.route("GET", "dock", () => ({ lit: lit() }))\n' }, "v1.0.0")
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: DOCK })
    check("install: one requiring a plugin that isn't here says to install that first", ic === 422 && io.problems?.some((p: string) => p.includes("'pier', which isn't a plugin here (install it first)")), [ic, io])
    await api("POST", "ops/plugin.install", { source: PIER })
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: DOCK })
    check("install: one importing what an installed plugin it requires exports", ic === 200 && exists(".vaultite/plugins/dock/plugin.ts"), [ic, io])
    for (const id of ["dock", "pier"]) await vau("plugin", "uninstall", id)
    const cr = await vau("plugin", "install", `${HARBOR}@v9.9.9`)
    check("install: a tag that isn't there fails, saying so", cr.code === 1 && /git clone/.test(cr.err), cr)
    check("install: plugin.install is gated on the public MCP", (await import("../../../plugins/core/mcp/public.ts")).gateOf("plugin.install", "write", { source: "a/b" }).includes("install"))

    // From a zip at an address pinned by its hash: a made-up server on this machine (http is allowed only to loopback).
    {
      const http = await import("node:http"), crypto = await import("node:crypto"), zlib = await import("node:zlib")
      const zipOf = (files: Record<string, string>) => {
        const local: Buffer[] = [], central: Buffer[] = []
        let at = 0
        for (const [name, text] of Object.entries(files)) {
          const n = Buffer.from(name), data = Buffer.from(text), packed = zlib.deflateRawSync(data)
          const crc = zlib.crc32(data)
          const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14)
          h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26)
          const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16)
          c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42)
          local.push(h, n, packed); central.push(c, n); at += 30 + n.length + packed.length
        }
        const cd = Buffer.concat(central), end = Buffer.alloc(22)
        end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16)
        return Buffer.concat([...local, cd, end])
      }
      const MOORING = { "mooring/manifest.json": manifest({ id: "mooring", name: "Mooring", version: "0.3.0", repo: "alicepark/mooring" }),
        "mooring/plugin.ts": PLUGIN_TS.replaceAll("harbor", "mooring"), "mooring/AGENTS.md": "## Mooring\n" }
      const zips: Record<string, Buffer> = { "/mooring.zip": zipOf(MOORING), "/flat.zip": zipOf({ "manifest.json": manifest({ id: "flat", version: "1.0.0" }) }),
        "/escape.zip": zipOf({ "manifest.json": manifest({ id: "escape" }), "../outside.txt": "x" }) }
      const asked: string[] = []
      const server = http.createServer((req, res) => {
        asked.push(req.url!)
        const z = zips[new URL(req.url!, "http://x").pathname]
        if (!z) { res.writeHead(404); return res.end() }
        res.writeHead(200, { "content-type": "application/zip" }); res.end(z)
      })
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
      const base = `http://127.0.0.1:${(server.address() as Any).port}`
      const sha = (p: string) => crypto.createHash("sha256").update(zips[p]).digest("hex")
      let [zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/mooring.zip?t=one-time-secret#sha256=${sha("/mooring.zip")}` })
      check("install from a zip: downloaded, its hash checked, its one folder unpacked, off", zc === 200 && zo.id === "mooring" && zo.version === "0.3.0" &&
        read(".vaultite/plugins/mooring/AGENTS.md") === "## Mooring\n" && exists(".vaultite/plugins/mooring/plugin.ts") && !(conf("plugins").enabled ?? []).includes("mooring") &&
        asked.at(-1) === "/mooring.zip?t=one-time-secret", [zc, zo])
      check("install from a zip: the lock keeps its address without the query, and its hash", lock().mooring?.source === `${base}/mooring.zip#sha256=${sha("/mooring.zip")}` &&
        lock().mooring.tag === null && !JSON.stringify(lock()).includes("one-time-secret"), lock().mooring)
      const [, up] = await api("POST", "ops/plugin.update", { id: "mooring" })
      check("install from a zip: pinned, so it's up to date", up[0]?.current === true, up)
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/flat.zip#sha256=${"0".repeat(64)}` })
      check("install from a zip: a download that isn't its hash is refused", zc === 422 && /isn't the file its #sha256 names/.test(zo.error) && !exists(".vaultite/plugins/flat"), [zc, zo])
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/flat.zip#sha256=${sha("/flat.zip")}` })
      check("install from a zip: the plugin at the zip's top", zc === 200 && zo.id === "flat", [zc, zo])
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/escape.zip#sha256=${sha("/escape.zip")}` })
      check("install from a zip: a file outside its folder is refused", zc === 422 && /outside its folder/.test(zo.error) && !exists(".vaultite/plugins/escape"), [zc, zo])
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/flat.zip` })
      check("install from a zip: without its hash it's refused", zc === 400 && /#sha256=/.test(zo.error), [zc, zo])
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `http://example.com/x.zip#sha256=${"a".repeat(64)}` })
      check("install from a zip: plain http elsewhere is refused", zc === 400 && /https only/.test(zo.error), [zc, zo])
      ;[zc, zo] = await api("POST", "ops/plugin.install", { source: `${base}/gone.zip#sha256=${"a".repeat(64)}` })
      check("install from a zip: a missing file says so", zc === 502 && /answered 404/.test(zo.error), [zc, zo])
      for (const id of ["mooring", "flat"]) await api("POST", "ops/plugin.uninstall", { id })
      server.close()
    }

    await vau("plugin", "on", "harbor")
    check("install: turned on by this machine's owner, it's allowed and runs", (await harbor()).loaded && (await api("GET", "harbor"))[1].tide === "high")
    write(".vaultite/plugins/harbor/data.json", JSON.stringify({ mine: 1 }) + "\n")

    // A newer version: v1.1.0 changes plugin.ts and runs programs now.
    repo("harbor", { "manifest.json": manifest({ version: "1.1.0", disclosures: { network: ["tides.example.com"], shell: true } }), "plugin.ts": PLUGIN_TS.replace('"high"', '"low"') }, "v1.1.0")
    let [uc, uo] = await api("POST", "ops/plugin.update", {})
    const row = (uo as Any[])?.find((r) => r.id === "harbor")
    check("update: a newer tag, what it changes (files, disclosures), nothing applied", uc === 200 && row?.to === "1.1.0" && row.tag === "v1.1.0" && !row.applied &&
      row.files.includes("changed plugin.ts") && row.files.includes("changed manifest.json") && row.disclosures.includes("now runs programs on this machine") &&
      lock().harbor.version === "1.0.0" && (await api("GET", "harbor"))[1].tide === "high", uo)
    check("update: one installed without tags and unchanged is up to date", (uo as Any[]).find((r) => r.id === "notags")?.current === true, uo)
    ;[uc, uo] = await api("POST", "ops/plugin.update", { id: "harbor", apply: true })
    let h = await harbor()
    check("update: applied, its files are the new version's, its settings kept, the lock follows", uc === 200 && uo[0].applied && lock().harbor.version === "1.1.0" && lock().harbor.tag === "v1.1.0" &&
      read(".vaultite/plugins/harbor/plugin.ts").includes('"low"') && JSON.parse(read(".vaultite/plugins/harbor/data.json")).mine === 1, [uo, lock().harbor])
    check("update: its code changed, so it waits to be allowed on this machine again", h.on && !h.loaded && h.approval?.state === "changed" && h.approval.changed.includes("plugin.ts") &&
      (await api("GET", "harbor"))[0] === 404, h)
    await api("POST", "ops/plugin.allow", { id: "harbor" })
    check("update: allowed, the new version runs", (await api("GET", "harbor"))[1].tide === "low")
    ;[uc, uo] = await api("POST", "ops/plugin.update", { id: "harbor" })
    check("update: then it's up to date", uo[0].current === true, uo)

    // The directory's index: a local file (VAULTITE_PLUGIN_INDEX), searched, and its blocklist.
    const INDEX = path.join(tmp, "index.json")
    const entry = (o: Any) => ({ name: o.id, description: "Made up.", author: "Bob Lee", repo: `boblee/${o.id}`, version: "1.0.0", tag: "v1.0.0", stars: 1, released: "2026-01-01T00:00:00Z",
      created: "2025-01-01T00:00:00Z", pushed: "2026-01-01T00:00:00Z", issues: { open: 1, closed: 3 }, topics: ["vaultite-plugin"], disclosures: {}, readme: "", score: 10, ...o })
    const writeIndex = (blocked: Any) => fs.writeFileSync(INDEX, JSON.stringify({ format: 1, generated: "2026-10-01T00:00:00Z", blocked, plugins: [
      entry({ id: "harbor", name: "Harbor", repo: "alicepark/harbor", version: "1.2.0", stars: 40, disclosures: { network: ["tides.example.com"], shell: true } }),
      entry({ id: "beacon", name: "Beacon", stars: 90, created: "2024-01-01T00:00:00Z", released: "2025-01-01T00:00:00Z" }),
      entry({ id: "skiff", name: "Skiff", stars: 5, created: "2026-09-01T00:00:00Z", released: "2026-09-30T00:00:00Z", description: "Small boats and their moorings." }),
      { id: "Bad id", repo: "x/y", version: "1.0.0" }, { id: "noversion", repo: "x/y" },
    ] }))
    writeIndex({})
    process.env.VAULTITE_PLUGIN_INDEX = INDEX
    let [sc, so] = await api("POST", "ops/plugin.search", { refresh: true })
    check("index: read, entries that don't read left out, by stars", sc === 200 && so.available && so.plugins.map((e: Any) => e.id).join() === "beacon,harbor,skiff", so)
    check("index: what's installed here, and an update out", so.plugins.find((e: Any) => e.id === "harbor").installed === "1.1.0" && so.plugins.find((e: Any) => e.id === "harbor").update === true &&
      so.plugins.find((e: Any) => e.id === "beacon").installed === null, so.plugins)
    ;[, so] = await api("POST", "ops/plugin.search", { sort: "new" })
    check("index: newest first", so.plugins[0].id === "skiff", so.plugins.map((e: Any) => e.id))
    ;[, so] = await api("POST", "ops/plugin.search", { sort: "updated" })
    check("index: last updated first", so.plugins.map((e: Any) => e.id).join() === "skiff,harbor,beacon", so.plugins.map((e: Any) => e.id))
    ;[, so] = await api("POST", "ops/plugin.search", { q: "moorings" })
    check("index: searched by its words", so.plugins.length === 1 && so.plugins[0].id === "skiff", so.plugins)
    check("index: cached in the vault (live data: .vaultite/cache/)", JSON.parse(read(".vaultite/cache/plugin-index.json")).index.plugins.length === 3)
    let text = (await vau("plugin", "search")).out
    check("index: vau plugin search says what each discloses", text.includes("Harbor (alicepark/harbor) 1.2.0, 40 stars") && text.includes("says it talks to tides.example.com; runs programs on this machine"), text)
    write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: "/etc/hosts" }))
    delete process.env.VAULTITE_PLUGIN_INDEX
    check("index: a vault's setting never reads this machine's files (only http(s); else the directory's)", app.index.url().startsWith("https://raw.githubusercontent.com/"), app.index.url())
    write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: null }))
    process.env.VAULTITE_PLUGIN_INDEX = INDEX

    writeIndex({ "alicepark/harbor": ["<1.2.0"] })
    await app.index.get(true)
    h = await harbor()
    check("blocklist: an installed version it blocks doesn't load, and says why", !h.loaded && h.blocked?.includes("blocks alicepark/harbor 1.1.0") && h.problems.some((p: string) => p.includes("blocks")) &&
      (await api("GET", "harbor"))[0] === 404, h)
    ;[ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR, tag: "v1.0.0" })
    check("blocklist: a blocked version isn't installed", ic === 409, [ic, io])
    writeIndex({ harbor: ["*"] })
    await app.index.get(true)
    check("blocklist: by id, every version", (await harbor()).blocked?.includes("blocks harbor"), await harbor())
    writeIndex({ "alicepark/harbor": [">=1.0.0 <1.1.0", "2.0.0"] })
    await app.index.get(true)
    check("blocklist: outside its ranges, it loads again", (await harbor()).loaded && !(await harbor()).blocked, await harbor())
    const { versionMatches } = await import("../../../core/pluginindex.ts")
    check("blocklist: ranges", versionMatches("1.2.3", "1.2.3") && versionMatches("1.2.3", "*") && versionMatches("1.2.3", ">=1.0.0 <1.3.0") && !versionMatches("1.3.0", ">=1.0.0 <1.3.0") &&
      versionMatches("0.9.0", "<1.0.0") && !versionMatches("1.0.0", "<1.0.0") && versionMatches("1.0.0", "<=1.0.0") && versionMatches("2.0.0", ">1.9.9") && !versionMatches("1.2.3", "nonsense"))

    // Several plugins in one repository (owner/name/folder): each folder's own tags (<folder>/v1.0.0); and an index read
    // from a repository with git (plugins.json's `index`: owner/name/path.json).
    {
      const { parseSource } = await import("../../../core/installs.ts")
      check("several in one: owner/name/folder, its @tag in the folder", parseSource("fleet/plugins/dinghy@v1.0.0").tag === "dinghy/v1.0.0" &&
        parseSource("fleet/plugins/dinghy").repo === "fleet/plugins" && parseSource("fleet/plugins/dinghy").dir === "dinghy")
      let bad = ""
      try { parseSource("fleet/plugins/../x") } catch (e) { bad = (e as Error).message }
      check("several in one: a folder can't climb out", bad.includes("isn't a plugin's source"), bad)
      let dash = ""
      try { parseSource("-u@evil:x") } catch (e) { dash = (e as Error).message }
      check("a source can't be read as git's option", dash.includes("starts with a dash"), dash)
      const dinghy = (version: string) => JSON.stringify({ id: "dinghy", name: "Dinghy", description: "A made-up plugin, one of several in a repository.", version,
        author: "Alice Park", repo: "fleet/plugins", apiVersion: 1, disclosures: {} })
      const skiff = JSON.stringify({ id: "skiff", name: "Skiff", description: "Made up.", version: "1.0.0", author: "Alice Park", repo: "fleet/plugins", disclosures: {} })
      const dts = (tide: string) => PLUGIN_TS.replaceAll("harbor", "dinghy").replace('"high"', `"${tide}"`)
      repo("fleet/plugins", { "dinghy/manifest.json": dinghy("1.0.0"), "dinghy/plugin.ts": dts("high"), "skiff/manifest.json": skiff,
        "directory/index.json": JSON.stringify({ plugins: [entry({ id: "dinghy", name: "Dinghy", repo: "fleet/plugins", dir: "dinghy", tag: "dinghy/v1.0.0" })] }) }, "dinghy/v1.0.0")
      process.env.VAULTITE_GITHUB = pathToFileURL(path.join(tmp, "repos")).href
      write(".vaultite/plugins/dinghy/data.json", JSON.stringify({ kept: 1 }) + "\n")
      let [fc, fo] = await api("POST", "ops/plugin.install", { source: "fleet/plugins/dinghy" })
      check("several in one: installed from its folder at its own newest tag", fc === 200 && fo.id === "dinghy" && fo.tag === "dinghy/v1.0.0" &&
        exists(".vaultite/plugins/dinghy/plugin.ts") && !exists(".vaultite/plugins/dinghy/skiff") && lock().dinghy?.repo === "fleet/plugins" && lock().dinghy.version === "1.0.0", [fc, fo])
      check("install: a folder with only its settings is kept for it", JSON.parse(read(".vaultite/plugins/dinghy/data.json")).kept === 1)
      // An author's folder: .vaultiteignore leaves its tests out; edited, update --apply takes it and it keeps running.
      const KETCH = path.join(tmp, "ketch")
      const kt = (tide: string) => PLUGIN_TS.replaceAll("harbor", "ketch").replace('"high"', `"${tide}"`)
      for (const [f, t] of Object.entries({ "manifest.json": JSON.stringify({ id: "ketch", name: "Ketch", description: "Made up.", version: "0.1.0", author: "Alice Park",
        repo: "alicepark/ketch", disclosures: {} }), "plugin.ts": kt("high"), ".vaultiteignore": "qa/\n*.test.ts\n", "qa/run.mjs": "x", "deep/a.test.ts": "x", "deep/keep.ts": "export {}\n" })) {
        fs.mkdirSync(path.dirname(path.join(KETCH, f)), { recursive: true }); fs.writeFileSync(path.join(KETCH, f), t)
      }
      ;[fc, fo] = await api("POST", "ops/plugin.install", { source: KETCH })
      check("install from a folder: .vaultiteignore leaves its tests out", fc === 200 && exists(".vaultite/plugins/ketch/deep/keep.ts") && !exists(".vaultite/plugins/ketch/qa") &&
        !exists(".vaultite/plugins/ketch/deep/a.test.ts"), [fc, fo])
      await vau("plugin", "on", "ketch")
      fs.writeFileSync(path.join(KETCH, "plugin.ts"), kt("low"))
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "ketch", apply: true })
      check("install from a folder: edited, update --apply takes it, and it keeps running", fc === 200 && fo[0].applied && fo[0].allowed &&
        (await api("GET", "ketch"))[1]?.tide === "low", [fo, await api("GET", "ketch")])
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "ketch" })
      check("install from a folder: unchanged, it's up to date", fo[0].current === true, fo)
      await api("POST", "ops/plugin.uninstall", { id: "ketch" })
      // Its userFiles (Vim's init.vim): the user's to edit, not its code; kept when it's updated.
      const sk = (v: string) => JSON.stringify({ id: "skipper", name: "Skipper", description: "Made up.", version: v, author: "Alice Park", repo: "alicepark/skipper",
        disclosures: {}, userFiles: ["log.txt"] })
      const SKIPPER = repo("skipper", { "manifest.json": sk("1.0.0"), "plugin.ts": PLUGIN_TS.replaceAll("harbor", "skipper"), "log.txt": "default\n" }, "v1.0.0")
      await api("POST", "ops/plugin.install", { source: SKIPPER })
      await vau("plugin", "on", "skipper")
      write(".vaultite/plugins/skipper/log.txt", "the user's own\n")
      write(".vaultite/plugins/skipper/reviews.json", "{\"kept\": 1}\n") // (plugin.settings({}, "reviews"))
      await app.syncPlugins()
      const { digestOf } = await import("../../../core/vaultplugins.ts")
      const skp = await vplugin("skipper")
      check("userFiles: editing one isn't a new version, it keeps running", skp.loaded && !skp.approval, skp)
      check("settings: a <name>.json of its own isn't a new version either", skp.loaded && !skp.approval && !digestOf(path.join(VAULT, ".vaultite/plugins/skipper")).files["reviews.json"], skp)
      repo("skipper", { "manifest.json": sk("1.1.0"), "log.txt": "a newer default\n" }, "v1.1.0")
      await api("POST", "ops/plugin.update", { id: "skipper", apply: true })
      check("userFiles: an update keeps the user's", read(".vaultite/plugins/skipper/log.txt") === "the user's own\n", read(".vaultite/plugins/skipper/log.txt"))
      check("settings: an update keeps its other settings files", JSON.parse(read(".vaultite/plugins/skipper/reviews.json")).kept === 1)
      const rules = await import("../../../core/rules.ts")
      check("userFiles: never code", rules.metaProblems({ userFiles: ["x.ts"] }).length === 1 && rules.metaProblems({ userFiles: ["../x.txt"] }).length === 1 && !rules.metaProblems({ userFiles: ["init.vim"] }).length)
      await api("POST", "ops/plugin.uninstall", { id: "skipper" })
      // A lock from before its settings files but data.json were left out of the digest: a .json it ships (Obsidian
      // plugins' compat.json) was in, and isn't an edit; a changed file still is.
      const tk = (v: string) => JSON.stringify({ id: "tender", name: "Tender", description: "Made up.", version: v, author: "Alice Park", repo: "alicepark/tender", disclosures: {} })
      const TENDER = repo("tender", { "manifest.json": tk("1.0.0"), "plugin.ts": PLUGIN_TS.replaceAll("harbor", "tender"), "tides.json": "{\"high\": 6}\n" }, "v1.0.0")
      await api("POST", "ops/plugin.install", { source: TENDER })
      const tdir = path.join(VAULT, ".vaultite/plugins/tender")
      write(".vaultite/plugins-lock.json", JSON.stringify({ ...lock(), tender: { ...lock().tender, hash: digestOf(tdir, true).content } }))
      repo("tender", { "manifest.json": tk("1.1.0") }, "v1.1.0")
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "tender" })
      check("update: a lock from before settings files were left out isn't read as edited", fc === 200 && fo[0].to === "1.1.0" && fo[0].edited === false, fo)
      write(".vaultite/plugins/tender/plugin.ts", PLUGIN_TS.replaceAll("harbor", "tender") + "// mine\n")
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "tender", apply: true })
      check("update: an edit since such a lock still is", fc === 200 && fo[0].edited === true && !fo[0].applied && /changed here/.test(fo[0].error), fo)
      await api("POST", "ops/plugin.uninstall", { id: "tender" })
      repo("fleet/plugins", { "skiff/manifest.json": skiff.replace("1.0.0", "1.1.0") }, "skiff/v1.1.0")
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "dinghy" })
      check("several in one: another folder's release isn't this one's update", fc === 200 && fo[0].current === true, fo)
      repo("fleet/plugins", { "dinghy/manifest.json": dinghy("1.1.0"), "dinghy/plugin.ts": dts("low") }, "dinghy/v1.1.0")
      ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "dinghy", apply: true })
      check("several in one: its own newer tag updates it", fc === 200 && fo[0].applied && fo[0].tag === "dinghy/v1.1.0" && lock().dinghy.version === "1.1.0" &&
        read(".vaultite/plugins/dinghy/plugin.ts").includes('"low"'), fo)
      const env = process.env.VAULTITE_PLUGIN_INDEX
      delete process.env.VAULTITE_PLUGIN_INDEX
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: "fleet/plugins/directory/index.json" }))
      const [ec, eo] = await api("POST", "ops/plugin.search", { refresh: true })
      check("index in a repository: read with git, its entries' sources name their folder", ec === 200 && eo.available && eo.plugins.length === 1 &&
        eo.plugins[0].source === "fleet/plugins/dinghy" && eo.plugins[0].installed === "1.1.0", eo)
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: null }))
      process.env.VAULTITE_PLUGIN_INDEX = env
      await app.index.get(true)
      delete process.env.VAULTITE_GITHUB
      await api("POST", "ops/plugin.uninstall", { id: "dinghy" })
    }

    // Uninstalled: off, its folder in the trash (its settings kept), its lock entry and this machine's approval gone.
    let [xc, xo] = await api("POST", "ops/plugin.uninstall", { id: "harbor" })
    check("uninstall: off, to the trash, out of the lock, approval forgotten", xc === 200 && !exists(".vaultite/plugins/harbor/manifest.json") && xo.trashed.startsWith(".trash/") &&
      !lock().harbor && !(conf("plugins").enabled ?? []).includes("harbor") && !app.vaultPlugins.trust.approval("harbor") && !app.vaultPlugins.found.has("harbor"), [xc, xo])
    check("uninstall: its settings stay, for when it's installed again", JSON.parse(read(".vaultite/plugins/harbor/data.json")).mine === 1 && xo.kept === ".vaultite/plugins/harbor/", xo)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/harbor"), { recursive: true })
    ;[xc] = await api("POST", "ops/plugin.uninstall", { id: "notags" })
    check("uninstall: the last one removes the lock file", xc === 200 && !exists(".vaultite/plugins-lock.json"))
    delete process.env.VAULTITE_PLUGIN_INDEX
    for (const f of fs.readdirSync(path.join(VAULT, ".trash"))) if (/^(harbor|notags|dinghy|ketch|skipper) /.test(f)) fs.rmSync(path.join(VAULT, ".trash", f), { recursive: true })
    fs.rmSync(path.join(VAULT, ".vaultite/cache/plugin-index.json"), { force: true })

    // Bundles name installed plugins by their source: applying installs them, restoring uninstalls them. A repository
    // is a bundle too: its folder at the top (the repository's own files left out), or one .bundle.json.
    {
      process.env.VAULTITE_GITHUB = pathToFileURL(tmp).href
      repo("beacon", { "manifest.json": manifest({ id: "beacon", name: "Beacon", repo: "repos/beacon", disclosures: {} }), "plugin.ts": PLUGIN_TS.replaceAll("harbor", "beacon") }, "v1.0.0")
      const bi = await api("POST", "ops/plugin.install", { source: "repos/beacon" }), bon = await api("POST", "ops/plugin.enable", { id: "beacon" })
      check("bundles: an installed plugin to save", bi[0] === 200 && bon[0] === 200, [bi, bon])
      let [bc, bo] = await api("POST", "bundles", { name: "Lights" })
      const pj = JSON.parse(read(".vaultite/bundles/lights/plugins.json"))
      check("bundles: an installed plugin is saved as its source, not its files", bc === 200 && pj.install?.beacon?.source === "repos/beacon" && pj.install.beacon.tag === "v1.0.0" &&
        pj.enabled.includes("beacon") && !exists(".vaultite/bundles/lights/plugins/beacon/manifest.json") && bo.bundle.code.includes("beacon"), [bo, pj])
      await api("POST", "ops/plugin.uninstall", { id: "beacon" })
      ;[bc, bo] = await api("GET", "bundles/lights")
      check("bundles: its plan installs it from there", bc === 200 && bo.plan.code.some((c: Any) => c.id === "beacon" && c.source === "repos/beacon" && !c.kept) &&
        bo.plan.plugins.on.includes("beacon") && !bo.plan.plugins.missing.includes("beacon"), bo.plan)
      ;[bc] = await api("POST", "bundles/lights/apply", {})
      check("bundles: installing runs code, so it needs allowCode", bc === 409 && !exists(".vaultite/plugins/beacon/manifest.json"), bc)
      ;[bc, bo] = await api("POST", "bundles/lights/apply", { allowCode: true })
      const beacon = ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "beacon")
      check("bundles: applied, it's installed at its tag, on and running", bc === 200 && lock().beacon?.tag === "v1.0.0" && (conf("plugins").enabled ?? []).includes("beacon") && beacon?.loaded, [bo, beacon])
      ;[bc, bo] = await api("POST", "bundles/restore")
      check("bundles: restored, the plugin it installed is uninstalled", bc === 200 && !exists(".vaultite/plugins/beacon/manifest.json") && (!exists(".vaultite/plugins-lock.json") || !lock().beacon) && bo.trashed.includes(".vaultite/plugins/beacon"), bo)
      await api("DELETE", "bundles/lights")

      const desk = { "bundle.json": JSON.stringify({ name: "Writing desk" }), "appearance.json": JSON.stringify({ scheme: "nord" }), "pages.json": JSON.stringify({ pinned: ["Dashboards/Desk.md"] }),
        "Dashboards/Desk.md": "---\ntype: dashboard\n---\n\n```block-inbox\n```\n", "README.md": "# Writing desk\n", "LICENSE": "MIT\n" }
      repo("desk", desk, "v1.0.0")
      ;[bc, bo] = await api("POST", "bundles/import", { from: "repos/desk" })
      const got = (f: string) => exists(`.vaultite/bundles/${bo.bundle?.id}/${f}`)
      check("bundles: from a repository: its folder, not the repository's own files", bc === 200 && bo.bundle.id === "desk" && bo.bundle.from === "repos/desk" &&
        got("Dashboards/Desk.md") && got("appearance.json") && !got("README.md") && !got("LICENSE"), [bc, bo])
      repo("desk", { "appearance.json": JSON.stringify({ scheme: "dracula" }) }, "v1.1.0")
      ;[bc, bo] = await api("POST", "bundles/import", { from: "repos/desk" })
      check("bundles: got again from there, it isn't replaced without the user's go", bc === 409, [bc, bo])
      ;[bc, bo] = await api("POST", "bundles/import/preview", { from: "repos/desk" })
      check("bundles: its preview says what changed", bc === 200 && bo.replaces === "desk" && bo.changes?.changed.join() === "appearance.json", bo.changes)
      ;[bc, bo] = await api("POST", "bundles/import", { from: "repos/desk", replace: true })
      check("bundles: with it, it's updated in place (its newest tag)", bc === 200 && bo.bundle.id === "desk" && bo.bundle.scheme === "dracula" &&
        !exists(".vaultite/bundles/desk-2"), [bc, bo])
      // Pinned at a commit (the directory's addresses): exactly that commit, recorded in `from`; the same place replaces it.
      const DESK = path.join(tmp, "repos", "desk"), at = (ref: string) => g(DESK, "rev-list", "-n1", ref).trim()
      ;[bc, bo] = await api("POST", "bundles/import/preview", { from: `repos/desk@${at("v1.0.0")}` })
      check("bundles: pinned, its preview is that commit's, and replaces the one from the same place", bc === 200 && bo.replaces === "desk" &&
        (typeof bo.file.files["bundle.json"] === "string" ? JSON.parse(bo.file.files["bundle.json"]) : bo.file.files["bundle.json"]).from === `repos/desk@${at("v1.0.0")}`, [bc, bo])
      ;[bc, bo] = await api("POST", "bundles/import", { from: `repos/desk@${at("v1.0.0")}`, replace: true })
      check("bundles: pinned at a commit, it's that commit (not the newest tag), and from says so", bc === 200 && bo.bundle.id === "desk" && bo.bundle.scheme === "nord" &&
        bo.bundle.from === `repos/desk@${at("v1.0.0")}` && !exists(".vaultite/bundles/desk-2"), [bc, bo])
      ;[bc, bo] = await api("POST", "bundles/import", { from: `repos/desk@${"0".repeat(40)}` })
      check("bundles: a commit the repository hasn't is an error", bc === 502 && /git fetch/.test(bo.error), [bc, bo])
      ;[bc, bo] = await api("POST", "bundles/import", { from: `${tmp}@${at("v1.0.0")}` })
      check("bundles: a folder on this machine has no commit to pin", bc === 400, [bc, bo])

      // The directory's bundles (bundle.browse): searched, the blocklist's left out, and the user's import of each.
      const was = process.env.VAULTITE_PLUGIN_INDEX, BINDEX = path.join(tmp, "bundle-index.json")
      const bentry = (o: Any) => ({ description: "Made up.", author: "Bob Lee", stars: 1, updated: "2026-09-01T00:00:00Z", topics: ["vaultite-bundle"], runsCode: false, installs: [], ...o })
      fs.writeFileSync(BINDEX, JSON.stringify({ format: 1, generated: "2026-10-01T00:00:00Z", plugins: [], blocked: { "boblee/bad": ["*"] }, bundles: [
        bentry({ name: "Writing desk", description: "Pages for writing.", author: "repos", repo: "repos/desk", commit: at("v1.1.0"), stars: 9, icon: "pen", tint: "purple",
          preview: `https://raw.githubusercontent.com/repos/desk/${at("v1.1.0")}/preview.png`, previewDark: "https://example.com/x.png" }),
        bentry({ name: "Lamps", repo: "boblee/fleet", dir: "bundles/lamps", commit: "c".repeat(40), runsCode: true, installs: [{ id: "tasks", name: "Tasks", source: "Vaultite/plugins/tasks" }] }),
        bentry({ name: "Bad", repo: "boblee/bad", commit: "b".repeat(40) }), { name: "No commit", repo: "x/y", commit: "abc" } ] }))
      process.env.VAULTITE_PLUGIN_INDEX = BINDEX
      ;[bc, bo] = await api("GET", "bundles/browse?refresh=1")
      const wd = bo.bundles?.find((b: Any) => b.name === "Writing desk"), lamps = bo.bundles?.find((b: Any) => b.name === "Lamps")
      check("browse: the directory's bundles by stars, blocked and unreadable ones left out", bc === 200 && bo.available && bo.bundles.map((b: Any) => b.name).join() === "Writing desk,Lamps", bo)
      check("browse: each pinned at its commit, its pictures (raw GitHub only), what it installs", wd.address === `repos/desk@${at("v1.1.0")}` && wd.source === "repos/desk" &&
        wd.preview.endsWith("/preview.png") && !wd.previewDark && lamps.address === `boblee/fleet/bundles/lamps@${"c".repeat(40)}` && lamps.runsCode && lamps.installs[0].source === "Vaultite/plugins/tasks", bo.bundles)
      check("browse: the user's import of one, and whether it's at the listed commit", wd.imported === "desk" && wd.current === false && lamps.imported === null, wd)
      ;[bc, bo] = await api("GET", "bundles/browse?q=lamps")
      check("browse: searched by its words", bo.bundles.length === 1 && bo.bundles[0].name === "Lamps", bo.bundles)
      text = (await vau("bundle", "browse", "desk")).out
      check("vau bundle browse: each with its import address", text.includes("Writing desk (repos/desk) by repos, 9 stars") && text.includes("a newer commit is listed") &&
        text.includes(`vau bundle import repos/desk@${at("v1.1.0")}`), text)
      await api("POST", "bundles/import", { from: wd.address, replace: true })
      ;[, bo] = await api("GET", "bundles/browse")
      check("browse: imported from its address, it's current", bo.bundles[0].imported === "desk" && bo.bundles[0].current === true && read(".vaultite/bundles/desk/appearance.json").includes("dracula"), bo.bundles[0])
      check("browse: a bundle can't take the route's id", (await api("GET", "bundles/browse"))[0] === 200 && !(await api("POST", "bundles", { name: "Browse" }))[1].bundle?.id?.match(/^browse$/))
      if (was === undefined) delete process.env.VAULTITE_PLUGIN_INDEX; else process.env.VAULTITE_PLUGIN_INDEX = was
      for (const b of ((await api("GET", "bundles"))[1].bundles as Any[]).filter((x) => /^browse/.test(x.id))) await api("DELETE", `bundles/${b.id}`)
      await api("DELETE", "bundles/desk")
      const [, one] = await api("POST", "bundles/import", { vaultite: "bundle", format: 1, id: "night", files: { "bundle.json": { name: "Night" }, "appearance.json": { theme: "dark" } } })
      repo("night", { "night.bundle.json": (await api("GET", `bundles/${one.bundle.id}/export`))[1] }, null)
      await api("DELETE", `bundles/${one.bundle.id}`)
      ;[bc, bo] = await api("POST", "bundles/import", { from: "repos/night" })
      check("bundles: from a repository holding one .bundle.json", bc === 200 && bo.bundle.name === "Night" && bo.bundle.theme === "dark", [bc, bo])
      await api("DELETE", `bundles/${bo.bundle?.id}`)
      ;[bc, bo] = await api("POST", "bundles/import", { from: "repos/beacon" })
      check("bundles: a repository without a bundle says so", bc === 404 && /has no bundle/.test(bo.error), [bc, bo])
      delete process.env.VAULTITE_GITHUB
      for (const f of fs.readdirSync(path.join(VAULT, ".trash"))) if (/^(beacon|lights|desk|night|browse\S*) /.test(f)) fs.rmSync(path.join(VAULT, ".trash", f), { recursive: true })
    }

    // Updating on their own (core/updates.ts): Vaultite's by default, notes from commits since, in the lock's history;
    // a version rolled back is skipped; another machine checks synced files against their source before they run.
    {
      process.env.VAULTITE_GITHUB = pathToFileURL(path.join(tmp, "repos")).href
      const lm = (id: string, v: string, o: Any = {}) => JSON.stringify({ id, name: id[0].toUpperCase() + id.slice(1), description: "A made-up plugin: the harbour's lights.",
        version: v, author: "Alice Park", repo: id === "lantern" ? "Vaultite/plugins" : "boblee/buoy", apiVersion: 1, disclosures: {}, ...o })
      const lts = (id: string, light: string) => PLUGIN_TS.replaceAll("harbor", id).replace('"high"', `"${light}"`)
      const light = async () => (await api("GET", "lantern"))[1]?.tide
      repo("Vaultite/plugins", { "lantern/manifest.json": lm("lantern", "1.0.0"), "lantern/plugin.ts": lts("lantern", "dim") }, "lantern/v1.0.0", "feat(lantern): a light")
      repo("boblee/buoy", { "manifest.json": lm("buoy", "1.0.0"), "plugin.ts": lts("buoy", "red") }, "v1.0.0")
      for (const source of ["Vaultite/plugins/lantern", "boblee/buoy"]) await api("POST", "ops/plugin.install", { source })
      await vau("plugin", "on", "lantern"); await vau("plugin", "on", "buoy")
      const vaultiteRow = (await vplugin("lantern")).source
      check("auto updates: a source of Vaultite's is flagged official, another's isn't", vaultiteRow?.official === true && (await vplugin("buoy")).source?.official === false, vaultiteRow)
      const { official } = await import("../../../core/updates.ts")
      check("auto updates: official only at Vaultite's own address, not one that names it further in", ["Vaultite/plugins/lantern", "https://github.com/vaultite/x.git", "git@github.com:vaultite/x.git"].every(official) &&
        !["https://evil.example/github.com/vaultite/x.git", "git@evil.example:github.com/vaultite/x", "mallory/vaultite/x", "https://github.com.evil.example/vaultite/x"].some(official))
      repo("Vaultite/plugins", { "lantern/plugin.ts": lts("lantern", "bright") }, null, "feat(lantern): brighter at night")
      repo("Vaultite/plugins", { "README.md": "Lights.\n" }, null, "feat: a readme, not the lantern's")
      repo("Vaultite/plugins", { "lantern/AGENTS.md": "## Lantern\n" }, null, "chore(lantern): tidy")
      repo("Vaultite/plugins", { "lantern/manifest.json": lm("lantern", "1.1.0") }, "lantern/v1.1.0", "fix(lantern): flickers less")
      repo("boblee/buoy", { "manifest.json": lm("buoy", "1.1.0"), "plugin.ts": lts("buoy", "green") }, "v1.1.0")
      await api("DELETE", "inbox/events")
      let [ac, ao] = await api("POST", "ops/plugin.update", { auto: true })
      const lr = (ao as Any[]).find((r) => r.id === "lantern")
      check("auto updates: by default only Vaultite's, applied and allowed here (it was before), running", ac === 200 && lr?.applied && lr.allowed &&
        !(ao as Any[]).some((r) => r.id === "buoy") && await light() === "bright" && lock().buoy.version === "1.0.0", ao)
      const hist = lock().lantern.history
      check("auto updates: the lock keeps it in its history, what's new from its folder's commits (upkeep left out)", hist?.length === 1 && hist[0].from === "1.0.0" &&
        hist[0].to === "1.1.0" && hist[0].how === "auto" && JSON.stringify(hist[0].notes) === '["Brighter at night","Flickers less"]', hist)
      let [, inboxUp] = await api("GET", "inbox/events")
      check("auto updates: one notification, kept in the inbox, opening the plugin", inboxUp.events[0]?.title === "Lantern updated to 1.1.0: Brighter at night" &&
        inboxUp.events[0].link === "detail:plugin/lantern" && inboxUp.events[0].source === "plugins", inboxUp.events[0])
      const ht = (await vau("plugin", "history")).out
      check("history: vau plugin history says each update, how and what's new", /Lantern 1\.0\.0 -> 1\.1\.0 \(on its own\)\n  Brighter at night\n  Flickers less/.test(ht), ht)
      check("history: --since leaves earlier ones out", (await api("POST", "ops/plugin.history", { since: "2999-01-01" }))[1].length === 0)
      const rc = (await vau("recap")).out
      check("history: the day's recap has it, under Plugins", rc.includes("Updated Lantern to 1.1.0 · from 1.0.0, on its own") && rc.includes("> Brighter at night"), rc)
      const { parseRecap, groupOf } = await import("../../../plugins/core/activity/recap.ts")
      check("history: a recap's update line reads back as one", groupOf(parseRecap("- 10:00 Updated Lantern to 1.1.0 · from 1.0.0\n- 10:05 Rolled back Lantern to 1.0.0 · from 1.1.0\n").entries.map((e) => e.kind)[1]) === "plugins")

      // A plugin's own choice over the vault's: buoy on its own, then all of them but buoy.
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updatesOn: ["buoy"] }))
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("auto updates: updatesOn takes one the policy leaves", (ao as Any[]).find((r) => r.id === "buoy")?.applied && lock().buoy.version === "1.1.0" &&
        (await api("GET", "buoy"))[1]?.tide === "green", ao)
      repo("boblee/buoy", { "manifest.json": lm("buoy", "1.2.0") }, "v1.2.0")
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updates: "all", updatesOn: null, updatesOff: ["buoy"] }))
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("auto updates: updatesOff keeps one out, even with all", !(ao as Any[]).some((r) => r.id === "buoy") && lock().buoy.version === "1.1.0", ao)
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updates: "off", updatesOff: null }))
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("auto updates: off, none", (ao as Any[]).length === 0, ao)
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updates: null }))

      // Rolled back: the version before, still running; that version is skipped from now on, a newer one isn't.
      let [bc, bo] = await api("POST", "ops/plugin.rollback", { id: "lantern" })
      check("rollback: back to the version before, allowed, its history says so, the newer one skipped", bc === 200 && bo.to === "1.0.0" && bo.allowed && await light() === "dim" &&
        lock().lantern.version === "1.0.0" && lock().lantern.skip === "1.1.0" && lock().lantern.history.at(-1).how === "rollback", [bo, lock().lantern])
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("rollback: updating on its own skips that version", (ao as Any[]).find((r) => r.id === "lantern")?.skipped === "1.1.0" && lock().lantern.version === "1.0.0", ao)
      ;[bc, bo] = await api("POST", "ops/plugin.rollback", { id: "lantern" })
      check("rollback: not twice in a row (nothing before a rollback to go back to)", bc === 409, [bc, bo])
      repo("Vaultite/plugins", { "lantern/manifest.json": lm("lantern", "1.2.0"), "lantern/plugin.ts": lts("lantern", "steady") }, "lantern/v1.2.0", "feat(lantern): a steady light")
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("rollback: a newer version is taken (what's new since the one it had), and the skip is gone", (ao as Any[]).find((r) => r.id === "lantern")?.applied && await light() === "steady" && !lock().lantern.skip &&
        JSON.stringify(lock().lantern.history.at(-1).notes) === '["Brighter at night","Flickers less","A steady light"]', [ao, lock().lantern])
      repo("Vaultite/plugins", { "lantern/manifest.json": lm("lantern", "1.3.0", { disclosures: { network: ["lights.example.com"] } }) }, "lantern/v1.3.0", "feat(lantern): weather")
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("auto updates: not one that says it does more beyond the vault now (that's the user's call)", /does more beyond the vault/.test((ao as Any[]).find((r) => r.id === "lantern")?.error) &&
        lock().lantern.version === "1.2.0", ao)
      // (where it comes from is the lock's, a vault file: one changed since this machine allowed it isn't taken on its own)
      repo("mallory/lantern", { "manifest.json": lm("lantern", "9.0.0"), "plugin.ts": lts("lantern", "evil") }, "v9.0.0")
      const lk = conf("plugins-lock"), pj0 = conf("plugins")
      write(".vaultite/plugins-lock.json", JSON.stringify({ ...lk, lantern: { ...lk.lantern, source: "mallory/lantern" } }))
      write(".vaultite/plugins.json", JSON.stringify({ ...pj0, updatesOn: ["lantern"] }))
      ;[, ao] = await api("POST", "ops/plugin.update", { auto: true })
      check("auto updates: not from another source than the one this machine allowed it from", !(ao as Any[]).find((r) => r.id === "lantern")?.applied && await light() === "steady" &&
        lock().lantern.version === "1.2.0", ao)
      write(".vaultite/plugins-lock.json", JSON.stringify(lk))
      write(".vaultite/plugins.json", JSON.stringify(pj0))

      // Another machine updated it (the vault synced its files and lock): checked against the source, then allowed here.
      const now = await vplugin("lantern")
      const given = lock().lantern.source
      const before = () => app.vaultPlugins.trust.approve("lantern", { content: "0".repeat(16), files: {} }, { version: "1.0.0", source: given, says: {} })
      check("adopt: allowing it here keeps where it came from and what it said it does", app.vaultPlugins.trust.approval("lantern")?.source === given &&
        JSON.stringify(app.vaultPlugins.trust.approval("lantern")?.says) === "{}", app.vaultPlugins.trust.approval("lantern"))
      before()
      await app.syncPlugins()
      const waitFor = async (ok: () => Promise<boolean>) => { for (let i = 0; i < 100 && !await ok(); i++) await new Promise((r) => setTimeout(r, 100)); return ok() }
      await api("DELETE", "inbox/events")
      check("adopt: updated elsewhere, the same files as its source's: allowed here, running, said once", await waitFor(async () => (await vplugin("lantern")).loaded) &&
        await light() === "steady" && app.vaultPlugins.trust.approved("lantern", now.hash) &&
        (await waitFor(async () => (await api("GET", "inbox/events"))[1].events[0]?.title === "Lantern updated to 1.2.0: Brighter at night")), [await vplugin("lantern"), (await api("GET", "inbox/events"))[1].events])
      write(".vaultite/plugins/lantern/plugin.ts", lts("lantern", "a stranger's"))
      await app.syncPlugins()
      const forged = (await vplugin("lantern")).hash
      write(".vaultite/plugins-lock.json", JSON.stringify({ ...lock(), lantern: { ...lock().lantern, hash: forged } }))
      // (adopt reads the lock as the vault last read it: a request reads it again)
      await app.vault.sync()
      before()
      await app.syncPlugins()
      await waitFor(async () => !app.vaultPlugins.adopting.has("lantern"))
      const after = await vplugin("lantern")
      check("adopt: files that aren't the source's (the lock agreeing) wait for the user", !after.loaded && after.approval?.state === "changed" && !app.vaultPlugins.trust.approved("lantern", forged), after)
      // Its source's own files, but saying it does more than what was allowed here; or another source's, the lock naming it.
      const synced = async (files: Record<string, string>, entry: Any) => {
        for (const [f, t] of Object.entries(files)) write(`.vaultite/plugins/lantern/${f}`, t)
        await app.syncPlugins()
        const hash = (await vplugin("lantern")).hash
        write(".vaultite/plugins-lock.json", JSON.stringify({ ...lock(), lantern: { ...lock().lantern, ...entry, hash } }))
        await app.vault.sync()
        before()
        await app.syncPlugins()
        await waitFor(async () => !app.vaultPlugins.adopting.has("lantern"))
        return [hash, await vplugin("lantern")]
      }
      let [sh, sv] = await synced({ "manifest.json": lm("lantern", "1.3.0", { disclosures: { network: ["lights.example.com"] } }), "plugin.ts": lts("lantern", "steady") },
        { version: "1.3.0", tag: "lantern/v1.3.0" })
      check("adopt: its source's files, saying it does more now, wait for the user", !sv.loaded && !app.vaultPlugins.trust.approved("lantern", sh), sv)
      const theirs = { "manifest.json": lm("lantern", "1.2.0"), "plugin.ts": lts("lantern", "another's"), "AGENTS.md": "## Lantern\n" }
      repo("mallory/lantern", theirs, "v1.2.0")
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updates: "all" }))
      ;[sh, sv] = await synced(theirs, { source: "mallory/lantern", repo: "mallory/lantern", version: "1.2.0", tag: "v1.2.0" })
      check("adopt: the lock naming another source (its files that source's) waits for the user", !sv.loaded && !app.vaultPlugins.trust.approved("lantern", sh), sv)
      write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), updates: null }))

      for (const id of ["lantern", "buoy"]) await api("POST", "ops/plugin.uninstall", { id })
      for (const f of fs.readdirSync(path.join(VAULT, ".trash"))) if (/^(lantern|buoy) /.test(f)) fs.rmSync(path.join(VAULT, ".trash", f), { recursive: true })
      await api("DELETE", "inbox/events")
      delete process.env.VAULTITE_GITHUB
    }

    // Trust on a vault this machine hasn't opened: none of its plugins run (a shared vault), a new install's first one neither.
    {
      const { trustOf } = await import("../../../core/trust.ts")
      const { VaultPlugins } = await import("../../../core/vaultplugins.ts")
      const SHARED = path.join(tmp, "shared")
      fs.cpSync(path.join(TOOLS, "fixtures", "wordcount"), path.join(SHARED, ".vaultite/plugins/wordcount"), { recursive: true })
      fs.writeFileSync(path.join(SHARED, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["wordcount"] }))
      const { Vault } = await import("../../../core/vault.ts")
      const vps = new VaultPlugins(new Vault(SHARED), app.app)
      await vps.sync()
      check("trust: a shared vault's plugin that's on runs nothing here until allowed (its store made at once, empty)", !vps.list()[0].loaded && vps.list()[0].approval?.state === "new" &&
        JSON.stringify(JSON.parse(fs.readFileSync(trustOf(SHARED).file, "utf8")).plugins) === "{}", vps.list()[0])
      // A new install (no trust store at all) whose first vault has plugins on: none approved (a shared vault may be anyone's).
      const local = process.env.VAULTITE_LOCAL!, aside = `${local}-aside`
      fs.renameSync(path.join(local, "trust"), aside)
      const FIRST = path.join(tmp, "first")
      fs.cpSync(SHARED, FIRST, { recursive: true })
      const vps2 = new VaultPlugins(new Vault(FIRST), app.app)
      await vps2.sync()
      check("trust: a fresh install's first vault approves nothing it has on (its store made, empty)", !vps2.list()[0].loaded && vps2.list()[0].approval?.state === "new" &&
        JSON.stringify(JSON.parse(fs.readFileSync(trustOf(FIRST).file, "utf8")).plugins) === "{}", vps2.list()[0])
      await vps2.close()
      const vps2b = new VaultPlugins(new Vault(FIRST), app.app)
      await vps2b.sync()
      check("trust: ...nor when it's opened again", !vps2b.list()[0].loaded, vps2b.list()[0])
      await vps2b.close()
      await vps.close()
      fs.rmSync(path.join(local, "trust"), { recursive: true })
      fs.renameSync(aside, path.join(local, "trust"))
    }

    // The index builder on made-up GitHub answers.
    const { buildIndex, excerpt, scoreOf } = await import("../../plugin-index.ts")
    const now = Date.parse("2026-10-01T00:00:00Z")
    const gh: Record<string, unknown> = {
      "https://api.github.com/search/repositories?q=topic%3Avaultite-plugin&sort=stars&per_page=100&page=1": { items: [
        { full_name: "alicepark/harbor", stargazers_count: 120, created_at: "2025-01-01T00:00:00Z", pushed_at: "2026-09-20T00:00:00Z", topics: ["vaultite-plugin"], owner: { login: "alicepark" } },
        { full_name: "boblee/oldboat", stargazers_count: 3, created_at: "2024-01-01T00:00:00Z", pushed_at: "2024-02-01T00:00:00Z", owner: { login: "boblee" } },
        { full_name: "boblee/notag", stargazers_count: 9, owner: { login: "boblee" } },
        { full_name: "boblee/harbor-copy", stargazers_count: 1, owner: { login: "boblee" } },
        { full_name: "boblee/gone", archived: true, owner: { login: "boblee" } },
        { full_name: "carol/fleet", stargazers_count: 7, owner: { login: "carol" } }] },
      "https://api.github.com/repos/carol/fleet/tags?per_page=100": [{ name: "dinghy/v1.0.0", commit: { sha: "d1" } }, { name: "dinghy/v1.1.0", commit: { sha: "d2" } },
        { name: "skiff/v0.1.0", commit: { sha: "s1" } }, { name: "raft/v1.0.0", commit: { sha: "r1" } }],
      "https://api.github.com/repos/carol/fleet/commits/d2": { commit: { committer: { date: "2026-09-25T00:00:00Z" } } },
      "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/manifest.json": { id: "dinghy", name: "Dinghy", version: "1.1.0", description: "Sails.", icon: "icon.svg" },
      "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/icon.svg": '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20z"/></svg>\n',
      "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/README.md": "# Dinghy\n\nSmall sails for small boats, and when to take them in.\n",
      "https://raw.githubusercontent.com/carol/fleet/s1/skiff/manifest.json": { id: "skiff", name: "Skiff", version: "0.2.0" },
      "https://raw.githubusercontent.com/carol/fleet/HEAD/dinghy/manifest.json": { id: "dinghy", version: "1.1.0" },
      "https://raw.githubusercontent.com/carol/fleet/HEAD/skiff/manifest.json": { id: "skiff", version: "0.2.0" },
      "https://raw.githubusercontent.com/carol/fleet/r1/raft/manifest.json": { id: "raft", name: "Raft", version: "1.0.0" },
      "https://api.github.com/repos/alicepark/harbor/releases/latest": { tag_name: "v1.2.0", published_at: "2026-09-15T00:00:00Z" },
      "https://raw.githubusercontent.com/alicepark/harbor/v1.2.0/manifest.json": { id: "harbor", name: "Harbor", version: "1.2.0", description: "Tides.", author: "Alice Park", icon: "anchor", tint: "teal", category: "life", disclosures: { network: ["tides.example.com"] }, fundingUrl: "https://example.com/fund" },
      "https://api.github.com/repos/boblee/oldboat/tags?per_page=100": [{ name: "v0.9.0", commit: { sha: "aaa" } }, { name: "v0.10.0", commit: { sha: "bbb" } }, { name: "nightly" }],
      "https://api.github.com/repos/boblee/oldboat/commits/bbb": { commit: { committer: { date: "2024-02-01T00:00:00Z" } } },
      "https://raw.githubusercontent.com/boblee/oldboat/v0.10.0/manifest.json": { id: "oldboat", name: "Old boat", version: "0.10.0", description: "Rowing." },
      "https://api.github.com/repos/boblee/harbor-copy/releases/latest": { tag_name: "v1.0.0" },
      "https://raw.githubusercontent.com/boblee/harbor-copy/v1.0.0/manifest.json": { id: "harbor", name: "Harbor copy", version: "1.0.0", description: "A copy." },
      "https://api.github.com/repos/carol/listed": { full_name: "carol/listed", stargazers_count: 0, owner: { login: "carol" } },
      "https://api.github.com/repos/carol/listed/releases/latest": { tag_name: "2.0.0" },
      "https://raw.githubusercontent.com/carol/listed/2.0.0/manifest.json": { id: "listed", name: "Listed", version: "1.9.0", description: "Wrong version." },
      "https://api.github.com/repos/alicepark/harbor/readme": "# Harbor\n\n[![ci](https://x/badge.svg)](https://x)\n\nShows the **harbour's** tides on a [dashboard](https://example.com), and when the boats leave.\n",
    }
    const issues = (full: string, state: string) => `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${full} type:issue state:${state}`)}&per_page=1`
    gh[issues("alicepark/harbor", "open")] = { total_count: 2 }
    gh[issues("alicepark/harbor", "closed")] = { total_count: 8 }
    const asked: string[] = []
    const get = async (url: string) => { asked.push(url); return url in gh ? { status: 200, body: gh[url] } : { status: 404, body: { message: "Not Found" } } }
    // Bundles: a repository's at its top, a listed folder, one .bundle.json; each at the commit that last changed it.
    const D = "d".repeat(40), A = "a".repeat(40), E = "e".repeat(40), G = "9".repeat(40), H = "abcdef1" + "0".repeat(33)
    const last = (full: string, sha: string, date: string, dir = "") => { gh[`https://api.github.com/repos/${full}/commits?sha=main${dir ? `&path=${encodeURIComponent(dir)}` : ""}&per_page=1`] = [{ sha, commit: { committer: { date } } }] }
    const tree = (full: string, sha: string, paths: string[]) => { gh[`https://api.github.com/repos/${full}/git/trees/${sha}?recursive=1`] = { tree: paths.map((p) => ({ path: p, type: "blob" })) } }
    const brepo = (full: string, o: Any = {}) => ({ full_name: full, default_branch: "main", stargazers_count: 0, owner: { login: full.split("/")[0] }, ...o })
    gh["https://api.github.com/search/repositories?q=topic%3Avaultite-bundle&sort=stars&per_page=100&page=1"] = { items: [brepo("dave/desk", { stargazers_count: 30, topics: ["vaultite-bundle"] }),
      brepo("erin/night", { stargazers_count: 2, description: "Dark." }), brepo("frank/old", { archived: true }), brepo("gina/noname"), brepo("hank/bad")] }
    last("dave/desk", D, "2026-09-28T00:00:00Z"); tree("dave/desk", D, ["bundle.json", "plugins.json", "preview.png", "preview-dark.png", "plugins/lamp/manifest.json", "README.md"])
    gh[`https://raw.githubusercontent.com/dave/desk/${D}/bundle.json`] = { name: "Writing desk", description: "Pages for writing.", icon: "pen", tint: "purple" }
    gh[`https://raw.githubusercontent.com/dave/desk/${D}/plugins.json`] = { enabled: ["tasks", "lamp"], install: { tasks: { name: "Tasks", source: "Vaultite/plugins/tasks", tag: "tasks/v1.0.1" } } }
    gh["https://api.github.com/repos/Vaultite/plugins"] = brepo("Vaultite/plugins", { stargazers_count: 12 })
    last("Vaultite/plugins", A, "2026-10-01T00:00:00Z", "bundles/agents"); tree("Vaultite/plugins", A, ["tasks/manifest.json", "bundles/agents/bundle.json", "bundles/agents/sidebars.json"])
    gh[`https://raw.githubusercontent.com/Vaultite/plugins/${A}/bundles/agents/bundle.json`] = { name: "Agents", icon: "bot", tint: "orange" }
    last("erin/night", E, "2026-08-01T00:00:00Z"); tree("erin/night", E, ["night.bundle.json"])
    gh[`https://raw.githubusercontent.com/erin/night/${E}/night.bundle.json`] = { vaultite: "bundle", format: 1, files: { "bundle.json": { name: "Night" }, "plugins/owl/manifest.json": { id: "owl" } } }
    last("gina/noname", G, "2026-08-01T00:00:00Z"); tree("gina/noname", G, ["bundle.json"])
    gh[`https://raw.githubusercontent.com/gina/noname/${G}/bundle.json`] = { description: "No name." }
    last("hank/bad", H, "2026-08-01T00:00:00Z")
    const { index, skipped } = await buildIndex({ get, listed: { plugins: ["carol/listed", "not a repo"], bundles: ["Vaultite/plugins/bundles/agents", "dave/desk", "x/../y"] },
      blocked: { "boblee/oldboat": ["<1.0.0"], "Hank/Bad": ["abcdef1"] }, now })
    const hb = index.plugins.find((p) => p.id === "harbor") as Any
    check("index builder: a repo's manifest at its latest release, with its GitHub numbers", hb?.repo === "alicepark/harbor" && hb.version === "1.2.0" && hb.tag === "v1.2.0" && hb.stars === 120 &&
      hb.released === "2026-09-15T00:00:00Z" && hb.issues.open === 2 && hb.issues.closed === 8 && hb.author === "Alice Park" && hb.fundingUrl === "https://example.com/fund" &&
      JSON.stringify(hb.disclosures) === '{"network":["tides.example.com"]}', hb)
    check("index builder: a README's first prose, without badges or links' addresses", hb?.readme === "Shows the harbour's tides on a dashboard, and when the boats leave.", hb?.readme)
    const ob = index.plugins.find((p) => p.id === "oldboat") as Any
    check("index builder: no release, its newest version tag (and the commit's date)", ob?.tag === "v0.10.0" && ob.released === "2024-02-01T00:00:00Z" && ob.author === "boblee", ob)
    check("index builder: left out, saying why: no tag, archived, a version that isn't its tag's, a copy's id, a folder gone", skipped.some((x) => x.startsWith("boblee/notag: no version tag")) &&
      skipped.some((x) => x.startsWith("boblee/gone: archived")) && skipped.some((x) => x.includes("carol/listed") && x.includes("isn't its tag's")) &&
      skipped.some((x) => x.startsWith("boblee/harbor-copy: id 'harbor'")) && skipped.some((x) => x.startsWith("carol/fleet/skiff: its manifest's version")) &&
      skipped.some((x) => x === "carol/fleet/raft: no longer in the repository") &&
      index.plugins.length === 3, skipped)
    const dg = index.plugins.find((p) => p.id === "dinghy") as Any
    check("index builder: several plugins in one repository, each at its folder's newest tag", dg?.repo === "carol/fleet" && dg.dir === "dinghy" && dg.tag === "dinghy/v1.1.0" &&
      dg.version === "1.1.0" && dg.released === "2026-09-25T00:00:00Z" && dg.readme === "Small sails for small boats, and when to take them in.", dg)
    const fromIndex = (await import("../../../core/pluginindex.ts")).readIndex(JSON.parse(JSON.stringify(index))).plugins
    check("index builder: an icon by name as it is, an SVG file inline (the app reads both)", hb?.icon === "anchor" && hb.tint === "teal" &&
      dg?.icon === `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20z"/></svg>')}` &&
      fromIndex.find((p) => p.id === "dinghy")?.icon === dg.icon && fromIndex.find((p) => p.id === "harbor")?.tint === "teal", { hb: hb?.icon, dg: dg?.icon })
    check("index builder: a manifest's category, for Get plugins' filter", hb?.category === "life" && fromIndex.find((p) => p.id === "harbor")?.category === "life" && !dg?.category, hb?.category)
    check("index builder: listed.json's repos are asked for too", asked.includes("https://api.github.com/repos/carol/listed"))
    check("index builder: sorted by score, the blocklist goes out, and the app reads it", index.plugins[0].id === "harbor" && (index.blocked as Any)["boblee/oldboat"][0] === "<1.0.0" &&
      (await import("../../../core/pluginindex.ts")).readIndex(JSON.parse(JSON.stringify(index))).plugins.length === 3)
    const bs = index.bundles as Any[], desk = bs.find((b) => b.repo === "dave/desk"), agents = bs.find((b) => b.repo === "Vaultite/plugins"), night = bs.find((b) => b.repo === "erin/night")
    check("index builder: bundles by stars, the topic's and listed.json's (a folder too), each once", bs.map((b) => b.name).join() === "Writing desk,Agents,Night", bs)
    check("index builder: a bundle pinned at the commit that last changed it, with its address, pictures and what it installs", desk?.commit === D && desk.address === `dave/desk@${D}` &&
      desk.updated === "2026-09-28T00:00:00Z" && desk.stars === 30 && desk.author === "dave" && desk.icon === "pen" && desk.tint === "purple" && desk.runsCode &&
      desk.installs[0]?.source === "Vaultite/plugins/tasks" && desk.preview === `https://raw.githubusercontent.com/dave/desk/${D}/preview.png` &&
      desk.previewDark === `https://raw.githubusercontent.com/dave/desk/${D}/preview-dark.png`, desk)
    check("index builder: a listed folder's bundle, at its folder's last commit", agents?.dir === "bundles/agents" && agents.address === `Vaultite/plugins/bundles/agents@${A}` &&
      !agents.runsCode && !agents.preview && agents.description === "", agents)
    check("index builder: one .bundle.json, read from its files (its vault plugin runs code)", night?.name === "Night" && night.description === "Dark." && night.runsCode && !night.preview, night)
    check("index builder: bundles left out, saying why: archived, no name, blocked, not a place", skipped.includes("frank/old: archived") && skipped.includes("gina/noname: its bundle.json has no name") &&
      skipped.includes("hank/bad: blocked") && skipped.some((x) => x.startsWith("x/../y: not a bundle's place")), skipped)
    const readBack = (await import("../../../core/pluginindex.ts")).readIndex(JSON.parse(JSON.stringify(index))).bundles
    check("index builder: the app reads its bundles", readBack.length === 3 && readBack[0].address === desk?.address && readBack[0].installs.length === 1 && readBack[1].dir === "bundles/agents", readBack)
    check("index builder: the score blends stars with upkeep", scoreOf(1000, "2026-09-30T00:00:00Z", 0, 10, now) === 100 && scoreOf(0, null, 0, 0, now) === 10 &&
      scoreOf(120, "2026-09-20T00:00:00Z", 2, 8, now) > scoreOf(120, "2025-01-01T00:00:00Z", 2, 8, now))
    check("index builder: an excerpt is cut at 280", excerpt("x".repeat(10) + " word".repeat(100)).length <= 280)

    // A plugin's own repository, checked as installing would (tools/check_plugins.ts --plugin; the author's CI).
    const chk = (dir: string, ...more: string[]) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(TOOLS, "check_plugins.ts"), "--plugin", dir, ...more], { stdio: "pipe" }).toString() } } catch (e) { return { code: (e as Any).status, out: String((e as Any).stdout) } } }
    let ck = chk(HARBOR, "--tag", "v1.1.0")
    check("plugin check: a repository at its tag passes", ck.code === 0 && ck.out.includes("ok: harbor at v1.1.0"), ck)
    ck = chk(HARBOR, "--tag", "v2.0.0")
    check("plugin check: a tag its version isn't fails", ck.code === 1 && ck.out.includes("version is 1.1.0, but its tag is v2.0.0"), ck)
    ck = chk(BADCODE)
    check("plugin check: a rule broken fails", ck.code === 1 && ck.out.includes("its own folder"), ck)
    const [pc, po] = await api("POST", "ops/plugin.check", { path: BADTAG, tag: "v1.0.1" })
    check("plugin check: vau plugins check <folder> does the same", pc === 200 && po[0].problems.some((p: string) => p.includes("but its tag is v1.0.1")), po)
    const meta = await import("../../../core/rules.ts")
    const mp = meta.metaProblems({ version: "1", author: "", repo: "nope", fundingUrl: "http://x", disclosures: { network: ["bad host!"], shell: "yes", camera: true } })
    check("manifest: version, author, repo, fundingUrl and disclosures are checked", ["version must be", "author is a name", "repo is its GitHub", "fundingUrl is an https", "disclosures.network is", "disclosures.shell is true or false", "disclosures.camera isn't one"]
      .every((x) => mp.some((p) => p.includes(x))), mp)
    const pm = await import("../../../core/pluginmeta.ts")
    check("manifest: an icon's SVG is one SVG without scripts", !pm.svgIcon('<svg><script>alert(1)</script></svg>') && !pm.svgIcon("<html></html>") &&
      !pm.svgIcon(`<svg>${"x".repeat(pm.ICON_MAX)}</svg>`) && !!pm.svgIcon("<svg viewBox='0 0 24 24'/></svg>") && pm.iconOf("Not a name") === null && pm.iconOf("heart-pulse") === "heart-pulse")
    const ip = meta.manifestProblems({ id: "x", name: "X", description: "x", icon: "../logo.png" }, "x", new Set(["x"]))
    check("manifest: icon is a name or an SVG file in its folder", ip.some((p) => p.includes("icon is a name")), ip)
    const any = pm.disclosed(pm.disclosuresOf({ disclosures: { network: ["*.example.com", "*"] } }))
    check("manifest: network \"*\" is any host its settings name", !meta.metaProblems({ disclosures: { network: ["*"] } }).length &&
      any[0] === "talks to *.example.com and any host you set in its settings", any)
    // A vault plugin's own modules that index.tsx doesn't import are its backend's: they may use Node.
    const front = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-front-"))
    fs.writeFileSync(path.join(front, "manifest.json"), JSON.stringify({ id: path.basename(front), name: "Harbor", description: "Made up." }))
    fs.writeFileSync(path.join(front, "plugin.ts"), 'import { tide } from "./tides.ts"\nvoid tide\n')
    fs.writeFileSync(path.join(front, "tides.ts"), 'import fs from "node:fs"\nexport const tide = fs.existsSync\n')
    fs.writeFileSync(path.join(front, "index.tsx"), 'import { label } from "./shared"\nvoid label\n')
    fs.writeFileSync(path.join(front, "shared.ts"), 'import os from "node:os"\nexport const label = os.EOL\n')
    const fp = meta.pluginProblems(front, path.join(TOOLS, ".."), new Map(), true, "harbor")
    check("plugin check: a vault plugin's server-side modules may use Node, what index.tsx imports may not", fp.length === 1 && fp[0].startsWith("harbor/shared.ts: imports node:os"), fp)
    fs.rmSync(front, { recursive: true, force: true })
  }
}
