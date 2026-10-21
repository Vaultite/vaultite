// app.permissions (`vau permissions`): whether the app and its terminals can read the vault now, and, in the desktop app
// on a Mac, macOS's privacy permissions and how the app is signed (Settings > Permissions shows the same).
import fs from "node:fs"
import type { App } from "../app.ts"
import { inDesktop, desktopCall } from "../desktopapp.ts"
import type { Op } from "../ops.ts"
import { accessOf, keepsPermissions, signingText, STATE_TEXT, type Access, type PermissionReport } from "../permissions.ts"
import { serviceOn } from "./common.ts"

const line = (a: Access) => (a.ok ? "can read it" : a.ok === false ? `can't read it: ${a.why}` : `unknown: ${a.why}`)

export function permissionOps(app: App): Op[] {
  return [{
    id: "app.permissions",
    cli: "permissions",
    summary: "What macOS lets the desktop app do: the vault folder (the app and its terminals), privacy permissions, how it's signed.",
    help: `Whether this server and a new terminal (its keeper, which outlives the app) can read the vault folder now: an
agent that dies at launch with a vague error ("Unexpected") is often a terminal macOS doesn't let read it. In the desktop
app on a Mac, each privacy permission's state (Allowed, Not allowed, Not asked yet, Unknown where macOS can't tell
without asking) and how the app is signed: ad hoc, macOS asks for every permission again after each update.

  vau permissions
  vau permissions --json`,
    kind: "read",
    owner: "this machine's permissions",
    run: async (): Promise<PermissionReport> => {
      const dir = app.vault.path
      const own = await fs.promises.readdir(dir).then((): Access => ({ ok: true }), (e: NodeJS.ErrnoException) => accessOf(e.code ?? "EIO"))
      const ask = serviceOn(app, "terminal:access")
      const terminals: Access = ask ? await (ask(dir) as Promise<Access>).catch((e: Error) => ({ ok: null, why: e.message })) : { ok: null, why: "the terminal is off" }
      const mac = inDesktop() ? (await desktopCall("app:permissions", [], 15_000)) as PermissionReport["mac"] : null
      return { vault: { path: dir, app: own, terminals }, mac }
    },
    text: (r: PermissionReport) => [
      `Vault folder (${r.vault.path}):`,
      `- the app ${line(r.vault.app)}`,
      `- its terminals ${line(r.vault.terminals)}`,
      "",
      ...(r.mac ? [
        `${signingText(r.mac.signing)}${keepsPermissions(r.mac.signing) ? "" : " (build it with a Developer ID or Apple Development identity)"}.`,
        "",
        ...r.mac.permissions.map((p) => `- ${p.name}: ${STATE_TEXT[p.state]} (${p.use})`),
        "",
        "The user changes these in Vaultite's Settings > Permissions, or System Settings > Privacy & Security.",
      ] : ["macOS's privacy permissions are read by the desktop app on a Mac: run this in its terminals."]),
    ].join("\n"),
  }]
}
