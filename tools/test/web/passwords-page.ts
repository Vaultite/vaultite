// What the Passwords page goes by: strength, the generator, health, history, moves and groups (electron/browser/kdbx*.ts)
import { check, section } from "../lib.ts"
import type { Generate } from "../../../electron/browser/generate.ts"
import type { Change } from "../../../electron/browser/passwordswire.ts"
import type { Row } from "../../../plugins/core/web-viewer/passwords/types.ts"

const { bitsOf, EFF_WORDS } = await import("../../../electron/browser/strength.ts")
const { GENERATE, generatePassphrase, generatePassword } = await import("../../../electron/browser/generate.ts")
const { levelOf } = await import("../../../plugins/core/web-viewer/passwords/levels.ts")
const ed = await import("../../../electron/browser/kdbxedit.ts")
const { healthOf, hashesOf, leaked, setExcluded } = await import("../../../electron/browser/kdbxhealth.ts")
const { passwordAt, restoreVersion, versionOf } = await import("../../../electron/browser/kdbxhistory.ts")
const { fieldsOf, loadKdbx } = await import("../../../electron/browser/keepass.ts")
const { Credentials, Kdbx, KdbxUuid, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
const levelIn = (p: string) => levelOf(bitsOf(p))

await section("password strength", () => {
  check("strength: nothing typed is no bits", bitsOf("") === 0)
  const poor = ["12345", "password", "Alice1990", "qwertyuiop", "aaaaaaaaaaaaaaaaaaaaaaaa", "Winter2025", "lighthouse", "meucachorro"]
  check("strength: what people pick is poor", poor.every((p) => levelIn(p) === "poor"), poor.map((p) => [p, Math.round(bitsOf(p))]))
  check("strength: 8 random characters are weak, 14 good, 20 excellent", levelIn("x7Kp2mQ9") === "weak" && levelIn("vN4#kq9!Zt2w_L") === "good" && levelIn("R8v!wq2Zp@x5mK9t$Lh3") === "excellent")
  check("strength: words joined are worth their words, not their letters", bitsOf("harbor-lights-42") < 50 && bitsOf("harborlights") < 40, [bitsOf("harbor-lights-42"), bitsOf("harborlights")])
  const six = bitsOf("pauper-exes-tint-bogged-rifling-trade")
  check("strength: a passphrase is what drawing its words is worth", Math.abs(six - 6 * Math.log2(7776)) < 0.01 && levelOf(six) === "good", six)
  const t0 = performance.now()
  bitsOf("kD8#mz!2Lp9$Xw5@".repeat(200))
  check("strength: a key kept as a password doesn't hang it", performance.now() - t0 < 500, performance.now() - t0)
})

await section("password generator", () => {
  type Asked = Partial<Record<keyof Generate, string | number | boolean>>
  const made = (o: Asked) => generatePassword(GENERATE.parse(o)), many = Array.from({ length: 200 }, () => made({}))
  check("password generator: 20 characters by default, each with every kind", many.every((p) => p.length === 20 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^a-z\d]/i.test(p)), many.slice(0, 3))
  check("password generator: no two alike", new Set(many).size === many.length)
  const only = { upper: false, lower: false, digits: true, symbols: false }
  check("password generator: only the kinds asked for", /^\d{12}$/.test(made({ ...only, length: 12 })))
  check("password generator: the length kept within 8 to 64, nonsense the default", made({ length: 3 }).length === 8 && made({ length: 500 }).length === 64 && made({ length: "x", kind: 7 }).length === 20)
  check("password generator: none asked for is letters", /^[a-z]+$/.test(made({ ...only, digits: false })))
  check("password generator: look-alikes left out", Array.from({ length: 100 }, () => made({ clear: true, length: 64 })).every((p) => !/[0Oo1Il|5S2Z8B]/.test(p)))
  const draws = [0xffff_ffff, 7, 0xffff_ffff, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
  const fixed = generatePassword(GENERATE.parse({ ...only, length: 8 }), (a) => { a[0] = draws.shift()! })
  check("password generator: unbiased, a draw past the last whole multiple is drawn again", fixed === "73123456", fixed)
  const counts = new Map<string, number>()
  for (let i = 0; i < 400; i++) for (const c of made({ ...only, length: 64 })) counts.set(c, (counts.get(c) ?? 0) + 1)
  const n = [...counts.values()]
  check("password generator: every digit about as often", counts.size === 10 && Math.min(...n) / Math.max(...n) > 0.85, Object.fromEntries(counts))
  check("passphrase: the EFF's large list", EFF_WORDS.length === 7776 && new Set(EFF_WORDS).size === 7776 && ["abacus", "lantern", "zoom"].every((w) => EFF_WORDS.includes(w)))
  const phrase = (o: Asked) => generatePassphrase(GENERATE.parse({ kind: "passphrase", ...o }), EFF_WORDS)
  const seven = phrase({ words: 7, separator: " " }).split(" ")
  check("passphrase: as many words as asked, all from the list", seven.length === 7 && seven.every((w) => EFF_WORDS.includes(w)), seven)
  check("passphrase: capitals and a digit", /^([A-Z][a-z]+\d?\.){5}[A-Z][a-z]+\d?$/.test(phrase({ separator: ".", capitals: true, number: true })) && (phrase({ number: true }).match(/\d/g) ?? []).length === 1)
})

const DAY = 86_400_000, MAIN = "made-up main password"
function made() {
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN)), "Main"), root = db.getDefaultGroup().uuid.id
  const save = (title: string, password: string, more: Partial<Change> = {}) => ed.applyChange(db, { title, username: "alice", password, urls: [], tags: [], notes: "", group: root, ...more })
  return { db, root, save }
}

await section("passwords: health", async () => {
  const { db, save } = made()
  const a = save("Bank", "harbor-lights-42"), b = save("Shop", "harbor-lights-42"), c = save("Lighthouse", "R8v!wq2Zp@x5mK9t$Lh3"), d = save("Nothing", ""), e = save("Alias", "{REF:P@I:0}"), f = save("Binned", "harbor-lights-42")
  ed.removeEntry(db, f)
  const of = () => new Map(healthOf(db, bitsOf).map((h) => [h.id, h]))
  const h = of()
  check("health: the recycle bin's left out", h.size === 5 && !h.has(f))
  check("health: entries sharing a password share a mark, others have none", !!h.get(a)?.same && h.get(a)?.same === h.get(b)?.same && h.get(c)?.same === null)
  check("health: no password, or a reference to another's, isn't judged", h.get(d)?.bits === null && h.get(e)?.bits === null && h.get(d)?.same === null)
  check("health: it carries no password", !/harbor|R8v/.test(JSON.stringify([...h.values()])))
  const entry = ed.entryById(db, c)!
  const at = (days: number) => new Date(Date.now() - days * DAY)
  entry.times.creationTime = at(2000); entry.times.lastModTime = at(2000)
  ed.applyChange(db, { id: c, title: "Lighthouse", username: "bob", password: "R8v!wq2Zp@x5mK9t$Lh3", urls: [], tags: [], notes: "" })
  check("health: an edit that keeps the password doesn't make it new", Math.abs((of().get(c)?.since ?? 0) - at(2000).getTime()) < DAY)
  ed.applyChange(db, { id: c, title: "Lighthouse", username: "bob", password: "new-1", urls: [], tags: [], notes: "" })
  check("health: … one that changes it does", Date.now() - (of().get(c)?.since ?? 0) < DAY)
  db.meta.historyMaxItems = 2
  const trimmed = save("Trimmed", "same-pw"), t = ed.entryById(db, trimmed)!
  t.times.creationTime = at(2000)
  for (let i = 0; i < 2; i++) ed.applyChange(db, { id: trimmed, title: "Trimmed", username: `u${i}`, password: "same-pw", urls: [], tags: [], notes: "" })
  check("health: its older versions trimmed, only what's kept is known of its age", Date.now() - (of().get(trimmed)?.since ?? 0) < DAY)
  setExcluded(db, a, true)
  const again = await loadKdbx(new Uint8Array(await db.save()), MAIN)
  check("health: left out of the report, in the file (KeePassXC's own flag)", healthOf(again, bitsOf).find((x) => x.id === a)?.excluded === true && healthOf(again, bitsOf).find((x) => x.id === b)?.excluded === false)
})

await section("passwords: known breaches", () => {
  const { db, save } = made(), id = save("Bank", "password")
  save("Other", "R8v!wq2Zp@x5mK9t$Lh3")
  const hashes = hashesOf(db)
  check("breaches: what's asked is 5 characters of each hash", hashes.size === 2 && [...hashes.keys()].every((k) => /^[0-9A-F]{5}$/.test(k)) && hashes.has("5BAA6"), [...hashes.keys()])
  const range = "0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:52256\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0"
  check("breaches: a password in the answer is told, with how often", JSON.stringify(leaked(hashes, "5BAA6", range)) === JSON.stringify([{ id, times: 52256 }]))
  let unasked = ""
  try { leaked(hashes, "00000", range) } catch (e) { unasked = String(e) }
  check("breaches: an answer it never asked for (a lock came between) isn't none found", /locked/.test(unasked))
  check("breaches: padding and other hashes aren't", !leaked(hashes, "5BAA6", range.replace("52256", "0")).length && !leaked(hashes, "5BAA6", "<html>").length)
})

await section("passwords: an entry's history", async () => {
  const { db, save } = made(), id = save("Bank", "pw-1", { notes: "first" })
  const then = (days: number) => { ed.entryById(db, id)!.times.lastModTime = new Date(Date.now() - days * DAY) }
  then(30)
  ed.applyChange(db, { id, title: "Bank", username: "alice", password: "pw-2", urls: ["https://bank.example.com"], tags: ["work"], notes: "first" })
  then(10)
  ed.applyChange(db, { id, title: "Bank", username: "bob", password: "pw-2", urls: ["https://bank.example.com"], tags: ["work"], notes: "" })
  const past = ed.fullOf(db, "/f", id)!.history
  check("history: newest first, each by what changed then", past.map((p) => p.changed.join()).join(" | ") === "username,notes | password,website,tags", past)
  check("history: an entry and its versions are read with no password", !/pw-[12]/.test(JSON.stringify([ed.fullOf(db, "/f", id), versionOf(db, id, past[1].at)])))
  check("history: a version's password, asked for", passwordAt(db, id, past[1].at) === "pw-1" && passwordAt(db, id, past[0].at) === "pw-2")
  restoreVersion(db, id, past[1].at)
  const back = await loadKdbx(new Uint8Array(await db.save()), MAIN), e = ed.entryById(back, id)!
  check("history: restored, as it was then, what it replaced kept", fieldsOf(e).Password === "pw-1" && fieldsOf(e).Notes === "first" && !e.tags.length && e.history.length === 3 && fieldsOf(e.history[2]).UserName === "bob")
  check("history: restored is a change of now", Date.now() - Number(e.times.lastModTime) < DAY)
  const old = e.history[0], other = new KdbxUuid("AAAAAAAAAAAAAAAAAAAAAQ==")
  old.uuid = other
  old.tags = ["agent-free", "home"]
  restoreVersion(back, id, Number(old.times.lastModTime))
  check("history: a version with another id (other apps write some) keeps the entry's own", ed.entryById(back, id) === e)
  check("history: … its tags are back, but not agents' leave to use it unasked", e.tags.join() === "home", e.tags)
  e.tags = ["agent-free"]
  restoreVersion(back, id, Number(old.times.lastModTime))
  check("history: … which stays as it is now", e.tags.join() === "home,agent-free", e.tags)
  let said = ""
  try { versionOf(back, id, 1) } catch (x) { said = String(x) }
  check("history: a version gone says so", /gone/.test(said))
})

await section("passwords: groups, moves and expiry", async () => {
  const { db, root, save } = made(), work = ed.saveGroup(db, { name: "Work" }), servers = ed.saveGroup(db, { name: "Servers", parent: work })
  const said = (fn: () => void) => { try { fn(); return "" } catch (e) { return String(e) } }
  const id = save("build-01", "pw", { group: servers }), groupOf = (x: string) => ed.listOf(db, "/f").entries.find((e) => e.id === x)?.group
  ed.saveGroup(db, { id: work, name: "Job" })
  check("groups: made, renamed, nested", ed.listOf(db, "/f").groups.find((g) => g.id === servers)?.parent === work && ed.listOf(db, "/f").groups.find((g) => g.id === work)?.name === "Job")
  ed.moveEntries(db, [{ id, group: work }])
  check("moves: to another group, with no version of its own", groupOf(id) === work && !ed.entryById(db, id)!.history.length)
  ed.removeEntry(db, id)
  const bin = db.meta.recycleBinUuid!.id
  check("moves: deleted is in the bin", groupOf(id) === bin)
  const fromOf = (d: typeof db) => ed.listOf(d, "/f").entries.find((e) => e.id === id)?.from, again = async () => loadKdbx(new Uint8Array(await db.save()), MAIN)
  check("moves: in the bin, it says where it came from", fromOf(db) === work)
  check("moves: … but not from a file whose format doesn't keep it (4.0), so it's never guessed", fromOf(await again()) === null)
  db.header.versionMinor = 1
  check("moves: … which 4.1 keeps", fromOf(await again()) === work)
  ed.moveEntries(db, [{ id, group: work }])
  check("moves: out of the bin, it came from nowhere", groupOf(id) === work && fromOf(db) === null)
  ed.removeEntry(db, id)
  db.move(db.getGroup(work)!, db.getGroup(bin))
  check("moves: its group in the bin too, there's nowhere to restore it to", fromOf(db) === null)
  check("deletes: what's in the bin already isn't erased by a delete that meant the bin", /already/.test(said(() => ed.removeEntry(db, id))) && groupOf(id) === bin)
  ed.moveEntries(db, [{ id, group: servers }])
  ed.removeEntry(db, id, true)
  check("moves: deleted for good from a group in the bin is gone", groupOf(id) === undefined && db.deletedObjects.some((x) => x.uuid?.equals(new KdbxUuid(id))))
  check("groups: only an empty one is deleted, never the top or the bin", /empty/.test(said(() => ed.removeGroup(db, work))) && /empty/.test(said(() => ed.removeGroup(db, root))) && /empty/.test(said(() => ed.removeGroup(db, bin))))
  ed.removeGroup(db, servers)
  check("groups: an empty one goes", !ed.listOf(db, "/f").groups.some((g) => g.id === servers))
  const kept = save("Kept", "pw")
  check("deletes: what isn't in the bin isn't erased by a delete that meant for good", /any more/.test(said(() => ed.removeEntry(db, kept, true))) && groupOf(kept) === root)
  db.meta.recycleBinEnabled = false
  check("deletes: with no recycle bin, only a delete that means for good does it", ed.listOf(db, "/f").recycles === false && /already/.test(said(() => ed.removeEntry(db, kept))) && groupOf(kept) === root)
  ed.removeEntry(db, kept, true)
  check("deletes: … and then it's gone", groupOf(kept) === undefined)
  const when = Date.now() - DAY, due = save("VPN", "pw", { expires: when }), row = () => ed.listOf(db, "/f").entries.find((e) => e.id === due)
  check("expiry: set", row()?.expired === true && row()?.expires === when)
  ed.applyChange(db, { id: due, title: "VPN", username: "", password: "pw", urls: [], tags: [], notes: "" })
  check("expiry: kept by an edit that doesn't say", row()?.expires === when)
  ed.applyChange(db, { id: due, title: "VPN", username: "", password: "pw", urls: [], tags: [], notes: "", expires: null })
  check("expiry: cleared", row()?.expires === null && row()?.expired === false)
})

await section("passwords page: the report, the tree, the order", async () => {
  const { reportOf } = await import("../../../plugins/core/web-viewer/passwords/report.ts")
  const { groupChoices, matches, treeOf, within } = await import("../../../plugins/core/web-viewer/passwords/tree.ts")
  const { sorted } = await import("../../../plugins/core/web-viewer/passwords/sort.ts")
  const now = Date.UTC(2026, 10, 25)
  const row = (id: string, more: Partial<Row> = {}): Row => ({ id, group: "r", title: id, username: "", urls: [], tags: [], free: false, shared: false, expired: false, otp: false, modified: 0, expires: null, from: null, ...more })
  const rows = [row("Bank", { expires: now + 10 * DAY }), row("Shop"), row("VPN", { expires: now - 3 * DAY, expired: true }), row("Pin"), row("Fine")]
  const health = new Map([["Bank", 30, "x", 0], ["Shop", 30, "x", 0], ["VPN", 110, null, 0], ["Pin", 5, null, 0], ["Fine", 130, null, 4 * 365.25]].map(([id, bits, same, age]) =>
    [String(id), { id: String(id), bits: Number(bits), same: same === null ? null : String(same), since: now - Number(age) * DAY, excluded: id === "Pin" }]))
  const r = reportOf(rows, health, new Map([["Shop", 12]]), now), ids = (k: keyof typeof r.issues) => r.issues[k].map((f) => `${f.row.id}: ${f.why}`).join(" | ")
  check("report: weak, and reused with whom", ids("weak") === "Bank: Poor, 30 bits | Shop: Poor, 30 bits" && ids("reused") === "Bank: Same as Shop | Shop: Same as Bank", [ids("weak"), ids("reused")])
  check("report: expired first, then what soon does", ids("expired") === "VPN: Expired 3 days ago | Bank: Expires in 10 days", ids("expired"))
  check("report: old, and in breaches once asked", ids("old") === "Fine: Not changed in 4 years" && ids("leaked") === "Shop: Seen 12 times in known breaches" && !reportOf(rows, health, null, now).issues.leaked.length)
  check("report: what's left out is apart, an entry counts once", r.left.map((e) => e.id).join() === "Pin" && r.total === 4)
  const g = (id: string, parent: string | null, more = {}) => ({ id, name: id, parent, share: null, bin: false, expanded: true, ...more })
  const groups = [g("r", null), g("Work", "r"), g("Servers", "Work"), g("Bin", "r", { bin: true }), g("InBin", "Bin", { bin: true }), g("Art", "r")]
  const t = treeOf(groups, [row("a", { group: "Servers" }), row("b", { group: "Work" }), row("c", { group: "InBin" })])
  check("tree: groups by name under their own, counting what's below, the bin apart", t.tree.map((b) => `${b.group.id}${b.depth}:${b.count}${b.parent ? "+" : ""}`).join() === "Art0:0,Work0:2+,Servers1:1" && t.bin?.id === "Bin" && t.bins.size === 2)
  check("tree: a group and all below it; where entries can go", [...within(groups, "Work")].join() === "Work,Servers" && groupChoices(groups).map((c) => c.label).join() === "r,Art,Work,Work / Servers")
  check("search: every word, in any field", matches(row("Bank", { username: "alice", tags: ["home"] }), "BANK hom") && !matches(row("Bank"), "bank alice"))
  const order = (by: Parameters<typeof sorted>[1]) => sorted(rows, by, health).map((e) => e.id).join()
  check("sort: by name, weakest first", order("title") === "Bank,Fine,Pin,Shop,VPN" && order("strength") === "Pin,Bank,Shop,VPN,Fine", [order("title"), order("strength")])
})
