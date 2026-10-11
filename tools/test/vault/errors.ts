import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, tmp, write } = $
  // ---------- Errors (plugins/core/errors): the app's and the server's, grouped by kind, kept on this machine ----------
  {
  write(".vaultite/plugins/errors/data.json", JSON.stringify({ notify: false })) // (a toast would be an inbox event, which the Inbox's tests count)
  const { errorOf } = await import("../../../core/serverlog.ts")
  const logged = errorOf(["terminal: couldn't start:", new Error("posix_spawnp failed.")])
  check("errors: console.error's words and its error's message are one line, with the stack", logged.message === "terminal: couldn't start: posix_spawnp failed." && !!logged.stack?.includes("test_vault"), logged)
  const stack = "TypeError: x is undefined\n    at Card (http://h:8793/assets/index-AbC123xY.js:10:5)"
  await api("POST", "errors", { device: "phone", errors: [
    { t: Date.now() - 2000, kind: "stopped", fatal: true, message: "TypeError: x is undefined", stack, url: "/#/a", build: "index-AbC123xY.js", trail: ["Ran Open graph"] },
    { t: Date.now() - 1000, kind: "stopped", fatal: true, message: "TypeError: x is undefined", stack: stack.replace("AbC123xY.js:10:5", "ZzZ999qq.js:11:7") },
    { kind: "boundary", message: "Timed out after 300 ms" }, { kind: "boundary", message: "Timed out after 4000 ms" }, { kind: "boundary", message: "" }] })
  let [, errs] = await api("GET", "errors?source=app")
  const stopped = errs.groups.find((g: Any) => g.kind === "stopped"), timeout = errs.groups.find((g: Any) => g.message.startsWith("Timed out"))
  check("errors: the same error from two builds is one kind, counted; numbers don't split a kind", errs.groups.length === 2 && stopped?.count === 2 && stopped.fatal === 2 && timeout?.count === 2 && stopped.devices[0] === "phone", errs)
  const [, one] = await api("GET", `errors/${stopped.id.slice(0, 6)}`)
  check("errors: one kind by its id's start, with each time (trail, build)", one.group.id === stopped.id && one.events.length === 2 && one.events.some((e: Any) => e.trail?.[0] === "Ran Open graph" && e.build === "index-AbC123xY.js"), one)
  app.serverError({ t: Date.now(), message: "calendar: feed failed: ENOTFOUND", stack: "Error: ENOTFOUND\n    at x (y.ts:1:2)", where: "GET /api/calendar" })
  ;[, errs] = await api("GET", "errors?source=server")
  check("errors: the server's, with the request it was in", errs.groups.length === 1 && errs.groups[0].latest.where === "GET /api/calendar", errs)
  const [, listText] = await api("POST", "ops/errors.list?as=text", {})
  check("errors: vau errors lists each kind", typeof listText === "string" && listText.includes("calendar: feed failed") && listText.includes("TypeError: x is undefined"), listText)
  write("Errs/page.md", "```block-errors\nsource: server\n```\n")
  const [, errText] = await api("GET", "render?path=Errs/page.md")
  check("errors: its block as text", errText.includes("calendar: feed failed") && !errText.includes("TypeError"), errText)
  await api("DELETE", `errors/${stopped.id}`)
  ;[, errs] = await api("GET", "errors")
  check("errors: forgetting one kind leaves the rest", !errs.groups.some((g: Any) => g.id === stopped.id) && errs.groups.length === 2, errs)
  check("errors: kept outside the vault", fs.readdirSync(path.join(tmp, "local", "errors")).length === 1 && !fs.existsSync(path.join(VAULT, "errors")))
  await api("DELETE", "errors")
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/errors/data.json"))
  }
}
