// Plugins: list, switch (plugins.json key by key; one turned on brings its panels, as the app does), allow a vault
// plugin on this machine (core/trust.ts), check, and start a new vault plugin.
import fs from "node:fs"
import path from "node:path"
import type { App } from "../app.ts"
import { panelsOf, sectionsOf, type PluginDir } from "../appsource.ts"
import { readNewTab } from "../newtab.ts"
import { type Op, type OpCtx, OpError } from "../ops.ts"
import { checkVaultPlugin, digestOf } from "../vaultplugins.ts"
import { placePanel, readSidebars, sideOf } from "../sidebars.ts"
import { API_VERSION } from "../version.ts"
import { writeAtomic } from "../vault.ts"
import { type Any, strings } from "./common.ts"

export type PluginInfo = PluginDir & { name: string; description: string; requires: string[]
  /** Off until turned on (`enabled`), like a vault plugin: the vault's, and the app's with `offByDefault`. */
  optIn: boolean
  /** A vault plugin that's on but waits for this machine's owner to allow it (core/trust.ts). */
  waiting?: boolean }


/** Every plugin: the app's built-in ones, then the vault's own (loaded or not). */
export function pluginList(app: App): PluginInfo[] {
  const own = app.vaultPlugins.list().map((v): PluginInfo => ({ id: String(v.id), tier: "vault", dir: app.vault.abs(String(v.folder)), name: String(v.name),
    description: String(v.description ?? ""), requires: strings(v.requires), optIn: true, waiting: !!v.approval }))
  return [...app.app.map((p): PluginInfo => ({ id: p.id, tier: p.tier, dir: p.dir, name: String(p.manifest.name ?? p.id),
    description: String(p.manifest.description ?? ""), requires: strings(p.manifest.requires), optIn: p.manifest.offByDefault === true })), ...own]
}

/** Which plugins are on: the app's unless in `disabled`, the vault's (and the app's `offByDefault` ones) only when in
 *  `enabled`, and everything each requires on too (web/src/core/plugins.ts isEnabled). `own`: switched on itself. */
export function onOff(list: PluginInfo[], conf: Any) {
  const disabled = strings(conf.disabled), enabled = strings(conf.enabled)
  const by = new Map(list.map((p) => [p.id, p]))
  const own = (p: PluginInfo) => (p.optIn ? enabled.includes(p.id) : !disabled.includes(p.id))
  const on = (id: string, seen: string[] = []): boolean => {
    const p = by.get(id)
    return !!p && !seen.includes(id) && own(p) && p.requires.every((r) => on(r, [...seen, id]))
  }
  return { own, on }
}

function findPlugin(list: PluginInfo[], q: string) {
  const low = q.toLowerCase().trim()
  const p = list.find((x) => x.id === low) ?? list.find((x) => x.name.toLowerCase() === low)
  if (!p) throw new OpError(`no plugin '${q}'. Plugins: ${list.map((x) => x.id).join(", ")}`, 404)
  return p
}

const ID = { type: "string" as const, required: true, description: "the plugin's id (reddit) or name (Reddit)" }

/** Let a vault plugin run on this machine as its files are now (`hash`: only if they're still what the caller was shown). */
export async function allowPlugin(app: App, q: string, hash?: string, edits?: boolean) {
  const p = findPlugin(pluginList(app), q)
  if (p.tier !== "vault") throw new OpError(`${p.name} is one of the app's plugins: only the vault's own are allowed one by one`)
  let d
  try { d = digestOf(p.dir) } catch (e) { throw new OpError(`${p.name} can't be read yet (${(e as Error).message}): try again`, 503) }
  if (hash && hash !== d.content) throw new OpError(`${p.name}'s files changed since you looked at them: look again before allowing it`, 409)
  app.vaultPlugins.allow(p.id, { digest: d, edits })
  await app.syncPlugins()
  const listed = app.vaultPlugins.list().find((x) => x.id === p.id)
  return { id: p.id, name: p.name, hash: d.content, on: !!listed?.on, loaded: !!listed?.loaded, problems: (listed?.problems ?? []) as string[],
    edits: !!app.vaultPlugins.trust.approval(p.id)?.edits }
}

/** What's wrong with one plugin's folder, anywhere on this machine (a plugin's own repository): its manifest and imports
 *  like a vault plugin's, its commands, and for one to install (`tag`: what its version must be) version and repo. */
export function folderProblems(dir: string, appIds: Map<string, string>, o: { installable?: boolean; tag?: string | null } = {}) {
  const abs = path.resolve(dir), base = path.basename(abs)
  const r = checkVaultPlugin(abs, { ids: new Map([[base, "vault"], ...appIds]), label: ".", ...o })
  const id = typeof r.manifest?.id === "string" ? r.manifest.id : base
  // (its folder may be named after its repository: the check reads it as .vaultite/plugins/<id>/ would)
  const named = `./manifest.json: id must be '${base}' (its folder's name)`
  return { id, problems: r.problems.filter((x) => base === id || x !== named), warnings: r.warnings }
}

export function pluginOps(app: App): Op[] {
  /** Switch one on or off (app plugins listed in `disabled` when off, opt-in ones in `enabled` when on); turned on, its
   *  panels join the left sidebar and its new tab sections the page, where those are saved. */
  const turn = async (q: string, want: boolean, ctx?: OpCtx) => {
    const ps = pluginList(app)
    const p = findPlugin(ps, q)
    // Turned on by this machine's owner, a vault plugin is allowed to run here as it is now (core/trust.ts); by anyone else,
    // it's on in the vault and waits for them.
    let allowed = false
    if (want && p.tier === "vault" && !(await ctx?.refusal?.("allowing a vault plugin to run on this machine"))) {
      try { app.vaultPlugins.allow(p.id); allowed = true } catch { /* can't be read yet */ }
    }
    const key = p.optIn ? "enabled" : "disabled"
    const cur = strings(app.vault.config("plugins")[key]).filter((x) => x !== p.id)
    const conf = app.vault.patchConfig("plugins", { [key]: p.optIn === want ? [...cur, p.id] : cur })
    const saved = readSidebars(app.vault.config("sidebars"))
    const add = want && saved ? panelsOf(p).filter((d) => !d.hidden && !sideOf(saved, d.key)) : []
    if (add.length) {
      const next = add.reduce((s, d) => placePanel(s, d.key, { side: "left", before: null }), saved!)
      app.vault.patchConfig("sidebars", { left: next.left, right: next.right, collapsed: next.collapsed, heights: next.heights })
    }
    // Its new tab sections (not those it hides) join the end of the page, when newtab.json lists the sections.
    const { sections } = readNewTab(app.vault.config("newtab"))
    const join = want && sections ? sectionsOf(p).filter((d) => !d.hidden && !sections.includes(d.key)).map((d) => d.key) : []
    if (join.length) app.vault.patchConfig("newtab", { sections: [...sections!, ...join] })
    const { on } = onOff(ps, conf)
    const waiting = want && p.tier === "vault" && !allowed && !app.vaultPlugins.trust.approved(p.id, app.vaultPlugins.found.get(p.id)?.digest.content ?? "")
    return { id: p.id, name: p.name, on: on(p.id), switched: want, blockedBy: want && !on(p.id) ? p.requires.filter((r) => !on(r)) : [], waiting }
  }
  const turned = (r: Any) => `${r.name} is ${r.switched ? "on" : "off"}.${r.blockedBy.length ? ` It stays off until ${r.blockedBy.join(", ")} is on.` : ""}` +
    (r.waiting ? ` It waits for this machine's owner to allow it: vau plugin allow ${r.id}` : "")

  return [{
    id: "plugin.list",
    cli: "plugins",
    summary: "List plugins, on or off (the app's built-in ones and the vault's own).",
    help: `Every plugin: the app's (built-in, whose tier is "core") and the vault's own
(.vaultite/plugins/<id>/), on or off. A plugin is off when switched off or when one it requires is. Vault plugins are
off until turned on (they run code). vau plugins check: what's wrong with the vault's own.

  vau plugins
  vau plugins check`,
    kind: "read",
    run: () => {
      const ps = pluginList(app)
      const { own, on } = onOff(ps, app.vault.config("plugins"))
      return ps.map((p) => ({ id: p.id, name: p.name, tier: p.tier, on: on(p.id) && !p.waiting, switchedOn: own(p), requires: p.requires, description: p.description,
        ...(p.waiting ? { waiting: true } : {}) }))
    },
    // (the "core" tier is the app's built-in plugins: "core" alone is the app itself)
    text: (rows: Any[]) => rows.map((p) => `${p.on ? "on " : "off"}  ${p.id.padEnd(14)} ${(p.tier === "core" ? "built-in" : p.tier).padEnd(9)} ${p.name}` +
      (p.waiting ? `  (waits to be allowed on this machine: vau plugin allow ${p.id})` : p.switchedOn && !p.on ? `  (needs ${p.requires.join(", ")})` : "")).join("\n"),
  }, {
    id: "plugin.check",
    cli: "plugins check",
    summary: "What's wrong with the vault's own plugins (or one plugin's folder): broken rules, code that didn't load or build, blocks to fix.",
    help: `Asks the server (GET /api/plugins) what's wrong with each vault plugin: broken rules, a plugin.ts that didn't
load, an index.tsx that didn't build (it stays off), one waiting to be allowed on this machine; and what to fix though it
runs: a block without its declaration in manifest.json or its text side (\`warnings\`). With a folder, checks that
one plugin wherever it is (its own repository: \`--tag v1.2.0\` also checks its version and repo, as installing would);
with a vault plugin's id, that one.

  vau plugins check
  vau plugins check habits
  vau plugins check ~/code/lighthouse --tag v1.0.0`,
    kind: "read",
    params: {
      path: { type: "string", description: "a vault plugin's id, or a plugin's folder on this machine (its repository)" },
      tag: { type: "string", description: "with path: the tag it would be installed at (its version must match)" },
      installable: { type: "boolean", description: "with path: check what installing needs (version, repo)" },
    },
    args: ["path"],
    run: async ({ path: dir, tag, installable }, ctx) => {
      if (!dir) return app.vaultPlugins.list()
      if (app.vaultPlugins.found.has(dir)) return app.vaultPlugins.list().filter((p) => p.id === dir)
      const why = await ctx.refusal?.("checking a folder on this machine")
      if (why) throw new OpError(why, 403)
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new OpError(`there's no folder ${dir}`, 404)
      const r = folderProblems(dir, new Map(app.app.map((p) => [p.id, p.tier])), { installable, tag })
      return [{ id: r.id, folder: path.resolve(dir), on: false, loaded: false, problems: r.problems, warnings: r.warnings, outside: true }]
    },
    text: (vps: Any[]) => {
      if (!vps.length) return "The vault has no plugins of its own."
      const text = vps.map((p) => `${p.id} (${p.outside ? p.folder : p.on ? "on" : "off"}${p.approval ? ", waits to be allowed on this machine" : p.on && !p.loaded ? ", not loaded" : ""}): ${p.problems?.length ? "\n" + p.problems.map((x: string) => `  - ${x}`).join("\n") : p.outside || p.on ? "ok" : "ok so far (its code runs, and is checked, once it's on)"}` +
        (p.warnings?.length ? `\n  to fix (it runs anyway):\n${p.warnings.map((x: string) => `  - ${x}`).join("\n")}` : "")).join("\n")
      return text + (vps.some((p) => p.problems?.length) ? "" : "\nNo problems.")
    },
  }, {
    id: "plugin.enable",
    cli: "plugin on",
    summary: "Turn a plugin on (the app follows live).",
    help: `Switches a plugin on (.vaultite/plugins.json: an app plugin leaves \`disabled\`; a vault plugin, or an app plugin
that's off until asked for (Vim), goes in \`enabled\`). Its panels join the sidebar. A vault plugin runs code on this
machine: ask the user first. One that requires another stays off until that one is on.

  vau plugin on terminal
  vau plugin on People`,
    kind: "write",
    params: { id: ID },
    args: ["id"],
    run: ({ id }, ctx) => turn(id, true, ctx),
    text: turned,
  }, {
    id: "plugin.allow",
    cli: "plugin allow",
    summary: "Let a vault plugin run on this machine as its files are now (one that arrived by sync, a shared vault or a bundle, or changed).",
    help: `A vault plugin runs code on this machine, so it runs only once this machine's owner allowed it at its current
version (a hash of its files, kept on this machine, not in the vault). Turning one on here allows it; one turned on
elsewhere (another machine, a shared vault, a bundle) or whose files changed since waits: \`vau plugins\` says which. Ask
the user first. \`--hash\`: only if its files are still the ones shown (GET /api/plugins' \`hash\`). \`--edits\`: while
the user writes a plugin here, its later edits run without asking each time (anyone who can write the vault's files
can then run code here through it: never for one from elsewhere).

  vau plugin allow lighthouse
  vau plugin allow garden --edits`,
    kind: "write",
    owner: "allowing a vault plugin to run on this machine",
    params: {
      id: ID,
      hash: { type: "string", description: "its files' hash as shown: refused if they changed since" },
      edits: { type: "boolean", description: "also let later edits to its files run without asking (a plugin you're writing here); false stops that" },
    },
    args: ["id"],
    run: ({ id, hash, edits }) => allowPlugin(app, id, hash, edits),
    text: (r) => (r.edits ? "Later edits to it run without asking on this machine. " : "") + (r.on ? (r.loaded ? `${r.name} is allowed on this machine, and running.` : `${r.name} is allowed on this machine, but doesn't load: ${r.problems[0] ?? "vau plugins check"}`)
      : `${r.name} is allowed on this machine; it runs once it's on (vau plugin on ${r.id}).`),
  }, {
    id: "plugin.disable",
    cli: "plugin off",
    summary: "Turn a plugin off (its files and settings stay; the app follows live).",
    help: `Switches a plugin off (.vaultite/plugins.json). What requires it is off too. Its files and settings stay, so
turning it on again brings it back as it was.

  vau plugin off reddit`,
    kind: "write",
    params: { id: ID },
    args: ["id"],
    run: ({ id }) => turn(id, false),
    text: turned,
  }, {
    id: "plugin.new",
    cli: "plugin new",
    summary: "Write a new vault plugin to start from (off until turned on).",
    help: `Writes a vault plugin in .vaultite/plugins/<id>/ to start from, the same shape as the app's own: manifest.json,
plugin.ts (a route, GET /api/<id>, and its block as text), index.tsx (the block drawn), AGENTS.md (its docs: vau docs
<id>) and pages/<Name>.md (a page with the block). It's off until turned on (\`vau plugin on <id>\`: it runs
code on this machine, so ask the user). Made by this machine's owner, it's allowed here with its edits, so editing it reloads it. Then \`vau plugins check\` and \`vau render Dashboards/<Name>.md\`. How to write one:
vau docs vault-plugins, and vau docs plugin-api for everything it can use.

  vau plugin new finance --name Finance --description "Spending by month"`,
    kind: "write",
    params: {
      id: { type: "string", required: true, description: "its id: lowercase letters, digits and dashes, starting with a letter" },
      name: { type: "string", description: "its name (from the id when left out)" },
      description: { type: "string", description: "one line: what it does" },
    },
    args: ["id"],
    run: async ({ id, name: given, description: about }, ctx) => {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new OpError("a plugin id is lowercase letters, digits and dashes, starting with a letter")
      if (pluginList(app).some((p) => p.id === id)) throw new OpError(`there's already a plugin '${id}'`, 409)
      const dir = `.vaultite/plugins/${id}`
      if (fs.existsSync(app.vault.abs(dir))) throw new OpError(`${dir} already exists`, 409)
      const name = given ?? id.split("-").map((w: string, i: number) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(" ")
      const files = scaffold(id, name, about ?? `${name}: a vault plugin (describe what it does).`)
      for (const [f, t] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(app.vault.abs(`${dir}/${f}`)), { recursive: true })
        writeAtomic(app.vault.abs(`${dir}/${f}`), t)
      }
      // Made here by this machine's owner (an agent writing one for them): allowed, its edits too, so writing it reloads it.
      const edits = !(await ctx.refusal?.("allowing a vault plugin to run on this machine"))
      if (edits) app.vaultPlugins.allow(id, { version: "0.1.0", edits: true })
      return { id, name, folder: dir, files: Object.keys(files), edits }
    },
    text: (r) => `Made ${r.folder}/: ${r.files.join(", ")}.\n` +
      `It's off until turned on (it runs code on this machine: ask the user first): vau plugin on ${r.id}\n` +
      (r.edits ? "It's allowed on this machine with its edits (made by its owner): once on, editing it reloads it.\n"
        : `It waits for this machine's owner to allow it: vau plugin allow ${r.id} --edits\n`) +
      `Then: vau plugins check, and vau render "Dashboards/${r.name}.md" (its page, pinned when it's on).`,
  }]
}

/** A vault plugin's files to start from (vau plugin new). */
function scaffold(id: string, name: string, description: string): Record<string, string> {
  return {
    "manifest.json": JSON.stringify({ id, name, description, icon: "puzzle", version: "0.1.0", apiVersion: API_VERSION, disclosures: {},
      blocks: { [id]: { description: "how many Markdown files the vault has (change it as the plugin grows)", options: {} } } }, null, 2) + "\n",
    "plugin.ts": `/**
 * ${name}: a vault plugin (made with \`vau plugin new\`). Its backend: GET /api/${id}, and \`\`\`block-${id} as text for
 * AIs (GET /api/render). index.tsx draws the same block in the app. Rules: vau docs vault-plugins.
 */
import { bullets, Plugin, section } from "@vaultite/core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** What the block shows. Change it to what this plugin is about (files of its own kind: plugin.kind; settings:
 *  plugin.settings(), its data.json; live data: plugin.memo). */
function summary() {
  return { files: plugin.vault.entries.size }
}

plugin.route("GET", "${id}", () => summary())

plugin.block("${id}", () => section("${name}", bullets([\`Markdown files in the vault: \${summary().files}\`])))
`,
    "index.tsx": `// ${name}'s frontend: \`\`\`block-${id}, drawn from its route (GET /api/${id}). The same block as text is in plugin.ts.
import { definePlugin, Loading, Panel, useLive } from "@vaultite"
import { Puzzle } from "lucide-react"

type Summary = { files: number }

function Card() {
  const { data } = useLive<Summary>("${id}")
  return (
    <Panel title="${name}" icon={Puzzle}>
      {data ? <p className="text-[15px] text-muted-foreground">Markdown files in the vault: {data.files}</p> : <Loading />}
    </Panel>
  )
}

export default definePlugin({
  blocks: { "${id}": () => <Card /> },
  mockLive: () => ({ "${id}": { files: 42 } }),
})
`,
    "AGENTS.md": `## ${name}
- \`GET /api/${id}\`: what its block shows, as JSON. (\`vau docs ${id}\` adds its blocks and their options, from
  manifest.json's \`blocks\`.)
`,
    [`pages/${name}.md`]: `---
type: dashboard
icon: layout-dashboard
tint: blue
plugin: ${id}
subtitle: "{date}"
---

\`\`\`block-${id}
\`\`\`
`,
  }
}
