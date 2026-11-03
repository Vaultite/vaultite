// What the server keeps that isn't the user's (core/kept.ts: what's open on each device and workspace, places in videos,
// plugins' caches), read and changed as entries. Plugins' own ops say more (vau tabs devices, vau workspace tabs).
import type { App } from "../app.ts"
import { keptOf } from "../kept.ts"
import { jsonBlock, type Op, OpError } from "../ops.ts"
import { lines } from "./common.ts"

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`)

export function keptOps(app: App): Op[] {
  const kept = () => keptOf(app.vault.path)
  return [{
    id: "kept.list",
    cli: "kept",
    summary: "What the server keeps out of the vault (runtime state and caches: each device's tabs, workspaces' tabs, plugins' caches), entry by entry.",
    help: `The app keeps what isn't the user's out of the vault: what's open on each device and in each workspace, where
a video stopped, plugins' caches. It's in the server's memory and on its machine's disk; a shared entry is the other
machines' (Machines) too, the latest write winning. Each entry is "<plugin>/<name>"; a prefix lists only those.

  vau kept
  vau kept tabs/
  vau kept get workspaces/1`,
    kind: "read",
    params: { prefix: { type: "string", description: "only the entries starting with this (tabs/, workspaces/)" } },
    args: ["prefix"],
    run: ({ prefix }) => {
      const k = kept()
      return { entries: k.names(prefix ?? "").map((name) => ({ name, at: new Date(k.at(name)).toISOString(), shared: k.isShared(name), size: JSON.stringify(k.get(name)).length })) }
    },
    text: (r: { entries: { name: string; at: string; shared: boolean; size: number }[] }) =>
      lines(r.entries.map((e) => `${e.name}  ${size(e.size)}, changed ${e.at}${e.shared ? ", shared" : ""}`), "Nothing kept."),
  }, {
    id: "kept.get",
    cli: "kept get",
    summary: "One entry the server keeps (vau kept lists them), as JSON.",
    kind: "read",
    params: { name: { type: "string", required: true, description: "the entry: <plugin>/<name> (vau kept lists them)" } },
    args: ["name"],
    run: ({ name }) => {
      const v = kept().get(name, undefined)
      if (v === undefined) throw new OpError(`nothing is kept as ${name} (vau kept lists what is)`, 404)
      return v
    },
    text: jsonBlock,
  }, {
    id: "kept.set",
    cli: "kept set",
    summary: "Replace one entry the server keeps (null forgets it). Prefer the plugin's own ops, which check what they write.",
    help: `Replaces the entry whole; the app follows live (an entry other machines share goes to them too). null forgets it.
A plugin's own ops are the way to change what it keeps (vau workspace move, vau tabs device-close): this is for what
they don't do.

  vau kept set player/places null`,
    kind: "write",
    params: {
      name: { type: "string", required: true, description: "the entry: <plugin>/<name>" },
      data: { format: "json", required: true, description: "its new data (JSON), or null to forget it" },
      shared: { type: "boolean", description: "whether the other machines have it too (left out: as it was)" },
    },
    args: ["name", "data"],
    run: ({ name, data, shared }) => {
      const k = kept()
      if (!/^[a-z0-9][a-z0-9-]*\/[\w./-]+$/.test(name)) throw new OpError("`name` is <plugin>/<name> (vau kept lists them)", 400)
      return { name, changed: k.set(name, data ?? null, { shared: shared ?? k.isShared(name) }) }
    },
    text: (r) => (r.changed ? `Changed ${r.name}.` : `${r.name} was that already.`),
    did: (p) => ({ action: "ui", text: `Changed what's kept as ${p.name}` }),
  }]
}
