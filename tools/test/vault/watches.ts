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
  await api("PATCH", "config/plugin/watches", { folder: "Inbox/Watches" })
  ;[st, r] = await api("POST", "ops/watches.add", { source: "site:https://example.com/order", every: "30m", title: "Order page" })
  check("watches: new ones go to the folder of the setting", st === 200 && exists("Inbox/Watches/Order page.md"), [st, r])
  check("watches: a cadence it can't read is refused", (await api("POST", "ops/watches.add", { source: "Notes/Order.md", every: "often" }))[0] === 400)
  for (const id of ["Watch Order", "Order page"]) await api("POST", "ops/watches.remove", { id })
  check("watches: removed, its file goes", !exists("Watches/Watch Order.md") && !exists("Inbox/Watches/Order page.md"))
  await api("PATCH", "config/plugin/watches", { folder: null })
}
