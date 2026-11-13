import type { App } from "../app.ts"
import { commandList } from "../appsource.ts"
import { defineOp, type Op, OpError, type Param } from "../ops.ts"
import { strings } from "../values.ts"
import { pluginList } from "./plugins.ts"

export function paletteOps(app: App): Op[] {
  const commands = () => commandList(pluginList(app).filter((p) => p.tier === "vault"))
  const pinned = () => strings(app.vault.configWithDefaults("palette").pinned)
  const own = () => Array.isArray(app.vault.config("palette").pinned)
  const names = () => new Map(commands().map((c) => [c.id, c.name]))
  const listed = (ids: string[], name: Map<string, string>) => ids.map((id, i) => `${i + 1}. ${id}${name.has(id) ? `  ${name.get(id)}` : ""}`).join("\n") || "(none)"
  const change = (id: string, on: boolean, before?: string) => {
    if (on && !before && pinned().includes(id)) return { id, pinned: pinned() }
    const cur = pinned().filter((x) => x !== id)
    const at = before ? cur.indexOf(before) : -1
    const next = on ? (at < 0 ? [...cur, id] : [...cur.slice(0, at), id, ...cur.slice(at)]) : cur
    app.vault.patchConfig("palette", { pinned: next })
    return { id, pinned: next }
  }
  const ID = { type: "string", required: true, description: "the command's id (daily-notes:today; vau hotkeys --all lists them)" } satisfies Param
  return [defineOp({
    id: "palette.pinned",
    cli: "palette",
    summary: "The command palette's pinned commands, in order: what it lists first.",
    help: `The commands pinned to the top of the command palette (⌘P), in order: .vaultite/palette.json's \`pinned\`, or,
until that's set, an Obsidian vault's .obsidian/command-palette.json's (its core commands by the app's ids). Change
them with vau palette pin / vau palette unpin, or a row's pin in the palette.

  vau palette`,
    kind: "read",
    run: () => ({ pinned: pinned(), own: own() }),
    text: (r) => `${r.own || !r.pinned.length ? "Pinned" : "Pinned (Obsidian's, until one is pinned here)"}:\n${listed(r.pinned, names())}`,
  }), defineOp({
    id: "palette.pin",
    cli: "palette pin",
    summary: "Pin a command to the top of the command palette (at the end of the pinned ones, or before another).",
    help: `Adds a command to the palette's pinned ones (.vaultite/palette.json); one pinned already moves when before is
given. The first change copies Obsidian's pinned commands, when the vault has them. Ids: vau hotkeys --all.

  vau palette pin daily-notes:today
  vau palette pin search:open-tab --before daily-notes:today`,
    kind: "write",
    params: { id: ID, before: { type: "string", description: "the pinned command it goes before (else at the end)" } },
    args: ["id"],
    run: ({ id, before }) => {
      if (!/^[\w-]+:[\w-]+/.test(id)) throw new OpError(`'${id}' isn't a command's id (like daily-notes:today): vau hotkeys --all`)
      return change(id, true, before)
    },
    text: (r) => { const name = names(); return `Pinned ${r.id}.${name.has(r.id) ? "" : `\n(no command '${r.id}' in the app's source: check vau hotkeys --all)`}\n${listed(r.pinned, name)}` },
  }), defineOp({
    id: "palette.unpin",
    cli: "palette unpin",
    summary: "Take a command off the top of the command palette (it stays in the list).",
    help: "Removes a command from the palette's pinned ones (.vaultite/palette.json).\n\n  vau palette unpin daily-notes:today",
    kind: "write",
    params: { id: ID },
    args: ["id"],
    run: ({ id }) => {
      if (!pinned().includes(id)) throw new OpError(`${id} isn't pinned: vau palette lists the pinned ones`, 404)
      return change(id, false)
    },
    text: (r) => `Unpinned ${r.id}.\n${listed(r.pinned, names())}`,
  })]
}
