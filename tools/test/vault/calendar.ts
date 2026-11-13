import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, app, check } = $
  const server = http.createServer((req, res) => {
    res.writeHead(req.url?.includes("garbled") ? 200 : 403)
    res.end(req.url?.includes("garbled") ? "BEGIN:VCALENDAR\nnot ical TOKEN-IN-BODY" : "TOKEN-IN-BODY")
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const at = server.address(), port = at instanceof Object ? at.port : 0
  const file = path.join(process.env.VAULTITE_LOCAL ?? "", "config.json"), had = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}"
  const config = JSON.parse(had)
  config.calendars = [
    { name: "Denied", ics: `http://127.0.0.1:${port}/private/SECRET-ICS-TOKEN-1/basic.ics` },
    { name: "Garbled", ics: `http://127.0.0.1:${port}/garbled/SECRET-ICS-TOKEN-2/basic.ics` },
    { name: "Gone", ics: "http://127.0.0.1:1/SECRET-ICS-TOKEN-3/basic.ics" },
  ]
  fs.writeFileSync(file, JSON.stringify(config))
  const { plugin } = await import("../../../plugins/core/calendar/plugin.ts")
  plugin.forget()
  const [, got] = await api("GET", "calendar?from=2026-10-05")
  const op = await app.callOp("calendar.events", { from: "2026-10-05" })
  const said = JSON.stringify([got, op])
  check("calendar: a calendar that fails says which, never its private address or what its server sent",
    got.errors.length === 3 && got.errors.every((e: string) => /^(Denied|Garbled|Gone): /.test(e)) && !/SECRET-ICS-TOKEN|TOKEN-IN-BODY/.test(said), said)
  fs.writeFileSync(file, had)
  plugin.forget()
  server.close()
}
