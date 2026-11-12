import path from "node:path"
import { check, section } from "../lib.ts"

// ---------- Browser: your passwords, the user's own KeePass file (electron/browser/kdbxedit.ts) ----------
// A made-up main file with a KeeShare-exported Agents group, as KeePassXC writes it; never a real one.
await section("your passwords", async () => {
  const kp = await import("../../../electron/browser/keepass.ts")
  const ed = await import("../../../electron/browser/kdbxedit.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
  const MAIN = "made-up main password", SHARE = "made-up share password"
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN)), "Main")
  const agents = db.createGroup(db.getDefaultGroup(), "Agents")
  const b64 = (s: string) => Buffer.from(s).toString("base64")
  const ref = `<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64(SHARE)}</Password><KeepGroups>True</KeepGroups></KeeShare>`
  agents.customData = new Map([["KeeShare/Reference", { value: b64(ref) }]])
  const bank = db.createEntry(db.getDefaultGroup())
  bank.fields.set("Title", "Bank"); bank.fields.set("UserName", "alice"); bank.fields.set("Password", ProtectedValue.fromString("bank-pw"))
  db.createGroup(agents, "Projects")
  let file = new Uint8Array(await db.save())

  let main = await kp.loadKdbx(file, MAIN)
  const shares = ed.sharesOf(main, path.resolve("/made/up/Main.kdbx"))
  check("your passwords: KeePassXC's KeeShare export is found, its path against the file's folder", shares.length === 1 && shares[0].path === path.resolve("/made/up/agents.kdbx") && shares[0].password === SHARE && shares[0].keepGroups, shares.map((s) => s.path))
  const agentsId = shares[0].group, projects = ed.listOf(main, "/f").groups.find((g) => g.name === "Projects")!.id
  const id = ed.applyChange(main, { group: agentsId, title: "Lighthouse", username: "alice", password: "pw-1", urls: ["https://lighthouse.example.com", "https://auth.lighthouse.example.com"], tags: ["agent-free"], notes: "n" })
  const inSub = ed.applyChange(main, { group: projects, title: "Harbor", username: "bob", password: "pw-h", urls: ["harbor.example.org"], tags: [], notes: "" })
  file = new Uint8Array(await main.save())
  main = await kp.loadKdbx(file, MAIN)
  const list = ed.listOf(main, "/f")
  const light = list.entries.find((e) => e.id === id)!
  check("your passwords: a new entry keeps its addresses, tags and group", light.urls.length === 2 && light.free && light.group === agentsId && light.shared, light)
  check("your passwords: entries in the exported group (and its subgroups) are for agents, others aren't", list.entries.find((e) => e.id === inSub)!.shared && !list.entries.find((e) => e.title === "Bank")!.shared)
  check("your passwords: the list has no secret", !JSON.stringify(list).includes("pw-1") && !JSON.stringify(list).includes("bank-pw"))
  ed.applyChange(main, { id, title: "Lighthouse", username: "alice", password: "pw-2", urls: ["https://lighthouse.example.com"], tags: [], notes: "n" })
  const full = ed.fullOf(main, "/f", id)!
  const entry = ed.entryById(main, id)!
  check("your passwords: an edit changes it and keeps the old one in its history", full.password === "pw-2" && !full.free && full.urls.length === 1 && entry.history.length === 1 && kp.fieldsOf(entry.history[0]).Password === "pw-1")

  const out = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  const ids = out.entries.map((e) => e.id).sort().join()
  check("your passwords: the export is what agents read, with the same entry ids, subgroups too", ids === [id, inSub].sort().join() && out.secrets(id)?.password === "pw-2", out.entries.map((e) => e.title))
  check("your passwords: nothing outside the exported group reaches agents", !out.entries.some((e) => e.title === "Bank"))

  ed.removeEntry(main, inSub)
  const binned = ed.listOf(main, "/f")
  check("your passwords: deleting goes to the recycle bin first", binned.groups.find((g) => g.id === binned.entries.find((e) => e.id === inSub)?.group)?.bin === true)
  ed.removeEntry(main, inSub)
  check("your passwords: deleting from the bin removes it", !ed.listOf(main, "/f").entries.some((e) => e.id === inSub))
  const after = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  check("your passwords: a deleted entry leaves the export", !after.entries.some((e) => e.id === inSub))
})

// ---------- Browser: the Passwords page's generator (plugins/core/web-viewer/generate.ts) ----------
await section("password generator", async () => {
  const { generatePassword, GEN_DEFAULTS } = await import("../../../plugins/core/web-viewer/generate.ts")
  const many = Array.from({ length: 200 }, () => generatePassword(GEN_DEFAULTS))
  check("password generator: 20 characters by default, each with a letter, a digit and a symbol",
    many.every((p) => p.length === 20 && /[a-z]/i.test(p) && /\d/.test(p) && /[^a-z\d]/i.test(p)), many.slice(0, 3))
  check("password generator: no two alike", new Set(many).size === many.length)
  const digits = generatePassword({ length: 12, letters: false, digits: true, symbols: false })
  check("password generator: only the kinds asked for", /^\d{12}$/.test(digits), digits)
  check("password generator: the length kept within 8 to 64", generatePassword({ ...GEN_DEFAULTS, length: 3 }).length === 8 && generatePassword({ ...GEN_DEFAULTS, length: 500 }).length === 64)
  check("password generator: none asked for is letters", /^[a-z]+$/i.test(generatePassword({ length: 10, letters: false, digits: false, symbols: false })))
  // (a draw past the last whole multiple of the alphabet is thrown away: 10 digits, 2^32 - 1 is past it)
  const draws = [0xffff_ffff, 7, 0xffff_ffff, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
  const fixed = generatePassword({ length: 8, letters: false, digits: true, symbols: false }, (a) => { a[0] = draws.shift()! })
  check("password generator: unbiased, a draw past the last whole multiple is drawn again", fixed === "73123456", fixed)
  const counts = new Map<string, number>()
  for (let i = 0; i < 400; i++) for (const c of generatePassword({ length: 64, letters: false, digits: true, symbols: false })) counts.set(c, (counts.get(c) ?? 0) + 1)
  const n = [...counts.values()]
  check("password generator: every digit about as often", counts.size === 10 && Math.min(...n) / Math.max(...n) > 0.85, Object.fromEntries(counts))
})

// ---------- Browser: a login sealed for another Mac's app (electron/browser/sealed.ts) ----------
await section("sealed logins", async () => {
  const sl = await import("../../../electron/browser/sealed.ts")
  const m1 = sl.newKeys(), m4 = sl.newKeys()
  const login = { names: ["example.com"], cookies: [{ name: "session", value: "s3cret", domain: ".example.com", path: "/" }], at: 1 }
  const box = sl.seal(m1.pub, login, "vaultite login for c-agents")
  check("sealed: what the servers pass on holds no cookie", !box.includes("s3cret") && !box.includes("session"))
  const opened = sl.open(m1, box, "vaultite login for c-agents")
  check("sealed: the app it's for opens it as it was", JSON.stringify(opened.data) === JSON.stringify(login) && opened.from.length > 20, opened)
  const fails = (f: () => unknown) => { try { f(); return false } catch { return true } }
  check("sealed: another app's key doesn't open it", fails(() => sl.open(m4, box, "vaultite login for c-agents")))
  check("sealed: it doesn't open for another set of logins", fails(() => sl.open(m1, box, "vaultite login for c-work")))
  const b = JSON.parse(box), ct = Buffer.from(b.ct, "base64url")
  ct[0] ^= 1
  check("sealed: a box changed on the way doesn't open", fails(() => sl.open(m1, JSON.stringify({ ...b, ct: ct.toString("base64url") }), "vaultite login for c-agents")))
  check("sealed: each box has a key of its own", JSON.parse(sl.seal(m1.pub, login, "x")).from !== b.from)
  check("sealed: what isn't a box, or a key, is refused", fails(() => sl.open(m1, "{}", "x")) && fails(() => sl.open(m1, "not json", "x")) && fails(() => sl.seal("nope", login, "x")))
})
