import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, run, sentBy, vault, write } = $
  // ---------- Provenance: an agent's new notes are `origin: ai` (plugin.onCreate, from the request's writer) ----------
  {
    const as = (client: string | null, agent: string | null, method: string, p: string, body: unknown) => api(method, p, body, sentBy(client, agent))
    const origin = (rel: string) => /^origin: (.*)$/m.exec(read(rel))?.[1] ?? null
    await as("mcp", null, "POST", "notes", { title: "Prov by mcp", body: "Hello.", ext_id: "prov-mcp" })
    check("provenance: a note an MCP client makes is origin: ai", origin("Notes/Prov by mcp.md") === "ai", read("Notes/Prov by mcp.md"))
    await as(null, null, "PUT", "file", { path: "Prov/Curl.md", text: "Just text.\n" })
    check("provenance: a plain note from curl gets a header with origin: ai, its text kept", read("Prov/Curl.md") === "---\norigin: ai\n---\n\nJust text.\n", read("Prov/Curl.md"))
    await as("cli", "claude-code", "PUT", "file", { path: "Prov/Agent.md", text: "---\ntags: [A]   # mine\n---\nBody\n" })
    check("provenance: the CLI under an agent too, the header's own lines kept", read("Prov/Agent.md") === "---\ntags: [A]   # mine\norigin: ai\n---\nBody\n", read("Prov/Agent.md"))
    await as("cli", "claude-code", "PUT", "file", { path: "Prov spaced/Header.md", text: "---\n\nkind: drawing\ntags: [x]\n\n---\nBody\n" })
    check("provenance: a header's blank lines stay where they were, the new key after the last value", read("Prov spaced/Header.md") === "---\n\nkind: drawing\ntags: [x]\norigin: ai\n\n---\nBody\n", read("Prov spaced/Header.md"))
    fs.rmSync(path.join(VAULT, "Prov spaced"), { recursive: true })
    await as("app/desktop", null, "PUT", "file", { path: "Prov/Default mine.md", text: "Mine.\n" })
    check("provenance: the user's own notes aren't labelled unless label_user is on (no label is theirs)", read("Prov/Default mine.md") === "Mine.\n", read("Prov/Default mine.md"))
    check("provenance: the store says so, for the header", (await app.state()).provenance?.labelUser === false)
    fs.rmSync(path.join(VAULT, "Prov/Default mine.md"))
    vault.setConfig("plugins/provenance/data", { label_user: true })
    await as("app/desktop", null, "POST", "notes", { title: "Prov by app", body: "Mine.", ext_id: "prov-app" })
    await as("cli", null, "PUT", "file", { path: "Prov/Typed.md", text: "By hand.\n" })
    await as("app/phone", null, "POST", "file", { path: "Prov/Untitled.md", text: "", unique: true })
    check("provenance: the app's and the CLI typed by hand are the user's: origin: human", origin("Notes/Prov by app.md") === "human" && origin("Prov/Typed.md") === "human" && read("Prov/Untitled.md") === "---\norigin: human\n---\n", [read("Notes/Prov by app.md"), read("Prov/Typed.md"), read("Prov/Untitled.md")])
    await as("mcp", null, "PUT", "file", { path: "Prov/Mine.md", text: "---\norigin: human\n---\nHers.\n" })
    await as("mcp", null, "PUT", "file", { path: "Prov/Curl.md", text: "---\norigin: ai\n---\n\nJust text, edited.\n", base: read("Prov/Curl.md") })
    await as("mcp", null, "POST", "notes", { title: "Prov by app", body: "Mine, edited by an agent.", ext_id: "prov-app" })
    check("provenance: a label it's given stays; edits never add or change one", origin("Prov/Mine.md") === "human" && origin("Notes/Prov by app.md") === "human" && read("Notes/Prov by app.md").includes("edited by an agent"), [read("Prov/Mine.md"), read("Notes/Prov by app.md")])
    await as("mcp", null, "POST", "people", { name: "Prov Person", relation: "friend" })
    await as("mcp", null, "PUT", "file", { path: "Prov/Board.md", text: "---\ntype: dashboard\n---\n" })
    check("provenance: only notes (not people, not dashboards)", origin("People/Prov Person.md") === null && origin("Prov/Board.md") === null, read("People/Prov Person.md"))
    const [, st] = await api("GET", "state")
    check("provenance: its values in the store, the defaults when none are set", (st.provenance?.values as Any[] ?? []).map((v: Any) => v.value).join() === "human,reviewed,mixed,ai", st.provenance)
    vault.setConfig("plugins/provenance/data", { values: [{ value: "mine" }, { value: "bot", label: "Bot" }], agent: "bot" })
    await as("mcp", null, "PUT", "file", { path: "Prov/Own.md", text: "Own.\n" })
    const [, st2] = await api("GET", "state")
    check("provenance: a vault's own values, and the label agents get", origin("Prov/Own.md") === "bot" && (st2.provenance?.values as Any[] | undefined)?.length === 2, [read("Prov/Own.md"), st2.provenance])
    vault.setConfig("plugins/provenance/data", { label_agents: false, label_user: false })
    await as("mcp", null, "PUT", "file", { path: "Prov/Unasked.md", text: "Unasked.\n" })
    await as("app/desktop", null, "PUT", "file", { path: "Prov/Unasked mine.md", text: "Mine.\n" })
    check("provenance: with label_agents and label_user off, new notes aren't labelled", read("Prov/Unasked.md") === "Unasked.\n" && read("Prov/Unasked mine.md") === "Mine.\n", read("Prov/Unasked.md"))
    let [, voice] = await as("iphone", null, "POST", "ops/inbox.voice", { text: "Prov voice unlabelled", from: "iPhone" })
    check("provenance: a voice note isn't labelled with label_user off", origin(voice.path) === null, read(voice.path))
    fs.rmSync(path.join(VAULT, voice.path))
    vault.setConfig("plugins/provenance/data", { label_user: true })
    ;[, voice] = await as("iphone", null, "POST", "ops/inbox.voice", { text: "Prov voice from the phone", from: "iPhone" })
    check("provenance: a voice note is the user's own words: origin: human (from the phone, an agent's client)", origin(voice.path) === "human" && read(voice.path).includes("type: inbox"), read(voice.path))
    await as("mcp", null, "PUT", "inbox/Prov voice from the phone", { status: "done" })
    const doneVoice = "Inbox/.archive/Prov voice from the phone.md"
    check("provenance: a voice note marked done (archived) keeps its label", origin(doneVoice) === "human" && /status: done/.test(read(doneVoice)), read(doneVoice))
    fs.rmSync(path.join(VAULT, doneVoice))
    ;[, voice] = await as("mcp", null, "POST", "ops/inbox.voice", { text: "Prov voice from an AI app", from: "ChatGPT" })
    check("provenance: inbox.voice from an AI app (MCP) is its words, not the user's: origin: ai", origin(voice.path) === "ai", read(voice.path))
    fs.rmSync(path.join(VAULT, voice.path))
    const [, q] = await api("POST", "query", { from: "Prov/", where: "origin = ai" })
    check("provenance: database views filter on it", (q.groups as Any[]).flatMap((g: Any) => g.rows.map((r: Any) => r.path)).sort().join() === "Prov/Agent.md,Prov/Curl.md", q)
    for (const f of ["Prov", "Notes/Prov by mcp.md", "Notes/Prov by app.md", "People/Prov Person.md"]) fs.rmSync(path.join(VAULT, f), { recursive: true, force: true })
  }

  // ---------- Authorship: which lines agents wrote, kept beside the note (authorship.ts), never in it ----------
  {
    const A = await import("../../../plugins/core/provenance/authorship.ts")
    const { opcodes } = await import("../../../core/textedit.ts")
    const who = { by: "Opus", model: "Opus 5.5", effort: "high", tint: "orange", t: 1 }
    const spans = A.written("Mine.\n", "Mine.\n\nYours, a long answer.\nAnd more.\n", who, opcodes)
    check("authorship: a write's new lines are one span, as written", spans.length === 1 && spans[0].line === 3 && spans[0].lines.join("|") === "Yours, a long answer.|And more.", spans)
    const later = "Mine, edited.\n\nA line I added.\nYours, a long answer.\nAnd more, which I edited a bit.\n"
    const m = A.resolve(later, spans)
    check("authorship: found again by their text after edits; a line the user edited since is mixed", m.get(4)?.mixed === false && m.get(5)?.mixed === true && !m.has(1) && !m.has(3), [...m])
    check("authorship: a line the user rewrote is theirs again", !A.resolve("Mine.\n\nSomething else entirely now.\nNothing alike.\n", spans).size)
    const over = A.written("Mine, a line of mine here.\n", "Mine, a line of mine here today.\n", who, opcodes)
    check("authorship: an agent's edit of the user's line is mixed", over.length === 1 && over[0].mixed?.join() === "0", over)
    check("authorship: frontmatter is never marked", A.written(null, "---\norigin: ai\n---\nBody.\n", who, opcodes).map((x) => x.line).join() === "4")
    check("authorship: the tip says who, model, effort and when", A.authorText(who, () => "19:36") === "Opus · Opus 5.5 high · 19:36")

    const agent = (extra: Record<string, string> = {}) => ({ headers: { "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code", "x-vaultite-effort": "high", ...extra } }) as unknown as import("node:http").IncomingMessage
    const settle = () => new Promise((r) => setTimeout(r, 80))
    const side = (rel: string) => path.join(VAULT, ".vaultite/plugins/provenance/authorship", `${rel}.json`)
    const spansOf = (rel: string) => (fs.existsSync(side(rel)) ? JSON.parse(fs.readFileSync(side(rel), "utf8")).spans as Any[] : [])
    write("Auth/Talk.md", "My question?\n")
    await api("PUT", "file", { path: "Auth/Talk.md", text: "My question?\n\nMy answer.\n", base: "My question?\n" }, agent({ "x-vaultite-model": "claude-opus-5-5" }))
    await settle()
    const s1 = spansOf("Auth/Talk.md")
    check("authorship: an agent's write is kept beside the note, with who, model and effort", s1.length === 1 && s1[0].by === "Claude" && s1[0].model === "Opus 5.5" && s1[0].effort === "high" && s1[0].lines.join() === "My answer.", s1)
    check("authorship: the note itself is unchanged", !read("Auth/Talk.md").includes("Opus"), read("Auth/Talk.md"))
    await api("PUT", "file", { path: "Auth/Talk.md", text: "My question?\n\nMy answer.\n\nMy follow-up.\n", base: read("Auth/Talk.md") }, sentBy("app/desktop"))
    await settle()
    check("authorship: the user's own writes add nothing", spansOf("Auth/Talk.md").length === 1)
    await api("POST", "ops/file.edit", { path: "Auth/Talk.md", old: "My follow-up.", new: "My follow-up.\n\nYour reply, by vau edit." }, agent())
    await settle()
    check("authorship: any write op by an agent is kept too (vau edit)", spansOf("Auth/Talk.md").some((x) => x.lines.includes("Your reply, by vau edit.")), spansOf("Auth/Talk.md"))
    const blame = await app.callOp("provenance.blame", { path: "Auth/Talk.md" }) as { result: Any; text: string }
    check("authorship: vau blame lists agents' lines by number", blame.result.runs.map((r: Any) => `${r.from}:${r.by}`).join() === "3:Claude,7:Claude" && /2 of \d+ lines by agents/.test(blame.text), blame)
    const [, got] = await api("GET", "provenance/authorship?path=Auth/Talk.md")
    check("authorship: the app reads the spans and the setting (kept, not shown, by default)", got.mode === "hidden" && got.spans.length === 2, got)
    const { LOADED } = await import("../../../core/plugins.ts")
    const today = await LOADED.find((x) => x.id === "provenance")!.ask<Any[]>("provenance:authored", [], "Auth/Talk.md", Date.now() - 60_000, Date.now() + 1000)
    check("authorship: the recap hears what agents wrote that day, by who", today.length === 1 && today[0].by === "Claude" && today[0].lines === 2, today)
    await api("POST", "file/move", { from: "Auth/Talk.md", to: "Auth/Moved.md" })
    check("authorship: it follows the note when it moves", spansOf("Auth/Moved.md").length === 2 && !fs.existsSync(side("Auth/Talk.md")))
    vault.setConfig("plugins/provenance/data", { authorship: "off" })
    await api("PUT", "file", { path: "Auth/Off.md", text: "Not kept.\n" }, agent())
    await settle()
    check("authorship: off keeps nothing", !fs.existsSync(side("Auth/Off.md")))
    vault.setConfig("plugins/provenance/data", {})
    for (const f of ["Auth", ".vaultite/plugins/provenance/authorship"]) fs.rmSync(path.join(VAULT, f), { recursive: true, force: true })
  }

  // ---------- Provenance for files that aren't notes: its list (files.json), their bytes never changed ----------
  {
    const zlib = await import("node:zlib")
    const { saysAi, AI_SOURCE } = await import("../../../plugins/core/provenance/xmp.ts")
    const chunk = (type: string, data: Buffer) => {
      const b = Buffer.alloc(12 + data.length)
      b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1"); data.copy(b, 8)
      b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length)
      return b
    }
    const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]) // 2x2, 8-bit RGB
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))])
    const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==", "base64")
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" data-x="a>b"><rect width="2" height="2"/></svg>\n'

    // (an image an AI app marked: an XMP iTXt chunk after IHDR)
    const p2 = Buffer.concat([png.subarray(0, 33), chunk("iTXt", Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>${AI_SOURCE}</Iptc4xmpExt:DigitalSourceType></x:xmpmeta>`, "latin1")), png.subarray(33)])
    check("provenance xmp: read in an XMP chunk, not in an image without one", saysAi(p2) && !saysAi(png) && !saysAi(jpeg))
    const composite = zlib.deflateSync(Buffer.from(`<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></x:xmpmeta>`))
    const zpng = Buffer.concat([png.subarray(0, 33), chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\x01\0\0\0", "latin1"), composite])), png.subarray(33)])
    check("provenance xmp: read in a compressed XMP chunk (composite with AI counts), in a tail, not in a camera's",
      saysAi(zpng) && saysAi(Buffer.alloc(10), Buffer.from(`"digitalSourceType":"${AI_SOURCE}"`)) && !saysAi(Buffer.from("digitalsourcetype/digitalCapture")))

    const as = (client: string | null, agent: string | null, method: string, p: string, body: unknown, query: Record<string, string> = {}) =>
      run(method, p.split("/"), query, body, sentBy(client, agent))
    const list = () => (exists(".vaultite/plugins/provenance/files.json") ? JSON.parse(read(".vaultite/plugins/provenance/files.json")) : {})
    const bytes = (rel: string) => fs.readFileSync(path.join(VAULT, rel))
    const b64 = (b: Buffer) => b.toString("base64")
    await as("mcp", null, "POST", "ops/file.upload", { data: b64(png), name: "Prov chart.png", folder: "ProvM" })
    await as("cli", "claude-code", "POST", "ops/file.upload", { data: b64(jpeg), name: "Prov photo.jpg", folder: "ProvM" })
    {
      const [, cam] = await as("mcp", null, "POST", "ops/file.upload", { data: b64(jpeg), name: "image.jpg", folder: "ProvM" })
      check("upload: a phone's nameless image.jpg is named as Obsidian names a pasted one", /^ProvM\/Pasted image \d{14}\.jpg$/.test(cam.path), cam)
      fs.rmSync(path.join(VAULT, cam.path))
    }
    check("provenance files: an agent's upload is labelled ai in the list, its bytes as they came", list()["ProvM/Prov chart.png"] === "ai" && list()["ProvM/Prov photo.jpg"] === "ai"
      && bytes("ProvM/Prov chart.png").equals(png) && bytes("ProvM/Prov photo.jpg").equals(jpeg), list())
    vault.setConfig("plugins/provenance/data", { label_user: true })
    await as("app/desktop", null, "POST", "upload", { path: "ProvM/Mine.png", bytes: png })
    check("provenance files: the user's upload from the app is human, its bytes untouched", list()["ProvM/Mine.png"] === "human" && bytes("ProvM/Mine.png").equals(png), list())
    await as("cli", "codex", "POST", "ops/file.upload", { data: b64(Buffer.from(svg)), name: "Drawing.svg", folder: "ProvM" })
    await as("cli", "codex", "POST", "ops/file.write", { path: "ProvM/Data.csv", text: "a,b\n1,2\n" })
    check("provenance files: an agent's SVG and a CSV through file.write labelled, not changed", list()["ProvM/Drawing.svg"] === "ai" && read("ProvM/Drawing.svg") === svg
      && list()["ProvM/Data.csv"] === "ai" && read("ProvM/Data.csv") === "a,b\n1,2\n", [list(), read("ProvM/Drawing.svg")])
    await as("cli", "codex", "PUT", "file", { path: "ProvM/Drawing.svg", text: read("ProvM/Drawing.svg").replace("<rect", "<circle"), base: read("ProvM/Drawing.svg") })
    check("provenance files: an edit leaves the label and adds nothing", list()["ProvM/Drawing.svg"] === "ai" && read("ProvM/Drawing.svg") === svg.replace("<rect", "<circle"), read("ProvM/Drawing.svg"))
    await as("app/desktop", null, "POST", "upload", { path: "ProvM/From ChatGPT.png", bytes: p2 })
    let [, o] = await as("cli", null, "POST", "ops/provenance.get", { path: "ProvM/From ChatGPT.png" })
    check("provenance files: an upload whose bytes say an AI made it isn't labelled the user's: it reads as ai, from the file", !("ProvM/From ChatGPT.png" in list()) && o.origin === "ai" && o.from === "file", [o, list()])
    write("ProvM/Dropped.png", png.toString("latin1"))
    ;[, o] = await as("cli", null, "POST", "ops/provenance.get", { path: "ProvM/Dropped.png" })
    check("provenance files: a file put there by hand, saying nothing, is unlabelled", o.origin === null && o.from === null, o)
    ;[, o] = await as("app/desktop", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "Reviewed" })
    check("provenance files: the user labels any file (the value as the settings write it); its bytes don't change", o.origin === "reviewed" && list()["ProvM/Dropped.png"] === "reviewed" && read("ProvM/Dropped.png") === png.toString("latin1"), [o, list()])
    let [code] = await as("mcp", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "human" })
    const [code2] = await as("cli", "claude-code", "POST", "ops/provenance.set", { path: "ProvM/Dropped.png" })
    const [code3] = await as("cli", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "robot" })
    check("provenance files: an agent can't label human or remove a label; a value that isn't one is refused", code === 403 && code2 === 403 && code3 === 400 && list()["ProvM/Dropped.png"] === "reviewed", [code, code2, code3])
    ;[code, o] = await as("mcp", null, "POST", "ops/provenance.set", { path: "Prov chart.png", origin: "ai" })
    check("provenance files: an agent labels ai, a file named as the user says it", code === 200 && o.path === "ProvM/Prov chart.png" && o.origin === "ai", o)
    write("ProvM/Note.md", "Text.\n")
    ;[, o] = await as("app/desktop", null, "POST", "ops/provenance.set", { path: "ProvM/Note.md", origin: "mixed" })
    check("provenance files: a note's label is its frontmatter, as a small edit", read("ProvM/Note.md") === "---\norigin: mixed\n---\n\nText.\n" && o.from === "frontmatter" && !("ProvM/Note.md" in list()), read("ProvM/Note.md"))
    ;[, o] = await as("app/desktop", null, "GET", "provenance/origin", {}, { path: "ProvM/Mine.png" })
    check("provenance files: the app's chip reads it at /api/provenance/origin", o.origin === "human" && o.from === "list", o)

    await as("app/desktop", null, "POST", "file/move", { from: "ProvM/Mine.png", to: "ProvM/Sub/Renamed.png" })
    check("provenance files: a label follows its file moved and renamed", list()["ProvM/Sub/Renamed.png"] === "human" && !("ProvM/Mine.png" in list()), list())
    await as("cli", null, "POST", "ops/file.move", { from: "ProvM/Sub", to: "ProvM/Moved" })
    check("provenance files: and its folder moved (vau move)", list()["ProvM/Moved/Renamed.png"] === "human" && !Object.keys(list()).some((k) => k.startsWith("ProvM/Sub/")), list())
    const [, del] = await as("app/desktop", null, "DELETE", "file", { path: "ProvM/Moved/Renamed.png" })
    check("provenance files: deleted, it goes into the trash with it", list()[del.trashed] === "human" && !("ProvM/Moved/Renamed.png" in list()), [del, list()])
    await as("app/desktop", null, "POST", "file/restore", { path: del.trashed })
    check("provenance files: restored (Undo), it comes back", list()["ProvM/Moved/Renamed.png"] === "human" && !(del.trashed in list()), list())
    const [, del2] = await as("app/desktop", null, "DELETE", "file", { path: "ProvM/Moved/Renamed.png" })
    fs.rmSync(path.join(VAULT, del2.trashed))
    await api("GET", "files")
    check("provenance files: gone for good from the trash, it's gone from the list", !(del2.trashed in list()) && !Object.keys(list()).some((k) => k.startsWith(".trash/")), list())

    write("ProvM/All.base", "filters: file.inFolder(\"ProvM\")\nviews:\n  - type: table\n    name: AI\n    filters: 'origin == \"ai\"'\n    order: [file.name]\n")
    const [, qr] = await api("GET", "query?base=ProvM/All.base")
    check("provenance files: a base filters attachments on origin (the list's, and what their bytes say)",
      JSON.stringify(qr.groups?.[0]?.rows.map((r: Any) => r.path).sort()) === JSON.stringify(["ProvM/Data.csv", "ProvM/Drawing.svg", "ProvM/From ChatGPT.png", "ProvM/Prov chart.png", "ProvM/Prov photo.jpg"]), qr.groups?.[0]?.rows.map((r: Any) => r.path))
    vault.setConfig("plugins/provenance/data", { label_agents: false })
    await as("mcp", null, "POST", "ops/file.upload", { data: b64(png), name: "Unasked.png", folder: "ProvM" })
    check("provenance files: with label_agents off, an agent's upload isn't labelled or changed", !("ProvM/Unasked.png" in list()) && bytes("ProvM/Unasked.png").equals(png), list())
    vault.setConfig("plugins/provenance/data", {})
    fs.rmSync(path.join(VAULT, "ProvM"), { recursive: true, force: true })
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/provenance/files.json"), { force: true })
  }
}
