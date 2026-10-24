// Bundles' ops (core/bundles.ts) through their routes, in-process. Apply, show and save act on the workspace the
// user's window is on unless told another.
import type { App } from "../app.ts"
import { starter } from "../start.ts"
import { type Op, OpError, type Param } from "../ops.ts"
import { type Any, enc, lines, windowWorkspace } from "./common.ts"

const ID: Param = { type: "string", required: true, description: "the bundle's id (zen, my-desk)" }
const WORKSPACE: Param = { type: "integer", minimum: 1, maximum: 5, description: "the workspace (1 to 5) whose panels and pins follow; the user's window's when left out" }
const SKIP: Param = { type: "array", items: { type: "string" }, commas: false,
  description: "changes to leave out, by the ids bundle.show lists (setting:pages.show, pin:Dashboards/Today.md, panels)" }
const where = (b: Any) => (b.source === "app" ? "built-in" : "yours")

const HELP = `A bundle is a setup of the app, in the shapes the vault already uses (a folder like .vaultite/: plugins.json,
sidebars.json, pages.json, appearance.json, editor.json, hotkeys.json, newtab.json, plugins/<id>/data.json, plus the dashboards it
pins, and preview.png and preview-dark.png, its card's picture in light and dark); a part it leaves out stays as it is when it's applied. The app's own are
Standard (standard, the app's defaults), Zen (zen) and Browser (browser); Life OS and Agents are in the directory
(browse); the user's are in .vaultite/bundles/<id>/. \`vau docs bundles\` has the format, so you can write one too.

  list      the bundles there are, and the setup that can be restored
  show      what applying one would change here, each change with its id: plugins on and off (plugin:<id>), plugins
            installed (install:<id>), settings (setting:<plugin>.<key>), panels, pins (pin:<path>, pins:order), the
            look (appearance:<key>), the editor (editor:<key>), hotkeys (hotkey:<command>), the new tab (newtab:<key>),
            files added (file:<path>)
  apply     apply one: small edits (keys, one pin at a time), files only added. The panels and pins become the
            defaults and the workspace the user's window is on follows them (--workspace <n> another). The setup from
            before is kept: \`vau bundle restore\` puts it back. A bundle with vault plugins runs code on this machine:
            ask the user, then pass --code. --skip <id>... leaves those changes out. --trial tries it: until
            \`vau bundle keep\`, or \`vau bundle restore\` (the setup from before it); applying another meanwhile still
            restores to before the trial. The bundle applied last is in use; once the setup changes, list says what
            differs (applying it again puts it back).
  restore   put back the setup from before the last bundle applied (or tried), ending a trial
  keep      end a trial keeping its setup (restore still puts back the one before)
  fork      a copy of a bundle as the user's "<Name> (mine)", --skip <id>... leaving those changes out: values it
            skips are this setup's, pins, files and plugins it skips aren't in it
  save      the current setup as the user's bundle <name> (--hotkeys, --vault-plugins to include those); --over <id>
            saves changes to one: the user's is saved over (its name, card and source kept), the app's as "<Name> (mine)"
  export    one bundle as a single JSON file to share (<id>.bundle.json, or the file given; - prints it): not its
            picture, pages with the user's own text, nor pins to their notes, unless --include names them
  browse    the bundles in the directory (GitHub repos with the topic vaultite-bundle, and listed ones), by stars
  import    a bundle from that JSON file, a folder shaped like one, or a git repository (owner/name: the bundle's
            folder at its top, or one .bundle.json; @<commit> pins it, as browse gives it); it's added, not applied.
            Getting one the user has again (the same repository) updates it only with --replace, after the user saw
            what changed (POST /api/bundles/import/preview: \`changes\`). Plugins it installs are pinned to the commit
            and files recorded when it was saved: applying installs those or nothing.
  delete    one of the user's bundles (to the trash)

  vau bundle list
  vau bundle show browser
  vau bundle apply browser
  vau bundle apply zen --skip appearance:scheme pin:Dashboards/Today.md --trial
  vau bundle keep
  vau bundle restore
  vau bundle fork zen --skip panels
  vau bundle save "My desk" --description "Writing and agents"
  vau bundle save --over my-desk
  vau bundle export my-desk
  vau bundle browse agents
  vau bundle import ~/Downloads/my-desk.bundle.json
  vau bundle import alice/writing-desk`

export function bundleOps(app: App): Op[] {
  return [{
    id: "vault.starter",
    cli: "vault starter",
    summary: "Give a new vault its starter content: a Start here note (pinned), How this vault works, the coding agent's page and a line pointing agents at its rules in AGENTS.md and CLAUDE.md.",
    help: `What Set up Vaultite's "Start with example notes" does for a new vault. Opening a folder writes nothing
outside .vaultite/; this writes Start here.md (unless there's one) and pins it, How this vault works.md (a tour of
what a note holds), the page of the coding agent that's on (Claude; unpinned; the other plugins' pages: vau dashboard
restore), and has Agent files add its pointer line to the vault's AGENTS.md and
CLAUDE.md (made if missing), allowing it to keep them. Ask the user first.

  vau vault starter`,
    kind: "write",
    lock: false,
    run: async () => ({ wrote: await starter(app.host()) }),
    text: (r) => `Wrote ${r.wrote.join(", ")}.`,
  }, {
    id: "bundle.list",
    cli: "bundle list",
    summary: "Bundles: setups of the app (plugins, settings, panels, pins, look) to apply, save, export and import.",
    help: HELP,
    kind: "read",
    run: (_p, ctx) => ctx.api("GET", "bundles"),
    text: (r) => {
      const rows = (r.bundles as Any[]).map((b) => `${b.id.padEnd(18)} ${where(b).padEnd(9)} ${b.name}` +
        `${b.code?.length ? "  (runs code)" : ""}${b.problems?.length ? `  (can't be read: ${b.problems.join("; ")})` : ""}`)
      const last = (r.bundles as Any[]).find((b) => b.applied)
      return lines(rows, "No bundles.") +
        (last ? `\nIn use: ${last.name}${last.modified ? `, modified since (differs: ${last.differs.join(", ")}): \`vau bundle apply ${last.id}\` puts it back, \`vau bundle save --over ${last.id}\` keeps the changes` : ""}.` : "") +
        (r.trial ? `\nTrying ${r.trial.name}: \`vau bundle keep\` keeps it, \`vau bundle restore\` puts back the setup from before.` :
          r.previous ? `\nApplied ${r.previous.name} at ${r.previous.at}: \`vau bundle restore\` puts back the setup from before.` : "")
    },
  }, {
    id: "bundle.browse",
    cli: "bundle browse",
    summary: "Search the bundle directory (GitHub repos with the topic vaultite-bundle): each with its import address, pinned at a commit.",
    help: HELP,
    kind: "read",
    params: {
      q: { type: "string", description: "words to look for in names, descriptions, authors and topics" },
      refresh: { type: "boolean", description: "fetch the directory again now" },
    },
    args: ["q"],
    run: ({ q, refresh }, ctx) => ctx.api("GET", `bundles/browse?q=${enc(q ?? "")}${refresh ? "&refresh=1" : ""}`),
    text: (r) => {
      if (!r.available) return `The bundle directory can't be read now (${r.url}${r.error ? `: ${r.error}` : ""}).`
      return lines((r.bundles as Any[]).map((b) => `- ${b.name} (${b.source}) by ${b.author}, ${b.stars} stars${b.updated ? `, updated ${b.updated.slice(0, 10)}` : ""}` +
        `${b.runsCode ? `, runs code${b.installs.length ? ` (installs ${b.installs.map((x: Any) => x.name).join(", ")})` : ""}` : ""}` +
        `${b.imported ? `, imported as ${b.imported}${b.current ? "" : " (a newer commit is listed)"}` : ""}: ${b.description}\n  vau bundle import ${b.address}`), "No bundles match.")
    },
  }, {
    id: "bundle.show",
    cli: "bundle show",
    summary: "What applying a bundle would change here: plugins on and off, panels, pins, the look, settings, files added.",
    help: HELP,
    kind: "read",
    params: { id: ID, workspace: WORKSPACE },
    args: ["id"],
    run: async ({ id, workspace }, ctx) => {
      const n = workspace ?? await windowWorkspace(ctx)
      return ctx.api("GET", `bundles/${enc(id)}${n ? `?workspace=${n}` : ""}`)
    },
    text: (r) => {
      const p = r.plan as Any, b = r.bundle as Any
      const out = [`${b.name} (${where(b)}): ${b.description}`]
      if (p.empty) out.push("Applying it changes nothing here: it's the setup already.")
      else out.push("Changes (--skip <id> leaves one out):", ...(p.changes as Any[]).map((c) => `  ${c.id.padEnd(32)} ${c.label}${"to" in c ? `: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}` : ""}`))
      if (p.plugins.missing.length) out.push(`Not in this app (skipped): ${p.plugins.missing.join(", ")}`)
      if (p.plugins.added?.length) out.push(`Plugins the user added stay as they are: ${p.plugins.added.join(", ")} (--off-added turns them off too)`)
      if (p.code.length) out.push(`Runs code: brings vault plugins ${p.code.map((x: Any) => x.source && !x.kept ? `${x.id} (installed from ${x.source}${x.commit ? ` at commit ${x.commit.slice(0, 7)}` : x.tag ? ` at ${x.tag}` : ""})` : x.id).join(", ")} (apply with --code, after asking the user)`)
      if (p.panels.setup && p.panels.changed) out.push(`Panels: left ${p.panels.setup.left.join(", ") || "(none)"}; right ${p.panels.setup.right.join(", ") || "(none)"}`)
      if (p.pins) out.push(`Pinned pages: ${p.pins.list.join(", ") || "(none)"}`)
      for (const x of p.skipped) out.push(`Skipped ${x.plugin} ${x.key}: ${x.why}`)
      return out.join("\n")
    },
  }, {
    id: "bundle.apply",
    cli: "bundle apply",
    summary: "Apply a bundle: its plugins, settings, panels, pins and look (the setup from before is kept for restore).",
    help: HELP,
    kind: "write",
    params: { id: ID, workspace: WORKSPACE, code: { type: "boolean", description: "allow the vault plugins it brings (they run code on this machine: ask the user first)" },
      offAdded: { type: "boolean", description: "also turn off the plugins the user added that it doesn't name (restore turns them back on)" },
      skip: SKIP, trial: { type: "boolean", description: "try it: the user keeps it (bundle.keep) or puts back the setup from before (bundle.restore)" } },
    args: ["id"],
    run: async ({ id, workspace, code, offAdded, skip, trial }, ctx) =>
      ctx.api("POST", `bundles/${enc(id)}/apply`, { workspace: workspace ?? await windowWorkspace(ctx), allowCode: !!code, offAdded: !!offAdded, skip: skip ?? [], trial: !!trial }),
    text: (r) => r.trial ? `Trying ${r.applied}: \`vau bundle keep\` keeps it, \`vau bundle restore\` puts back the setup from before.`
      : `Applied ${r.applied}${r.plan.omitted.length ? ` without ${r.plan.omitted.join(", ")}` : ""}. \`vau bundle restore\` puts back the setup from before.`,
  }, {
    id: "bundle.restore",
    cli: "bundle restore",
    summary: "Put back the setup from before the last bundle applied (files it added go to the trash).",
    help: HELP,
    kind: "destructive",
    run: (_p, ctx) => ctx.api("POST", "bundles/restore", {}),
    text: (r) => `Restored the setup from before ${r.restored}.${r.trashed?.length ? ` Files it added went to the trash: ${r.trashed.join(", ")}.` : ""}`,
  }, {
    id: "bundle.keep",
    cli: "bundle keep",
    summary: "End trying a bundle, keeping its setup (bundle.restore still puts back the one from before).",
    help: HELP,
    kind: "write",
    run: (_p, ctx) => ctx.api("POST", "bundles/keep", {}),
    text: (r) => `Kept ${r.kept}.`,
  }, {
    id: "bundle.fork",
    cli: "bundle fork",
    summary: "Copy a bundle as the user's \"<Name> (mine)\", leaving out the changes skipped (their values this setup's).",
    help: HELP,
    kind: "write",
    params: { id: ID, skip: SKIP, workspace: WORKSPACE },
    args: ["id"],
    run: async ({ id, skip, workspace }, ctx) => ctx.api("POST", `bundles/${enc(id)}/fork`, { skip: skip ?? [], workspace: workspace ?? await windowWorkspace(ctx) }),
    text: (r) => `Saved ${r.bundle.name} as .vaultite/bundles/${r.bundle.id}/ (not applied).`,
  }, {
    id: "bundle.save",
    cli: "bundle save",
    summary: "Save the current setup as one of the user's bundles (.vaultite/bundles/<id>/).",
    help: HELP,
    kind: "write",
    params: {
      name: { type: "string", description: "its name (My desk); not with over" },
      description: { type: "string", description: "one line about it" },
      hotkeys: { type: "boolean", description: "include the changed hotkeys" },
      vaultPlugins: { type: "boolean", description: "include the vault's own plugins" },
      workspace: WORKSPACE,
      over: { type: "string", description: "save changes to this bundle (its id): the user's is saved over, keeping its name, card and source; the app's is saved as \"<Name> (mine)\"" },
    },
    args: ["name"],
    run: async ({ name, description, hotkeys, vaultPlugins, workspace, over }, ctx) => {
      if (!over && !name) throw new OpError("a bundle needs a name (or --over <id> to save changes to one)")
      return ctx.api("POST", "bundles", { ...over ? { over } : { name, replace: true }, description, ...hotkeys !== undefined ? { hotkeys } : {},
        ...vaultPlugins !== undefined ? { vaultPlugins } : {}, workspace: workspace ?? await windowWorkspace(ctx) })
    },
    text: (r) => `Saved ${r.bundle.name} as .vaultite/bundles/${r.bundle.id}/.`,
  }, {
    id: "bundle.export",
    cli: "bundle export",
    summary: "One bundle as a single JSON file, to share (vau writes <id>.bundle.json; - prints it).",
    help: `${HELP}

Over the API the answer is the bundle's JSON; vau writes it to <id>.bundle.json, or to the file given after the id
(- prints it).`,
    kind: "read",
    params: {
      id: ID,
      include: { type: "array", items: { type: "string" }, description: "parts left out by default to send anyway: preview.png, a page's path (GET /api/bundles/<id>/share lists them)" },
      leave: { type: "array", items: { type: "string" }, description: "parts to leave out (a plugin's settings, plugins/<id>/data.json; its code, plugins/<id>/)" },
      all: { type: "boolean", description: "every file as it is, the user's pins and picture too (a copy to keep, not to share)" },
    },
    args: ["id"],
    run: async ({ id, include, leave, all }, ctx) => {
      const r = await ctx.api("POST", `bundles/${enc(id)}/export`, { include: include ?? [], leave: leave ?? [], all: !!all })
      return typeof r === "string" ? JSON.parse(r) : r
    },
    text: (r) => JSON.stringify(r, null, 2),
  }, {
    id: "bundle.import",
    cli: "bundle import",
    summary: "Add a bundle from its JSON (an export): it's added, not applied.",
    help: `${HELP}

Over the API, bundle is the bundle's JSON ({"vaultite": "bundle", "format": 1, "id", "files": {path: text, or {"base64": ...} for bytes}}); vau
reads it from a file, or a folder shaped like a bundle.`,
    kind: "write",
    params: {
      bundle: { format: "json", description: "the bundle: its JSON (vau: a .bundle.json file, a bundle's folder, or a repository)" },
      from: { type: "string", description: "a git repository to get it from: owner/name on GitHub (owner/name/folder, @tag, or @<commit>: the whole sha), a git URL" },
      replace: { type: "boolean", description: "replace the user's copy from the same repository (an update): only after they saw what changed" },
    },
    args: ["bundle"],
    lock: false, // (fetching a repository waits on the network)
    run: async ({ bundle, from, replace }, ctx) => {
      if (from) return ctx.api("POST", "bundles/import", { from, replace: !!replace })
      let b = bundle
      if (typeof b === "string") { try { b = JSON.parse(b) } catch { throw new OpError("bundle isn't a bundle's JSON") } }
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new OpError("bundle isn't a bundle's JSON")
      return ctx.api("POST", "bundles/import", { ...b, replace: !!replace })
    },
    text: (r) => `Imported ${r.bundle.name} as ${r.bundle.id} (not applied: \`vau bundle show ${r.bundle.id}\`).`,
  }, {
    id: "bundle.delete",
    cli: "bundle delete",
    summary: "Delete one of the user's bundles (to the trash).",
    help: HELP,
    kind: "destructive",
    params: { id: ID },
    args: ["id"],
    run: ({ id }, ctx) => ctx.api("DELETE", `bundles/${enc(id)}`),
    text: (r) => `Deleted ${r.deleted} (in ${r.trashed}).`,
  }]
}
