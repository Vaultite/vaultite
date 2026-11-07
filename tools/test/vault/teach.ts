import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check } = $
  // Teach by showing on the server (companion.teach): a lesson the desktop app sends made a draft tour or skill, a
  // name taken getting the next, a preview writing nothing, and a skill's SKILL.md played as a tour (companion.tour).
  await import("../../../plugins/core/companion/plugin.ts")
  const asApp = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" } } as unknown as IncomingMessage
  const t0 = new Date(2026, 10, 6, 23, 0, 0).getTime(), win = { x: 0, y: 0, width: 1000, height: 800 }
  const el = (role: string, label: string, x: number, y: number) => ({ role, label, frame: { x, y, width: 80, height: 24 }, inside: [{ role: "group", label: "Toolbar" }] })
  const acts = [
    { t: t0, kind: "app", app: "com.example.notes", name: "Example Notes" },
    { t: t0 + 100, kind: "said", text: "watch me share a note" },
    { t: t0 + 1000, kind: "said", text: "I open the share menu" },
    { t: t0 + 2000, kind: "click", x: 900, y: 100, el: el("button", "Share", 860, 90), window: win },
    { t: t0 + 4000, kind: "click", x: 300, y: 300, el: el("textbox", "Email", 260, 290), window: win },
    { t: t0 + 5000, kind: "field", el: el("textbox", "Email", 260, 290), value: "alice.park@example.com", window: win },
    { t: t0 + 6000, kind: "key", key: "enter" },
    { t: t0 + 7000, kind: "said", text: "that's it" },
  ]
  const teach = (body: Any) => api("POST", "ops/companion.teach", body, asApp)
  const read = (p: string) => { try { return fs.readFileSync(path.join(VAULT, p), "utf8") } catch { return "" } }

  const [st, r] = await teach({ acts, about: "share a note", as: "tour" })
  const tour = read("Guides/Share a note.md")
  check("teach: a lesson made a draft tour in Guides/, their words its steps, each thing a mark and what it does",
    st === 200 && r.path === "Guides/Share a note.md" && r.as === "tour" && r.steps === 2 && /^status: draft$/m.test(tour) && /^type: tour$/m.test(tour) && /^app: com\.example\.notes$/m.test(tour) &&
    tour.includes(`1. Open the share menu. [ring "Share"] (do: click "Share")`) && tour.includes(`(do: type "alice.park@example.com" in "Email"; press enter)`) && /say "play Share a note"/.test(r.said), { st, r, tour })
  const [, r2] = await teach({ acts, about: "share a note", as: "tour" })
  check("teach: a title taken, the next one", r2.path === "Guides/Share a note 2.md" && /^1\. /m.test(read("Guides/Share a note 2.md")), r2)
  const [, s] = await teach({ acts, about: "share a note", as: "skill" })
  const skill = read(".agents/skills/share-a-note/SKILL.md")
  check("teach: or a draft skill agents find, run as a tour in do mode", s.path === ".agents/skills/share-a-note/SKILL.md" && /^name: share-a-note$/m.test(skill) && /^status: draft$/m.test(skill) &&
    skill.includes("vau companion tour .agents/skills/share-a-note/SKILL.md --mode do") && skill.includes("## Steps") && /say "run Share a note"/.test(s.said), { s, skill })
  const [, pv] = await teach({ acts, about: "send a note", preview: true })
  check("teach: a preview writes nothing", pv.preview === true && pv.text.includes("## Steps") && !read(".agents/skills/send-a-note/SKILL.md") && pv.as === "skill", pv)
  const [st4, none] = await teach({ acts: [{ t: t0, kind: "click", x: 1, y: 1 }] })
  check("teach: nothing done on a thing with a name: said so", st4 === 409 && /no click, typing or shortcut on a thing with a name \(1 on things with no name\)/.test(none.error ?? JSON.stringify(none)), none)
  const [st5, played] = await api("POST", "ops/companion.tour", { path: ".agents/skills/share-a-note" }, asApp)
  check("tour: a skill's SKILL.md plays as a tour (here, no screen to play on)", st5 === 409 && /no screen to play on/.test(played.error ?? JSON.stringify(played)), [st5, played])
  const [st6, byTitle] = await api("POST", "ops/companion.tour", { path: "Share a note 2" }, asApp)
  const [st7, skillByTitle] = await api("POST", "ops/companion.tour", { path: "share a note" }, asApp)
  check("tour: found by its title too, a skill's as well", st6 === 409 && st7 === 409 && /no screen/.test(byTitle.error) && /no screen/.test(skillByTitle.error), [byTitle, skillByTitle])
  fs.rmSync(path.join(VAULT, "Guides/Share a note.md"), { force: true })
  const [st8, skillOnly] = await api("POST", "ops/companion.tour", { path: "Share a note" }, asApp)
  check("tour: a skill by its title when no tour has it", st8 === 409 && /no screen/.test(skillOnly.error), skillOnly)
  for (const p of ["Guides/Share a note.md", "Guides/Share a note 2.md"]) fs.rmSync(path.join(VAULT, p), { force: true })
  fs.rmSync(path.join(VAULT, ".agents/skills/share-a-note"), { recursive: true, force: true })
}
