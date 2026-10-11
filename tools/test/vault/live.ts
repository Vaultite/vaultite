import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, vault, write } = $
  // Live updates (core/live.ts): changes on disk reach the index and the listeners, coalesced, without a request.
  const { Live, ignored } = await import("../../../core/live.ts")
  const live = new Live(vault).start()
  const heard: Any[] = []
  live.listen((c) => heard.push(c))
  const wait = async (ok: () => boolean, ms = 3000) => {
    for (const t = Date.now(); Date.now() - t < ms && !ok();) await new Promise((r) => setTimeout(r, 25))
    return ok()
  }
  await new Promise((r) => setTimeout(r, 300)) // FSEvents starts a moment after the watch
  const touched = (p: string) => heard.some((c) => c.paths === null || c.paths.includes(p))
  write("Notes/Live one.md", "---\ntype: note\ntitle: Live one\n---\n\nFrom disk.\n")
  check("live: a file written on disk is heard", await wait(() => touched("Notes/Live one.md")), heard)
  check("live: and indexed before the event goes out", vault.entries.has("Notes/Live one.md"))
  heard.length = 0
  for (let i = 0; i < 20; i++) write(`Notes/Burst ${i}.md`, `burst ${i}\n`)
  await wait(() => touched("Notes/Burst 19.md"))
  await new Promise((r) => setTimeout(r, 300))
  check("live: a burst of writes is one or two events", heard.length >= 1 && heard.length <= 2, heard.length)
  heard.length = 0
  fs.renameSync(path.join(VAULT, "Notes/Live one.md"), path.join(VAULT, "Notes/Live two.md"))
  check("live: a rename is heard as both names", await wait(() => touched("Notes/Live one.md") && touched("Notes/Live two.md")), heard)
  check("live: and the index follows it", vault.entries.has("Notes/Live two.md") && !vault.entries.has("Notes/Live one.md"))
  heard.length = 0
  await api("PUT", "file", { path: "Notes/Live two.md", text: "From the app.\n", base: read("Notes/Live two.md") })
  check("live: the app's own writes are heard too", await wait(() => touched("Notes/Live two.md")), heard)
  check("live: .git, .DS_Store, iCloud placeholders and temp files are ignored",
    ignored(".git/index") && ignored("Notes/.DS_Store") && ignored("Notes/.a.md.icloud") && ignored("Notes/a.md.tmp-1-2") &&
    ignored(".vaultite/artifacts/x.html.json") && !ignored(".vaultite/cache/github.json") && !ignored("Notes/a.md"))
  // The user's window: a command it couldn't run says so; a window from before answers is sent it and not waited on.
  {
    const win = (answers: boolean, ran: boolean | null) => {
      const on: Record<string, (d: unknown) => void> = {}
      const ws: Any = { readyState: 1, OPEN: 1, close() {}, on: (k: string, f: (d: unknown) => void) => { on[k] = f }, sent: [] as Any[],
        send(t: string) {
          const m = JSON.parse(t); ws.sent.push(m)
          if (m.rid && ran !== null) setTimeout(() => on.message(JSON.stringify({ type: "ui-done", rid: m.rid, ran })), 5)
        } }
      live.client(ws)
      on.message(JSON.stringify({ type: "active", ...(answers ? { answers: true } : {}) }))
      return ws
    }
    win(true, false)
    const refused = await live.drive({ action: "command", id: "dispatch:claude" }).then(() => null, (e: Any) => e)
    check("ui: a command the window couldn't run is an error saying so", refused?.status === 422 && /isn't available/.test(refused.message), refused)
    win(true, true)
    check("ui: one it ran is sent", ((await live.drive({ action: "command", id: "theme:dark" })) as Any)?.ok === true)
    const old = win(false, null), t0 = Date.now()
    await live.drive({ action: "command", id: "theme:dark" })
    check("ui: a window that never answers isn't waited on", Date.now() - t0 < 500 && old.sent.at(-1)?.id === "theme:dark" && !old.sent.at(-1)?.rid)
  }
  live.close()
  Object.assign($.vars, { Live })
}
