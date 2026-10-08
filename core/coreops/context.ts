// app.context (`vau context`): where an agent is before it changes anything: server, windows, vault, sidebars,
// plugins, appearance, and what plugins add (the service "context").
import type { App } from "../app.ts"
import type { Op } from "../ops.ts"
import { type Any, servicesOn, strings, windowCount, windowWorkspace } from "./common.ts"
import { panelList, showPanels, sidebarsTarget } from "./panels.ts"
import { onOff, pluginList } from "./plugins.ts"
import { serverUrl } from "../plugins.ts"
import { untyped } from "./types.ts"


export function contextOps(app: App): Op[] {
  return [{
    id: "app.context",
    cli: "context",
    summary: "Where am I: server, vault, client, workspace, pinned pages, sidebar panels, plugins, appearance. Run this first.",
    help: `Everything an agent needs to know before changing the app: the server and how many app windows are open, the
vault's folder, which client you're in (VAULTITE_CLIENT: desktop, iphone or web, set by the app's terminal), the workspace the
user's window is on, the pinned pages (the sidebar: that workspace's own, else every workspace's), the sidebars' panels
the window shows (and the hidden ones), which plugins are on or off, the appearance settings and changed hotkeys.

  vau context
  vau context --json`,
    kind: "read",
    params: { client: { type: "string", env: "VAULTITE_CLIENT", description: "the client the agent runs in (desktop, iphone or web; vau fills it in inside the app's terminal)" } },
    run: async ({ client }, ctx) => {
      const windows = await windowCount(ctx)
      const workspace = await windowWorkspace(ctx)
      const extra: { data?: Any; text?: string }[] = []
      for (const fn of servicesOn(app, "context")) {
        try { const r = await fn({ workspace }); if (r) extra.push(r) } catch (e) { console.error(e) }
      }
      const target = await sidebarsTarget(app, ctx, {}).catch(() => null)
      const { panels } = panelList(app, target?.setup)
      const plugins = pluginList(app)
      const { on } = onOff(plugins, app.vault.config("plugins"))
      return {
        url: serverUrl(), server: "running", windows, vault: app.vault.path, client: client ?? null,
        ...Object.assign({}, ...extra.map((x) => x.data ?? {})),
        extra: extra.map((x) => x.text ?? "").filter(Boolean),
        sidebars: target ? { workspace: target.label, own: !!target.setup } : null,
        panels, plugins: plugins.map((p) => ({ id: p.id, tier: p.tier, on: on(p.id) })),
        appearance: app.vault.config("appearance"), hotkeys: app.vault.config("hotkeys"),
        untyped: untyped(app).map((g) => ({ folder: g.folder, type: g.type, files: g.files.length })),
      }
    },
    text: (r) => {
      const off = (r.plugins as Any[]).filter((p) => !p.on)
      return [
        `Server: ${r.url} (running, ${r.windows} app window${r.windows === 1 ? "" : "s"} open)`,
        `Vault: ${r.vault}`,
        `Client: ${r.client ?? "unknown (VAULTITE_CLIENT isn't set: not in the app's terminal)"}`,
        "",
        ...(r.extra as string[]).flatMap((t) => [t, ""]),
        ...(r.sidebars ? [`Panels (${r.sidebars.workspace}'s${r.sidebars.own ? "" : ": the default"}):`] : []),
        showPanels(r.panels),
        "",
        `Plugins: ${r.plugins.length - off.length} on; off: ${off.map((p) => p.id + (p.tier === "vault" ? " (vault)" : "")).join(", ") || "none"}`,
        `Appearance: ${Object.entries(r.appearance).map(([k, x]) => `${k}=${JSON.stringify(x)}`).join(" ") || "defaults"}`,
        `Hotkeys changed: ${Object.entries(r.hotkeys).map(([k, x]) => `${k}=${strings(x).join("/") || "none"}`).join(" ") || "none"}`,
        ...(r.untyped.length ? [`Without a type (plain notes until they have one; vau type): ${(r.untyped as Any[]).map((g) => `${g.folder}/ ${g.files} (${g.type}?)`).join(", ")}`] : []),
        "",
        "Next: vau today, vau render <file>, vau open <file>, vau docs, vau --help",
      ].join("\n")
    },
  }]
}
