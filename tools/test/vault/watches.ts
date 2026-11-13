import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, exists, read, write } = $
  // Watches (plugins/core/watches): files of type watch, checked by the server; a change with what it waits for is a hit.
  const w = await import("../../../plugins/core/watches/plugin.ts")
  check("watches: a source by its kind, or a path or an address alone", w.parseSource("terminal:claude-k3")?.kind === "terminal" && w.parseSource("https://a.com/x")?.kind === "site" &&
    w.parseSource("Notes/A.md")?.ref === "Notes/A.md" && w.parseSource("nonsense") === null)
  check("watches: live, or a number and a unit", w.periodOf("live") === 0 && w.periodOf("") === 0 && w.periodOf("5m") === 300_000 && w.periodOf("2h") === 7_200_000 && w.periodOf("soon") === null)
  check("watches: what it waits for, as words in any case or a /regular expression/", w.happened("Shipped", "status: shipped") && !w.happened("Shipped", "packing") &&
    w.happened("/order \\d+ ready/i", "Order 12 READY") && w.happened("", "anything"))
  const term = (text: string, state?: string) => ({ kind: "terminal" as const, title: "t", text, ...(state ? { state } : {}) })
  check("watches: a terminal's change is its new output, its agent's state", JSON.stringify(w.changes(term("$ make\nok\n$ "), term("$ make\nok\n$ ls\na.md\n$ "))) === JSON.stringify(["  $ ls", "  a.md", "  $"]) &&
    w.changes(term("x", "working"), term("x", "idle"))[0] === "its state: idle")
  const page = (text: string, url = "https://a.com") => ({ kind: "site" as const, title: "A", url, text })
  check("watches: a page's change is its lines gone and new, a navigation where it went", JSON.stringify(w.changes(page("a\nb"), page("a\nc"))) === JSON.stringify(["- b", "+ c"]) &&
    w.changes(page("a"), page("a", "https://a.com/2"))[0].startsWith("went to https://a.com/2"))

  {
    const { read: readSource } = await import("../../../plugins/core/watches/sources.ts")
    const wasDesktop = w.plugin.desktop, asked: Any[] = []
    w.plugin.desktop = async (name: string, ...args: Any[]) => {
      asked.push(name)
      if (name === "agent:tabs") return [{ tab: 4, pane: "p4", url: "https://shop.example.com/order", title: "Order", container: null, access: "read" }]
      if (name === "agent:open") return { tab: 9, url: String(args[0]), title: "Opened" }
      if (name === "agent:read") return { url: args[0] === 4 ? "https://shop.example.com/order" : "https://other.example.com/", title: args[0] === 4 ? "Order" : "", text: `page ${args[0]}` }
      if (name === "agent:selection") return { selection: "  Shipped  " }
      if (name === "agent:close") return null
      throw new Error("no such call")
    }
    const ctx = { panes: () => [], private: () => false }
    try {
      const shown = await readSource(w.plugin, { kind: "site", ref: "https://shop.example.com/order" }, ctx, { pane: "p4" })
      const opened = await readSource(w.plugin, { kind: "site", ref: "https://other.example.com/" }, ctx)
      check("watches: a site's tab read where it's open, with its selection; else opened, read, closed, titled by its host",
        JSON.stringify(shown) === JSON.stringify({ kind: "site", title: "Order", url: "https://shop.example.com/order", text: "page 4", selection: "Shipped" }) &&
        JSON.stringify(opened) === JSON.stringify({ kind: "site", title: "other.example.com", url: "https://other.example.com/", text: "page 9" }) &&
        asked.join() === "agent:tabs,agent:read,agent:selection,agent:tabs,agent:open,agent:read,agent:close", [shown, opened, asked])
    } finally { w.plugin.desktop = wasDesktop }
  }

  write("Notes/Order.md", "Status: packing\n")
  let [st, r] = await api("POST", "ops/watches.add", { source: "Notes/Order.md", until: "shipped", why: "Tell me when it ships" })
  check("watches: one added is a file in Watches/", st === 200 && exists("Watches/Watch Order.md") && /type: watch/.test(read("Watches/Watch Order.md")) && read("Watches/Watch Order.md").includes("Tell me when it ships"), [st, r])
  const item = () => w.watches().find((x) => x.title === "Watch Order")!
  check("watches: the first look is where it starts from", (await w.check(item())) === null)
  write("Notes/Order.md", "Status: packed\n")
  check("watches: a change without what it waits for wakes no one", (await w.check(item())) === null)
  check("watches: no change, no hit", (await w.check(item())) === null)
  write("Notes/Order.md", "Status: shipped\n")
  const hit = await w.check(item())
  check("watches: what it waited for is a hit, with what changed, and it ends", !!hit && hit.done && hit.changes.includes("+ Status: shipped") && hit.why === "Tell me when it ships", hit)
  ;[, r] = await api("POST", "ops/watches.list", {})
  check("watches: listed as done", r.find((x: Any) => x.title === "Watch Order")?.state === "done", r)
  ;[st] = await api("POST", "ops/watches.pause", { id: "Watch Order" })
  check("watches: paused in its file", st === 200 && /status: paused/.test(read("Watches/Watch Order.md")))
  await api("PATCH", "config/folders", { watches: "Inbox/Watches" })
  ;[st, r] = await api("POST", "ops/watches.add", { source: "site:https://example.com/order", every: "30m", title: "Order page" })
  check("watches: new ones go to their kind's folder", st === 200 && exists("Inbox/Watches/Order page.md"), [st, r])
  check("watches: a cadence it can't read is refused", (await api("POST", "ops/watches.add", { source: "Notes/Order.md", every: "often" }))[0] === 400)
  for (const id of ["Watch Order", "Order page"]) await api("POST", "ops/watches.remove", { id })
  check("watches: removed, its file goes", !exists("Watches/Watch Order.md") && !exists("Inbox/Watches/Order page.md"))
  await api("PATCH", "config/folders", { watches: null })
  {
    // Its own folder setting was the kind's folder's twin: moved to folders.json (core/migrations.ts).
    const { DONE, migrate } = await import("../../../core/migrations.ts")
    $.vault.patchConfig("plugins/watches/data", { folder: "Inbox/Watches" })
    $.vault.patchConfig("migrations", { done: DONE.filter((d) => d !== "watches-folder-2026-11") })
    await migrate($.vault, false)
    check("watches: a vault's folder setting becomes its kind's folder", $.vault.readConfig("folders")?.watches === "Inbox/Watches" && !("folder" in ($.vault.readConfig("plugins/watches/data") ?? {})),
      [$.vault.readConfig("folders"), $.vault.readConfig("plugins/watches/data")])
    $.vault.patchConfig("folders", { watches: null })
  }
}
