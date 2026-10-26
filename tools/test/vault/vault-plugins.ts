import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { ON, VAULT, api, app, check, read, sleep, vault, write, TOOLS } = $
  // Vault plugins (core/vaultplugins.ts): the made-up Lighthouse (tools/fixtures/lighthouse) in .vaultite/plugins/.
  const LH = ".vaultite/plugins/lighthouse"
  fs.cpSync(path.join(TOOLS, "fixtures", "lighthouse"), path.join(VAULT, LH), { recursive: true })
  // (a vault that is also a code project, `npm init`'s package.json at its top: its plugins still load as ES modules)
  write("package.json", JSON.stringify({ name: "a-code-project", type: "commonjs" }) + "\n")
  write("Keepers/Bob Lee.md", "---\ntype: keeper\nshift: night\n---\n\nKeeps the lamp.\n")
  write(".vaultite/plugins/people/manifest.json", JSON.stringify({ id: "people", name: "People again", description: "A clash." }))
  write(".vaultite/plugins/tide/data.json", "{}\n") // settings only: not a plugin
  const vplugin = async (id = "lighthouse") => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === id)
  let lh = await vplugin()
  check("vault plugins: listed", lh && lh.name === "Lighthouse" && lh.folder === LH && !lh.problems.length, lh)
  check("vault plugins: its marks reach the app (a file typed by a frontmatter key opens as the plugin draws it)", lh.marks?.["lighthouse-log"] === "keeper", lh.marks)
  check("vault plugins: a new one is off, and nothing of it runs", !lh.on && !lh.loaded && lh.bundle === null && (await api("GET", "lighthouse"))[0] === 404
    && (await api("GET", `plugins/lighthouse/${lh.hash}/bundle.js`))[0] === 404 && !app.plugins.some((p) => p.id === "lighthouse"))
  check("vault plugins: a folder with only settings isn't one", !(await vplugin("tide")))
  check("vault plugins: one can't take an app plugin's id", (await vplugin("people"))?.problems[0]?.includes("already has a plugin called 'people'"), await vplugin("people"))
  // (Windows has no unreadable mode: chmod there only sets read-only)
  if (process.platform !== "win32") {
    // A file that can't be read (iCloud hasn't brought it down): a problem, never a crash, and looked at again.
    const shut = path.join(VAULT, ".vaultite/plugins/shut")
    write(".vaultite/plugins/shut/manifest.json", JSON.stringify({ id: "shut", name: "Shut", description: "Made up." }))
    write(".vaultite/plugins/shut/plugin.ts", "export {}\n")
    fs.chmodSync(path.join(shut, "plugin.ts"), 0)
    check("vault plugins: an unreadable file is a problem, not a crash", (await vplugin("shut"))?.problems[0]?.includes("can't be read yet"), await vplugin("shut"))
    fs.chmodSync(path.join(shut, "plugin.ts"), 0o644)
    check("...and read once it can be", !(await vplugin("shut"))?.problems.some((p: string) => p.includes("can't be read")), await vplugin("shut"))
    fs.rmSync(shut, { recursive: true })
  }
  let [, s] = await api("GET", "state")
  check("vault plugins: in /api/state", s.vaultPlugins.some((p: Any) => p.id === "lighthouse"))
  const turn = (on: boolean) => api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: on ? [...ON, "lighthouse"] : ON })
  // Per-machine trust (core/trust.ts): on in plugins.json alone (a sync, another machine, a shared vault), it waits here.
  await turn(true)
  lh = await vplugin()
  const TRUST = path.join(process.env.VAULTITE_LOCAL!, "trust")
  check("trust: on in plugins.json alone, it waits to be allowed on this machine, and nothing of it runs", lh.on && !lh.loaded && lh.bundle === null &&
    lh.approval?.state === "new" && lh.approval.changed.includes("plugin.ts") && (await api("GET", "lighthouse"))[0] === 404, lh)
  check("trust: kept on this machine (VAULTITE_LOCAL/trust/), never in the vault", fs.readdirSync(TRUST).length === 1 && !fs.readdirSync(path.join(VAULT, ".vaultite")).some((f) => f.includes("trust")))
  {
    const listed = ((await api("POST", "ops/plugin.list", {}))[1] as Any[]).find((x: Any) => x.id === "lighthouse")
    check("trust: vau plugins says it waits", listed.waiting === true && listed.on === false, listed)
    const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
    check("trust: only this machine's owner may allow one", await app.runOp("plugin.allow", { id: "lighthouse" }, { http: stranger }).then(() => false, (e) => e.status === 403))
    const r = await app.runOp("plugin.enable", { id: "lighthouse" }, { http: stranger })
    check("trust: turned on by someone else, it stays waiting", (r.result as Any).waiting === true && !(await vplugin()).loaded, r.result)
    const { gateOf } = await import("../../../plugins/core/mcp/public.ts")
    check("trust: plugin.allow is gated on the public MCP", gateOf("plugin.allow", "write", { id: "lighthouse" }).includes("run code"))
    check("trust: allowing its later edits says so", gateOf("plugin.allow", "write", { id: "lighthouse", edits: true }).includes("later edits"))
    check("trust: plugin.new isn't gated (what it makes waits to be allowed)", gateOf("plugin.new", "write", { id: "garden" }) === "")
    const { PublicMcp } = await import("../../../plugins/core/mcp/public.ts")
    const code = await new PublicMcp({ host: { call: (n: string, p: Any) => app.runOp(n, p) }, vault: app.vault } as Any, PublicMcp.cloudOnly()).pluginCode()
    check("trust: a waiting vault plugin's code is written without a yes", code(".vaultite/plugins/lighthouse/plugin.ts") &&
      gateOf("file.write", "write", { path: ".vaultite/plugins/lighthouse/plugin.ts" }, code) === "")
    check("trust: its data, hidden files, the app's plugins and other settings still wait",
      [".vaultite/plugins/lighthouse/data.json", ".vaultite/plugins/lighthouse/.x.ts", ".vaultite/plugins/lighthouse/../people/data.json",
        ".vaultite/plugins/people/x.json", ".vaultite/plugins.json", ".vaultite/plugins/lighthouse"].every((f) => !code(f) && gateOf("file.write", "write", { path: f }, code) !== ""))
    check("trust: a settings path written another way still waits (./, \\, its case, nested in a param)",
      ["./.vaultite/AGENTS.md", "\\.vaultite\\plugins.json", ".VAULTITE/AGENTS.md", " //./.vaultite/plugins.json"].every((f) => gateOf("file.write", "write", { path: f }, code) !== "")
        && gateOf("file.edit", "write", { edits: [{ path: "./.vaultite/AGENTS.md" }] }, code) !== "" && gateOf("file.write", "write", { files: { "./.vaultite/x.json": "{}" } }, code) !== ""
        && gateOf("file.write", "write", { path: "./.vaultite/plugins/lighthouse/plugin.ts" }, code) === "")
    check("trust: any hidden file or folder waits too, anywhere in its path (agents' settings: .claude/settings.json hooks run)",
      [".claude/settings.json", "Projects/Beacon/.codex/config.toml", "./.vscode\\tasks.json", ".env", "Notes/.git/hooks/pre-commit", ".my config/x.md"].every((f) => gateOf("file.write", "write", { path: f }, code) !== "")
        && gateOf("file.write", "write", { files: { "Notes/.cursor/rules.md": "x" } }, code) !== "" && gateOf("file.move", "write", { from: "Notes/a.md", to: ".claude/agents/a.md" }, code) !== "")
    check("trust: words that only start with a dot don't, nor the archive, nor a read",
      ["Notes/A.md", ".NET notes", "...and then", ".archive/Old.md", "Notes/v1.2 plan.md"].every((f) => gateOf("file.write", "write", { path: "Notes/x.md", text: f, title: f }, code) === "" ) &&
        gateOf("file.write", "write", { path: ".archive/Old.md" }, code) === "" && gateOf("file.read", "read", { path: ".claude/settings.json" }, code) === "")
    const [hc] = await api("POST", "ops/plugin.allow", { id: "lighthouse", hash: "0000" })
    check("trust: allowing files other than the ones shown is refused", hc === 409 && !(await vplugin()).loaded, hc)
  }
  let [acode, aout] = await api("POST", "ops/plugin.allow", { id: "lighthouse", hash: lh.hash })
  check("trust: allowed at the hash shown, it loads", acode === 200 && aout.loaded && !(await vplugin()).approval, [acode, aout])
  write(`${LH}/beam.ts`, read(`${LH}/beam.ts`) + "\n")
  lh = await vplugin()
  check("trust: its code changed (a sync), it's unloaded and waits again, saying which files changed", !lh.loaded && lh.approval?.state === "changed" &&
    JSON.stringify(lh.approval.changed) === '["beam.ts"]' && (await api("GET", "lighthouse"))[0] === 404, lh.approval)
  {
    // It stopped after being allowed: the user is told once, in the inbox, as waiting on them (App.tellPaused).
    const paused = async () => { await sleep(150); return ((await api("GET", "inbox/events"))[1].events as Any[]).filter((e) => e.key === "paused:lighthouse") }
    let told = await paused()
    check("trust: a plugin that changed after it was allowed tells the user it's paused, waiting on them", told.length === 1 && told[0].kind === "waiting" &&
      told[0].title.startsWith("Lighthouse changed and is paused") && told[0].body.includes("beam.ts") && told[0].link === "detail:plugin/lighthouse" && !told[0].read, told)
    const first = told[0]?.id
    write(`${LH}/beam.ts`, read(`${LH}/beam.ts`) + "\n")
    await vplugin()
    told = await paused()
    check("trust: ...once, not again for each later edit", told.length === 1 && told[0].id === first && !!app.vaultPlugins.trust.approval("lighthouse")?.paused, told)
  }
  ;[acode, aout] = await api("POST", "ops/plugin.allow", { id: "lighthouse", edits: true })
  check("trust: allowed with edits, it loads, and later edits run (a plugin written here)", acode === 200 && aout.loaded && aout.edits, aout)
  await vplugin()
  await sleep(150)
  check("trust: allowed again, its paused notice is read", ((await api("GET", "inbox/events"))[1].events as Any[]).find((e) => e.key === "paused:lighthouse")?.read === true)
  let [lcode, lout] = await api("GET", "lighthouse")
  check("vault plugins: turned on, its route answers", lcode === 200 && ["on", "off"].includes(lout.beam) && lout.keepers === 1, [lcode, lout])
  let [, out] = await api("GET", "keepers")
  check("vault plugins: its kind reads its files", out.length === 1 && out[0].shift === "night", out)
  lh = await vplugin()
  check("vault plugins: loaded and built", lh.on && lh.loaded && typeof lh.bundle === "string" && !lh.problems.length, lh)
  check("vault plugins: an app id clash stays refused even when on", !(await vplugin("people")).loaded && app.plugins.filter((p) => p.id === "people").length === 1)
  const [bcode, entry] = await api("GET", `plugins/lighthouse/${lh.bundle}/bundle.js`)
  // (it preloads CodeMirror: bundle.js imports its module only then, a static import would run first)
  const [, main] = await api("GET", `plugins/lighthouse/${lh.bundle}/main.js`)
  const shared = [...String(main).matchAll(/from\s*["']\.\/([\w-]+\.js)["']/g)].map((m) => m[1]) // (its code, in a chunk its import() shares)
  let bundle = String(main)
  for (const f of shared) bundle += (await api("GET", `plugins/lighthouse/${lh.bundle}/${f}`))[1]
  check("vault plugins: its module is imported after what it preloads, never statically", typeof entry === "string" && shared.length > 0 &&
    !/\bfrom\s*["']/.test(entry.split("\n").slice(1).join("\n")) /* (after its styles' line) */ && /preload\(\["@codemirror\/view"\]\);\nconst m = await import\("\.\/main\.js"\)/.test(entry), [entry.slice(-300), String(main).slice(0, 200)])
  check("vault plugins: its bundle is one module sharing the app's React and API", bcode === 200 && bundle.includes("__vaultite.modules[`react/jsx-runtime`]")
    && bundle.includes("__vaultite.modules[`@vaultite`]") && !bundle.includes("useState=") && bundle.includes("Lighting the lamp"), bundle.slice(0, 300))
  const chunk = /import\(["`']\.\/(logbook-[\w-]+\.js)["`']\)/.exec(bundle)?.[1]
  check("vault plugins: what it imports when needed is a chunk of its own, beside its bundle", !!chunk && !bundle.includes("calm seas") &&
    (await api("GET", `plugins/lighthouse/${lh.bundle}/${chunk}`))[1]?.includes?.("calm seas") && (await api("GET", `plugins/lighthouse/0/${chunk}`))[0] === 404, bundle.slice(-300))
  check("vault plugins: CodeMirror is the app's, loaded with it, not bundled", entry.includes('preload(["@codemirror/view"])')
    && bundle.includes("__vaultite.modules[`@codemirror/view`]") && !bundle.includes("cm-scroller"), bundle.slice(0, 300))
  check("vault plugins: with its Tailwind classes, under the app's", entry.includes("@layer plugins") && entry.includes("tracking-\\\\[0\\\\.0625em\\\\]"), bundle.slice(0, 400))
  check("vault plugins: its variants the app hasn't over the app's classes, the app's own under them", /@layer plugin-variants[^]*md\\\\:tracking-/.test(entry) &&
    !/@layer plugin-variants[^]*md\\\\:hidden/.test(entry), bundle.slice(0, 600))
  check("vault plugins: its docs join the topics", (await api("GET", "docs"))[1].some((t: Any) => t.id === "lighthouse"))
  check("vault plugins: allowed and on, it writes its page, pinned", read("Dashboards/Lighthouse.md").includes("block-lighthouse")
    && vault.config("pages").pinned.includes("Dashboards/Lighthouse.md"))
  ;[, out] = await api("GET", "render?path=Dashboards/Lighthouse.md")
  check("vault plugins: its block as text", out.includes("## Lighthouse") && out.includes("[[Bob Lee]]: night shift"), out)
  check("vault plugins: its block declared, nothing to fix", !lh.warnings.length && lh.blocks.lighthouse?.description, lh)
  check("vault plugins: its blocks in /api/blocks", (await api("GET", "blocks"))[1].blocks.some((b: Any) => b.name === "lighthouse" && b.plugin === "lighthouse" && b.on && b.text), "")
  check("vault plugins: its blocks in its docs, from the manifest", (await api("GET", "docs/lighthouse"))[1].includes("- `lighthouse`: whether the beam is on, and the keepers"))
  ;[, out] = await api("GET", "render?path=Keepers/Bob Lee.md")
  check("vault plugins: what it says under a page's title (page-head)", out.includes("# Bob Lee\n\nOn the night shift\n"), out)
  write("Beam log.md", "Tonight `=beam`, and `=other` and `x`.\n\n```\n`=beam` in code\n```\n")
  ;[, out] = await api("GET", "render?path=Beam log.md")
  check("vault plugins: inline code a plugin reads (inline-code) as its text, the rest and code fences as they are",
    /^Tonight the beam is (on|off), and `=other` and `x`\.\n\n```\n`=beam` in code\n```/.test(out.replace(/^# Beam log\n\n/, "")), out)
  fs.rmSync(path.join(VAULT, "Beam log.md"))
  {
    const before = read(`${LH}/manifest.json`), text = read(`${LH}/plugin.ts`)
    write(`${LH}/manifest.json`, JSON.stringify({ ...JSON.parse(before), blocks: { beacon: { description: "" } } }))
    write(`${LH}/plugin.ts`, text.replace('plugin.block("lighthouse"', 'plugin.block("lighthouse-text"'))
    lh = await vplugin()
    check("vault plugins: a block without its declaration or its text side is a warning, and it still loads", lh.loaded && !lh.problems.length
      && lh.warnings.some((w: string) => w.includes("block 'lighthouse'") && w.includes("isn't declared"))
      && lh.warnings.some((w: string) => w.includes("no text side")) && lh.warnings.some((w: string) => w.includes("block 'beacon' needs a description"))
      && lh.warnings.some((w: string) => w.includes("declares block 'beacon', which index.tsx doesn't draw")), lh.warnings)
    write(`${LH}/manifest.json`, before)
    write(`${LH}/plugin.ts`, text)
    lh = await vplugin()
    check("vault plugins: fixed, the warnings go", lh.loaded && !lh.warnings.length, lh.warnings)
  }
  write(`${LH}/plugin.ts`, read(`${LH}/plugin.ts`).replace('keepers: plugin.vault.items("keepers").length', 'keepers: plugin.vault.items("keepers").length + 10'))
  ;[, lout] = await api("GET", "lighthouse")
  check("vault plugins: an edit reloads it on the next request", lout.keepers === 11, lout)
  check("vault plugins: its own files are loaded again too (a new version of beam.ts)", ["on", "off"].includes(lout.beam))
  const lhPlugin = read(`${LH}/plugin.ts`)
  write(`${LH}/plugin.ts`, `import "../../../core/app.ts"\n${lhPlugin}`)
  lh = await vplugin()
  check("vault plugins: an import outside its folder is refused", !lh.loaded && lh.problems.some((p: string) => p.includes("its own folder")) && (await api("GET", "lighthouse"))[0] === 404, lh.problems)
  check("vault plugins: unloaded, its kind is gone", (await api("GET", "keepers"))[0] === 404)
  write(`${LH}/plugin.ts`, lhPlugin.replace("export const plugin", 'await import(["..", "..", "x.ts"].join("/")).catch((e) => { throw e })\nexport const plugin'))
  lh = await vplugin()
  check("vault plugins: what the check can't see, the resolve hook refuses", !lh.loaded && lh.problems.some((p: string) => p.includes("plugin.ts couldn't be loaded") && p.includes("its own folder")), lh.problems)
  write(`${LH}/plugin.ts`, lhPlugin.replace('from "@vaultite/core/vault.ts"', 'from "@vaultite/core/app.ts"'))
  lh = await vplugin()
  check("vault plugins: only the core's plugin files", !lh.loaded && lh.problems.some((p: string) => p.includes("@vaultite/core/app.ts")), lh.problems)
  write(`${LH}/plugin.ts`, lhPlugin)
  write(`${LH}/index.tsx`, `import { get } from "@/core/data"\nimport fs from "node:fs"\nvoid get; void fs\n${read(`${LH}/index.tsx`)}`)
  lh = await vplugin()
  check("vault plugins: the frontend's rules too", !lh.loaded && lh.problems.some((p: string) => p.includes("@/core/data")) && lh.problems.some((p: string) => p.includes("node:fs")), lh.problems)
  fs.cpSync(path.join(TOOLS, "fixtures", "lighthouse", "index.tsx"), path.join(VAULT, LH, "index.tsx"))
  write(`${LH}/label.ts`, "export const label = (\n")
  lh = await vplugin()
  check("vault plugins: a frontend that doesn't build says why, the backend still runs", lh.loaded && lh.bundle === null
    && lh.problems.some((p: string) => p.startsWith("index.tsx couldn't be built")) && (await api("GET", "lighthouse"))[0] === 200, lh.problems)
  fs.cpSync(path.join(TOOLS, "fixtures", "lighthouse", "label.ts"), path.join(VAULT, LH, "label.ts"))
  write(`${LH}/data.json`, JSON.stringify({ dusk: 0 }))
  lh = await vplugin()
  const version = lh.bundle
  ;[, lout] = await api("GET", "lighthouse")
  check("vault plugins: its settings are data.json, and changing them isn't a new version", lh.loaded && version && lout.beam === "on", [lh, lout])
  // What a plugin needs of the app (core/version.ts): minAppVersion and apiVersion in its manifest.
  const { API_VERSION, APP_VERSION } = await import("../../../core/version.ts")
  const { compatProblems } = await import("../../../core/rules.ts")
  check("versions: APP_VERSION is package.json's", APP_VERSION === JSON.parse(fs.readFileSync(path.join(TOOLS, "..", "package.json"), "utf8")).version, APP_VERSION)
  ;[, s] = await api("GET", "state")
  check("versions: in /api/state", s.app?.version === APP_VERSION && s.app?.api === API_VERSION, s.app)
  const lhManifest = read(`${LH}/manifest.json`)
  const manifest = (extra: object) => write(`${LH}/manifest.json`, JSON.stringify({ ...JSON.parse(lhManifest), ...extra }))
  manifest({ minAppVersion: APP_VERSION, apiVersion: API_VERSION })
  lh = await vplugin()
  check("versions: a plugin this app can run loads", lh.loaded && !lh.problems.length && lh.minAppVersion === APP_VERSION && lh.apiVersion === API_VERSION, lh)
  manifest({ minAppVersion: "99.0.0" })
  lh = await vplugin()
  check("versions: one that needs a newer app isn't loaded, and says why", !lh.loaded && (await api("GET", "lighthouse"))[0] === 404
    && lh.problems.some((p: string) => p.includes("needs Vaultite 99.0.0 or later") && p.includes(`this is ${APP_VERSION}`)), lh.problems)
  manifest({ apiVersion: API_VERSION + 1 })
  lh = await vplugin()
  check("versions: one written for a newer plugin API isn't loaded", !lh.loaded && lh.problems.some((p: string) => p.includes(`plugin API ${API_VERSION + 1}, newer`)), lh.problems)
  manifest({ minAppVersion: "soon", apiVersion: "1" })
  lh = await vplugin()
  check("versions: fields that aren't versions are problems", !lh.loaded && lh.problems.some((p: string) => p.includes("minAppVersion must be a version"))
    && lh.problems.some((p: string) => p.includes("apiVersion must be a whole number")), lh.problems)
  check("versions: an API older than the app still loads is refused", compatProblems({ apiVersion: 1 }, "m", "1.0.0", 3, 2)[0]?.includes("no longer loads"))
  check("versions: semver, not text order", compatProblems({ minAppVersion: "0.10.0" }, "m", "0.9.0").length === 1 && !compatProblems({ minAppVersion: "0.9.0" }, "m", "0.10.0").length)
  {
    const { manifestProblems, pluginProblems } = await import("../../../core/rules.ts")
    const m = { id: "lighthouse", name: "Lighthouse", description: "Made up" }
    check("category: a slug is fine, one not listed too (Other)", !manifestProblems({ ...m, category: "life" }, "lighthouse", new Set()).length &&
      !manifestProblems({ ...m, category: "boats" }, "lighthouse", new Set()).length)
    check("category: not a slug is refused", manifestProblems({ ...m, category: "Life stuff" }, "lighthouse", new Set()).some((p) => p.includes("category")))
    const root = path.dirname(TOOLS), people = path.join(root, "plugins", "core", "people")
    check("category: every app plugin names a listed one", !pluginProblems(people, root, new Map([["people", "core"]]), false, "people").some((p) => p.includes("category")))
    const vim = path.join(root, "plugins", "core", "vim")
    check("offByDefault: an app plugin may be", !pluginProblems(vim, root, new Map([["vim", "core"]]), false, "vim").length)
    check("offByDefault: not for a vault plugin", pluginProblems(vim, root, new Map([["vim", "vault"]]), true, "vim").some((p) => p.includes("offByDefault")))
  }
  write(`${LH}/manifest.json`, lhManifest)
  lh = await vplugin()
  check("versions: fixed, it loads again", lh.loaded && !lh.problems.length, lh.problems)
  await turn(false)
  lh = await vplugin()
  check("vault plugins: turned off, it's unloaded", !lh.loaded && !lh.on && (await api("GET", "lighthouse"))[0] === 404 && (await api("GET", "keepers"))[0] === 404
    && !app.plugins.some((p) => p.id === "lighthouse"))
  check("vault plugins: and its docs leave", (await api("GET", "docs/lighthouse"))[0] === 404)
  {
    // (a module a plugin imports later, after it was allowed: the file as allowed, or nothing)
    const TP = ".vaultite/plugins/tidepool"
    write(`${TP}/manifest.json`, JSON.stringify({ id: "tidepool", name: "Tidepool", description: "A made-up plugin.", version: "1.0.0", author: "Alice Park", repo: "alicepark/tidepool", disclosures: {}, apiVersion: 1 }))
    write(`${TP}/plugin.ts`, 'import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\nplugin.route("GET", "tidepool/word", async () => ({ word: (await import("./word.ts")).word }))\nplugin.route("GET", "tidepool/later", async () => ({ word: (await import("./later.ts")).word }))\n')
    write(`${TP}/word.ts`, 'export const word = "calm"\n')
    write(`${TP}/later.ts`, 'export const word = "calm"\n')
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "tidepool"] })
    await api("POST", "ops/plugin.allow", { id: "tidepool", edits: false })
    const calm = await app.run("GET", ["tidepool", "word"], {}, {})
    fs.writeFileSync(path.join(VAULT, TP, "later.ts"), 'export const word = "storm"\n')
    const r = await app.run("GET", ["tidepool", "later"], {}, {})
    check("vault plugins: a module imported after it was allowed loads only as allowed", (calm.body as Any)?.word === "calm" && r.status !== 200 && (r.body as Any)?.word !== "storm", [calm.body, r.status, r.body])
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: (vault.config("plugins").enabled ?? []).filter((x: string) => x !== "tidepool") })
    fs.rmSync(path.join(VAULT, TP), { recursive: true })
  }
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/people"), { recursive: true })
  Object.assign($.vars, { vplugin })
}
