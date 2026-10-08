// Bundles' ops (core/bundles.ts) through their routes, in-process. Apply, show and save act on the workspace the
// user's window is on unless told another.
import type { App } from "../app.ts"
import { type Op, OpError, type Param } from "../ops.ts"
import { type Any, enc, lines, windowWorkspace } from "./common.ts"

const ID: Param = { type: "string", required: true, description: "the bundle's id (life-os, my-desk)" }
const WORKSPACE: Param = { type: "integer", minimum: 1, maximum: 5, description: "the workspace (1 to 5) whose panels and pins follow; the user's window's when left out" }
const where = (b: Any) => (b.source === "app" ? "built-in" : "yours")

const HELP = `A bundle is a setup of the app, in the shapes the vault already uses (a folder like .vaultite/: plugins.json,
sidebars.json, pages.json, appearance.json, hotkeys.json, plugins/<id>/data.json, plus the dashboards it pins). The
app's own are Minimal, Life OS and Agents (then Pages and databases, Self-hosted on Tailscale and Everything); the user's are in
.vaultite/bundles/<id>/. \`vau docs bundles\` has the format, so you can write one too.

  list      the bundles there are, and the setup that can be restored
  show      what applying one would change here: plugins on and off, panels, pins, the look, settings, files added
  apply     apply one: small edits (keys, one pin at a time), files only added. The panels and pins become the
            defaults and the workspace the user's window is on follows them (--workspace <n> another). The setup from
            before is kept: \`vau bundle restore\` puts it back. A bundle with vault plugins runs code on this machine:
            ask the user, then pass --code.
  restore   put back the setup from before the last bundle applied
  save      the current setup as the user's bundle <name> (--hotkeys, --vault-plugins to include those)
  export    one bundle as a single JSON file (<id>.bundle.json, or the file given; - prints it)
  import    a bundle from that JSON file, or from a folder shaped like one; it's added, not applied
  delete    one of the user's bundles (to the trash)

  vau bundle list
  vau bundle show life-os
  vau bundle apply life-os
  vau bundle restore
  vau bundle save "My desk" --description "Writing and agents"
  vau bundle export my-desk
  vau bundle import ~/Downloads/my-desk.bundle.json`

export function bundleOps(_app: App): Op[] {
  return [{
    id: "bundle.list",
    cli: "bundle list",
    summary: "Bundles: setups of the app (plugins, settings, panels, pins, look) to apply, save, export and import.",
    help: HELP,
    kind: "read",
    run: (_p, ctx) => ctx.api("GET", "bundles"),
    text: (r) => {
      const rows = (r.bundles as Any[]).map((b) => `${b.id.padEnd(18)} ${where(b).padEnd(9)} ${b.name}` +
        `${b.code?.length ? "  (runs code)" : ""}${b.problems?.length ? `  (can't be read: ${b.problems.join("; ")})` : ""}`)
      return lines(rows, "No bundles.") + (r.previous ? `\nApplied ${r.previous.name} at ${r.previous.at}: \`vau bundle restore\` puts back the setup from before.` : "")
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
      if (p.plugins.on.length) out.push(`Turns on: ${p.plugins.on.join(", ")}`)
      if (p.plugins.off.length) out.push(`Turns off: ${p.plugins.off.join(", ")}`)
      if (p.plugins.missing.length) out.push(`Not in this app (skipped): ${p.plugins.missing.join(", ")}`)
      if (p.code.length) out.push(`Runs code: brings vault plugins ${p.code.map((x: Any) => x.id).join(", ")} (apply with --code, after asking the user)`)
      if (p.panels.setup && p.panels.changed) out.push(`Panels: left ${p.panels.setup.left.join(", ") || "(none)"}; right ${p.panels.setup.right.join(", ") || "(none)"}`)
      if (p.pins) out.push(`Pinned pages: ${p.pins.list.join(", ") || "(none)"}${p.pins.unpin.length ? `; unpins ${p.pins.unpin.join(", ")}` : ""}`)
      for (const x of p.appearance) out.push(`Appearance ${x.key}: ${JSON.stringify(x.from)} -> ${JSON.stringify(x.to)}`)
      for (const x of p.settings) out.push(`${x.plugin} ${x.key}: ${JSON.stringify(x.from)} -> ${JSON.stringify(x.to)}`)
      for (const x of p.hotkeys) out.push(`Hotkey ${x.key}: ${JSON.stringify(x.from)} -> ${JSON.stringify(x.to)}`)
      for (const x of p.skipped) out.push(`Skipped ${x.plugin} ${x.key}: ${x.why}`)
      if (p.files.add.length) out.push(`Adds: ${p.files.add.join(", ")}`)
      return out.join("\n")
    },
  }, {
    id: "bundle.apply",
    cli: "bundle apply",
    summary: "Apply a bundle: its plugins, settings, panels, pins and look (the setup from before is kept for restore).",
    help: HELP,
    kind: "write",
    params: { id: ID, workspace: WORKSPACE, code: { type: "boolean", description: "allow the vault plugins it brings (they run code on this machine: ask the user first)" } },
    args: ["id"],
    run: async ({ id, workspace, code }, ctx) =>
      ctx.api("POST", `bundles/${enc(id)}/apply`, { workspace: workspace ?? await windowWorkspace(ctx), allowCode: !!code }),
    text: (r) => `Applied ${r.applied}. \`vau bundle restore\` puts back the setup from before.`,
  }, {
    id: "bundle.restore",
    cli: "bundle restore",
    summary: "Put back the setup from before the last bundle applied (files it added go to the trash).",
    help: HELP,
    kind: "destructive",
    run: (_p, ctx) => ctx.api("POST", "bundles/restore", {}),
    text: (r) => `Restored the setup from before ${r.restored}.${r.trashed?.length ? ` Files it added went to the trash: ${r.trashed.join(", ")}.` : ""}`,
  }, {
    id: "bundle.save",
    cli: "bundle save",
    summary: "Save the current setup as one of the user's bundles (.vaultite/bundles/<id>/).",
    help: HELP,
    kind: "write",
    params: {
      name: { type: "string", required: true, description: "its name (My desk)" },
      description: { type: "string", description: "one line about it" },
      hotkeys: { type: "boolean", description: "include the changed hotkeys" },
      vaultPlugins: { type: "boolean", description: "include the vault's own plugins" },
      workspace: WORKSPACE,
    },
    args: ["name"],
    run: async ({ name, description, hotkeys, vaultPlugins, workspace }, ctx) => ctx.api("POST", "bundles", { name, description, hotkeys: !!hotkeys,
      vaultPlugins: !!vaultPlugins, replace: true, workspace: workspace ?? await windowWorkspace(ctx) }),
    text: (r) => `Saved ${r.bundle.name} as .vaultite/bundles/${r.bundle.id}/.`,
  }, {
    id: "bundle.export",
    cli: "bundle export",
    summary: "One bundle as a single JSON file, to share (vau writes <id>.bundle.json; - prints it).",
    help: `${HELP}

Over the API the answer is the bundle's JSON; vau writes it to <id>.bundle.json, or to the file given after the id
(- prints it).`,
    kind: "read",
    params: { id: ID },
    args: ["id"],
    run: async ({ id }, ctx) => {
      const r = await ctx.api("GET", `bundles/${enc(id)}/export`)
      return typeof r === "string" ? JSON.parse(r) : r
    },
    text: (r) => JSON.stringify(r, null, 2),
  }, {
    id: "bundle.import",
    cli: "bundle import",
    summary: "Add a bundle from its JSON (an export): it's added, not applied.",
    help: `${HELP}

Over the API, bundle is the bundle's JSON ({"vaultite": "bundle", "format": 1, "id", "files": {path: text}}); vau
reads it from a file, or a folder shaped like a bundle.`,
    kind: "write",
    params: { bundle: { format: "json", required: true, description: "the bundle: its JSON (vau: a .bundle.json file or a bundle's folder)" } },
    args: ["bundle"],
    run: async ({ bundle }, ctx) => {
      let b = bundle
      if (typeof b === "string") { try { b = JSON.parse(b) } catch { throw new OpError("bundle isn't a bundle's JSON") } }
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new OpError("bundle isn't a bundle's JSON")
      return ctx.api("POST", "bundles/import", b)
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
