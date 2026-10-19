import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, sentBy, sleep, write } = $
  // ---------- Review: what AIs changed (Activity) against the text before (File history), kept or reverted ----------
  const { whoOf } = await import("../../../core/ops.ts")
  const histData = ".vaultite/plugins/history/data.json"
  const histWas = exists(histData) ? read(histData) : null
  write(histData, JSON.stringify({ interval_min: 5 }))
  const user = whoOf("app/desktop", null)
  /** An op as an MCP app or the app calls it: Activity hears it as a request (as MCP's tools report theirs). */
  // (then the watcher's news of the files it wrote, which ties them to the call: a request's changes are what it wrote)
  const call = async (id: string, params: Any, who = user) => {
    await sleep(3)
    const r = (await app.callOp(id, params, who, { report: `mcp ${id}` })).result as Any
    if (id.startsWith("file.")) app.changed([params.path, params.to].filter((p) => typeof p === "string"))
    return r
  }
  const fails = async (id: string, params: Any, who = user) => { try { await call(id, params, who); return "" } catch (e) { return (e as Error).message } }
  /** A request from the app, as server.ts reports it to Activity. */
  async function heard(method: string, p: string, body: Any) {
    await sleep(3)
    const end = app.requestStarted({ t: Date.now(), method, route: p, query: {}, client: "app/desktop", agent: null, command: null, ua: "", remote: "", port: 1, forwarded: false })
    const r = await api(method, p, body, sentBy("app/desktop"))
    end({ status: r[0], ms: 1, body })
    return r
  }
  const chatgpt = whoOf("mcp", "ChatGPT"), grok = whoOf("mcp", "Grok Bot")
  const list = async (by?: string) => (await call("review.list", by ? { by } : {})).files as Any[]
  const pending = async (p: string, by?: string) => (await list(by)).find((f) => f.path === p)
  const detail = async (p: string) => (await api("GET", `review/file?path=${p}`))[1]

  // The user writes a note, then changes it within File history's interval (no version kept of that), then ChatGPT edits.
  const MAYA = "Rev/Maya.md"
  await heard("PUT", "file", { path: MAYA, text: "# Maya\n\nLikes tea.\n" })
  await api("GET", `history?path=${MAYA}`)
  await heard("PUT", "file", { path: MAYA, text: "# Maya\n\nLikes tea.\nLives in Lisbon.\n", base: read(MAYA) })
  await api("GET", `history?path=${MAYA}`)
  check("review: nothing to review while only the user wrote", !(await pending(MAYA)))
  await call("file.edit", { path: MAYA, old: "Lives in Lisbon.\n", new: "Lives in Lisbon.\nPlays the cello.\nHas a cat.\n" }, chatgpt)
  let f = await pending(MAYA)
  check("review: an MCP app's edit is listed, by its name, its lines counted against the user's last text (kept just before)",
    f && f.by.join() === "ChatGPT" && f.added === 2 && f.removed === 0 && !f.created && f.first <= f.last, f)
  check("review: by one writer, any spelling of it; another writer's list leaves it out",
    !!(await pending(MAYA, "ChatGPT")) && !!(await pending(MAYA, "chatgpt")) && !(await pending(MAYA, "Claude")), await list("Claude"))
  let d = await detail(MAYA)
  check("review: the diff's base is the text just before the AI's change", d.pending && d.base?.text === "# Maya\n\nLikes tea.\nLives in Lisbon.\n" && d.exact && !d.yours, d)
  const [, acts] = await api("GET", "activity?actor=agent&limit=20")
  check("activity: an app on the internet is named as its connection is, not by its slug", acts.events.some((e: Any) => e.actor.name === "ChatGPT" && e.paths?.includes(MAYA)), acts.events.slice(0, 3))

  // An AI can't mark its own changes reviewed.
  check("review: an agent can't keep or revert", /user's to do/.test(await fails("review.keep", { path: MAYA }, chatgpt)) && /user's to do/.test(await fails("review.revert", { path: MAYA }, chatgpt)))

  // An app Activity named by its slug (before it kept names): matched by either, shown readable.
  await call("file.edit", { path: MAYA, old: "Has a cat.", new: "Has two cats." }, { ...whoOf("cli", "muse-app"), client: "mcp", label: "" })
  f = await pending(MAYA)
  check("review: a writer named by its slug reads as a name, and is found by either", f?.by.includes("Muse App") && !!(await pending(MAYA, "muse-app")) && !!(await pending(MAYA, "Muse App")), f)
  // A new file Grok Bot made: all added, with origin ai; keeping it labels it reviewed.
  const NEW = "Rev/Trip ideas.md"
  await call("file.write", { path: NEW, text: "- Porto\n- Sintra\n" }, grok)
  f = await pending(NEW)
  check("review: a new file an AI made is all added (its origin header too), created", f && f.created && f.added === 6 && f.removed === 0 && f.by.join() === "Grok Bot", f)
  check("review: a two-word writer, as the Connections page asks", !!(await pending(NEW, "Grok Bot")) && !(await pending(MAYA, "Grok Bot")))
  check("review: newest first", (await list())[0].path === NEW)
  check("review: the new file is labelled ai (Provenance)", /^origin: ai$/m.test(read(NEW)), read(NEW))
  let kept = await call("review.keep", { path: NEW })
  check("review: keep takes it off the list, and labels what an AI wrote reviewed", !(await pending(NEW)) && /^origin: reviewed$/m.test(read(NEW)) && kept.relabeled[0]?.was === "ai", [kept, read(NEW)])
  check("review: its mark is the plugin's data", typeof JSON.parse(read(".vaultite/plugins/review/data.json")).files[NEW] === "number")
  // Undo (the app's): the marks put back, and the label.
  await api("POST", "review/marks", { was: kept.was }, sentBy("app/desktop"))
  await call("provenance.set", { path: NEW, origin: kept.relabeled[0].was })
  check("review: a keep undone shows it again", !!(await pending(NEW)) && /^origin: ai$/m.test(read(NEW)))
  check("review: only the app puts marks back", (await api("POST", "review/marks", { was: { [NEW]: Date.now() } }, sentBy("mcp")))[0] === 403)

  // Revert: the text before comes back (kept in File history); a new file is archived.
  const before = read(MAYA)
  const rv = await call("review.revert", { path: MAYA })
  check("review: revert writes the text before back, and says both for Undo", read(MAYA) === "# Maya\n\nLikes tea.\nLives in Lisbon.\n" && rv.reverted[0].was === before && !(await pending(MAYA)), [read(MAYA), rv])
  const rn = await call("review.revert", { path: NEW })
  check("review: reverting a new file archives it", !exists(NEW) && exists(rn.reverted[0].archived) && rn.reverted[0].archived.includes(".archive/"), rn)
  await call("archive.restore", { path: rn.reverted[0].archived })
  await api("POST", "review/marks", { was: rn.was }, sentBy("app/desktop"))
  check("review: an archive undone is back to review", exists(NEW) && !!(await pending(NEW)))

  // A later AI change shows a kept file again; the user's own edit after it doesn't clear it, and is said.
  await call("review.keep", { all: true })
  check("review: keep all", !(await list()).length, await list())
  await call("file.edit", { path: MAYA, old: "Likes tea.", new: "Likes green tea." }, chatgpt)
  await heard("PUT", "file", { path: MAYA, text: read(MAYA) + "Birthday in May.\n", base: read(MAYA) })
  f = await pending(MAYA)
  d = await detail(MAYA)
  check("review: a later AI change shows it again; the user's edit since keeps it, said as theirs too", f && f.added === 2 && f.removed === 1 && d.yours && d.base?.text === "# Maya\n\nLikes tea.\nLives in Lisbon.\n", [f, d])
  await call("review.keep", { all: true })

  // A coding agent's own edit (its hook, no request) just after the user's: the text just before isn't kept, so only Keep.
  const NOTES = "Rev/Notes.md"
  await heard("PUT", "file", { path: NOTES, text: "one\n" })
  await api("GET", `history?path=${NOTES}`)
  await heard("PUT", "file", { path: NOTES, text: "one\ntwo\n", base: read(NOTES) })
  await api("GET", `history?path=${NOTES}`)
  write(NOTES, "one\ntwo\nthree\n")
  await api("GET", `history?path=${NOTES}`)
  await sleep(3)
  await api("POST", "activity/hook?agent=claude-code&terminal=claude-rv1", { tool_name: "Edit", tool_input: { file_path: path.join(VAULT, NOTES) } })
  f = await pending(NOTES)
  d = await detail(NOTES)
  check("review: a coding agent's own edit is listed; without the text just before, no lines counted and no base", f && f.by.join() === "Claude Code" && f.added === undefined && d.base === null, [f, d])
  check("review: so it can't be reverted, only kept", /no version from just before/.test(await fails("review.revert", { path: NOTES })))
  const text = await call("review.list", {}).then(() => app.callOp("review.list", {}, user)).then((r) => r.text)
  check("review: as text, each file with who, its size and when", /Rev\/Notes\.md: Claude Code · no earlier version kept · /.test(text), text)
  await call("review.keep", { path: NOTES })

  // Marks follow a moved file; a file moved or deleted since isn't listed.
  await call("file.edit", { path: MAYA, old: "Likes green tea.", new: "Likes mint tea." }, chatgpt)
  await call("review.keep", { path: MAYA })
  await call("file.move", { from: MAYA, to: "Rev/Maya Silva.md" })
  check("review: a mark follows its file", typeof JSON.parse(read(".vaultite/plugins/review/data.json")).files["Rev/Maya Silva.md"] === "number")

  fs.rmSync(path.join(VAULT, "Rev"), { recursive: true, force: true })
  if (histWas === null) fs.rmSync(path.join(VAULT, histData), { force: true }); else write(histData, histWas)
}
