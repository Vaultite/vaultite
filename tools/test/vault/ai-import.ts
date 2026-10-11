import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, sleep, tmp, write } = $
  // AI import (plugins/core/ai-import): ChatGPT's and Claude's exports (made up: tools/fixtures/ai-import/make.ts) into chats,
  // projects and a review list of memories; streaming, branches, idempotent re-imports, and adding ticked memories.
  {
    const { jsonItems } = await import("../../../plugins/core/ai-import/jsonstream.ts")
    const { zipEntries, entryBytes, zipFiles } = await import("../../../plugins/core/ai-import/zip.ts")
    const chatgpt = await import("../../../plugins/core/ai-import/chatgpt.ts")
    const claude = await import("../../../plugins/core/ai-import/claude.ts")
    const { chatNote, reviewItems, afterApply, shiftHeadings, fenced } = await import("../../../plugins/core/ai-import/note.ts")
    const { applyReview } = await import("../../../plugins/core/ai-import/plugin.ts")
    const fx = await import("../../fixtures/ai-import/make.ts")
    const { Readable } = await import("node:stream")

    // Streaming JSON: items whole whatever the chunks cut through (strings, escapes, multi-byte letters).
    const src = JSON.stringify([{ a: "x,]}\"{[", b: [1, { c: "Ünïcödé ✓" }] }, "str]", 42, null, { d: "\\" }])
    const bytes = Buffer.from(src, "utf8")
    const items: unknown[] = []
    for await (const it of jsonItems(Readable.from(Array.from({ length: bytes.length }, (_, i) => bytes.subarray(i, i + 1))))) items.push(it)
    check("ai-import json: items one by one, byte by byte", JSON.stringify(items) === src, items)
    let threw = ""
    try { for await (const _ of jsonItems(Readable.from([Buffer.from('[{"a": 1}, {"b": ')]))) { /* reading */ } } catch (e) { threw = String(e) }
    check("ai-import json: a file cut off is an error", /ends in the middle/.test(threw), threw)
    const whole: unknown[] = []
    for await (const it of jsonItems(Readable.from([Buffer.from(' {"conversations_memory": "x"}')]))) whole.push(it)
    check("ai-import json: an object is one item", whole.length === 1 && (whole[0] as Any).conversations_memory === "x", whole)

    // Zips: read back what zipFiles wrote.
    const zf = path.join(tmp, "t.zip")
    fs.writeFileSync(zf, zipFiles({ "a.txt": "hello", "dir/b.json": JSON.stringify({ x: 1 }) }))
    const es = zipEntries(zf)
    check("ai-import zip: entries and their bytes", es.map((e) => e.name).join() === "a.txt,dir/b.json" && (await entryBytes(zf, es[0])).toString() === "hello", es)

    // ChatGPT: the branch last seen, models, images, thinking, memories from bio, custom instructions and the memory list.
    const [trip, py, lonely] = fx.chatgptConversations()
    const r = chatgpt.readConversation(trip)!
    const says = (m: Any) => m.parts.map((p: Any) => p.text ?? "").join(" ")
    check("chatgpt: the transcript is the branch to current_node (an edited prompt, a retried answer)",
      r.chat.messages.some((m) => says(m).includes("Sintra makes a good day trip")) && !r.chat.messages.some((m) => /Porto is|first try/.test(says(m))) && r.chat.otherBranches === 2, r.chat.messages.map(says))
    check("chatgpt: models in order, hidden context left out", r.chat.models.join() === "gpt-4o,o3" && !r.chat.messages.some((m) => /User profile|Model set context/.test(says(m))), r.chat.models)
    check("chatgpt: an image and thinking", r.chat.messages[0].parts[0].kind === "image" && (r.chat.messages[0].parts[0] as Any).ref === "file-Img001" && r.chat.messages.some((m) => m.parts.some((p) => p.kind === "thinking")))
    check("chatgpt: memories from bio and the custom instructions", r.memories.some((m) => m.text === "Is planning a trip to Lisbon in October." && m.from === "ChatGPT's memory") &&
      r.memories.some((m) => m.text === "I have a dog named Biscuit." && m.about === "me") && r.memories.some((m) => m.text === "Prefer concise answers with bullet points." && m.about === "preference"), r.memories)
    check("chatgpt: the memory list, numbers and dates off", r.memoryList?.facts.join("|") === "Prefers metric units.|Works as a product designer at Lighthouse.", r.memoryList)
    const p2 = chatgpt.readConversation(py)!
    check("chatgpt: no title or current_node: the first prompt names it, the newest leaf ends it", p2.chat.title === "What's 2 to the 20th?" && says(p2.chat.messages.at(-1)).includes("1,048,576") && p2.chat.messages.some((m) => m.parts.some((p) => p.kind === "code")), p2.chat)
    check("chatgpt: not a conversation is null", chatgpt.readConversation({ foo: 1 }) === null && chatgpt.readConversation(lonely)!.chat.messages.length === 1)

    // Claude: the newest leaf, artifacts, attachments, files without bytes, models, a name from the first prompt.
    const [recipes, old] = fx.claudeConversations()
    const c1 = claude.readConversation(recipes)!
    check("claude: the newest branch, one other", says(c1.messages.at(-1)).includes("Added chili") && !c1.messages.some((m) => says(m).includes("first try")) && c1.otherBranches === 1, c1.messages.map(says))
    check("claude: models, an artifact, a change to it, a web search, an attachment's text, an image without bytes", c1.models.join() === "claude-sonnet-4-5,claude-opus-4-1" &&
      c1.messages[1].parts.some((p) => p.kind === "code" && p.title === "Shopping list") && c1.messages.at(-1)!.parts.some((p) => p.kind === "code" && p.lang === "diff") &&
      c1.messages[1].parts.some((p) => p.kind === "note" && p.text.includes("rice bowl recipes")) && c1.messages[0].parts.some((p) => p.kind === "file" && p.text?.includes("beans")) &&
      c1.messages[0].parts.some((p) => p.kind === "image" && p.ref === null), c1.messages)
    const c2 = claude.readConversation(old)!
    check("claude: an old chat (text only, no name, no parents) in a project", c2.title === "When do I plant tomatoes?" && c2.messages.length === 2 && c2.project?.startsWith("p1000000"), c2)
    const mems = claude.readMemories([{ conversations_memory: "**Work**\n\nThe user designs. The user prefers short answers.\n\n- Lives in Porto", project_memories: { p1: "Sunny." } }], new Map([["p1", "Garden"]]))
    check("claude memories: sentences and items, headings off, a project's named", mems.map((m) => `${m.about}:${m.text}`).join("|") === "me:The user designs.|preference:The user prefers short answers.|me:Lives in Porto|me:Sunny." && mems[3].from.includes("Garden"), mems)
    const { factsOf } = await import("../../../plugins/core/ai-import/chat.ts")
    check("memories: a long fact kept whole", factsOf(`- ${"word ".repeat(200)}end`)[0]?.endsWith("end"))
    check("claude memories: memory as files", claude.readMemories({ memories: [{ path: "/preferences.md", content: "- Answer in English" }] })[0]?.about === "preference")

    // Markdown: headings moved under the turns (not in code), fences that can't close early.
    check("ai-import note: headings shifted, code left alone", shiftHeadings("# A\n```\n# b\n```\n###### C") === "### A\n```\n# b\n```\n###### C")
    check("ai-import note: a fence longer than the text's", fenced("a ``` b") === "````\na ``` b\n````")
    const n1 = chatNote(r.chat, new Map([["file-Img001", "file-Img001-beach.png"]]))
    check("ai-import note: turns as ## headings, the image embedded, the branches said", n1.body.startsWith("## You · 2026-09-20") && n1.body.includes("![[file-Img001-beach.png]]") &&
      n1.body.includes("### Day 1") && n1.body.includes("#### Day 2") && n1.body.includes("```\n# not a heading") && n1.body.includes("2 other branches") && n1.fm.messages === 6 && n1.fm.ext_id === `chatgpt-${(trip as Any).id}`, n1)

    // The import, through the API: the zip in the vault (an upload is the same file, written as it comes).
    write("Imports/chatgpt-export.zip", "")
    fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport())
    fs.writeFileSync(path.join(VAULT, "Imports/claude-export.dms"), fx.claudeExport())
    const runJob = async (body: unknown, q = "") => {
      const [st, job] = await api("POST", `ai-import${q}`, body)
      if (st !== 202) return { state: "refused", status: st, job }
      for (let i = 0; i < 3000; i++) {
        const [, j] = await api("GET", `ai-import/jobs/${job.id}`)
        if (j.state === "done" || j.state === "failed") return j
        await sleep(20)
      }
      return { state: "timeout" }
    }
    let j = await runJob({ path: "Imports/chatgpt-export.zip" })
    const tripRel = "Chats/ChatGPT/2026-09-20 Trip to Lisbon.md"
    check("ai-import chatgpt: done, every chat made (a one-message one too), the broken item said", j.state === "done" && j.source === "chatgpt" && j.created === 3 && j.skipped === 0 && j.problems.length === 1 && j.read === j.total, j)
    check("ai-import chatgpt: the chat note", exists(tripRel) && read(tripRel).startsWith("---\ntype: chat\nsource: chatgpt\next_id: chatgpt-") && read(tripRel).includes("models: [gpt-4o, o3]"), exists(tripRel) && read(tripRel))
    check("ai-import chatgpt: an image, once, in Attachments", j.images === 1 && exists("Chats/ChatGPT/Attachments/file-Img001-beach.png"), j)
    check("ai-import chatgpt: memories to review, none written to ME.md", j.memories === 6 && j.review === "Chats/ChatGPT/Memories to review.md" && !read("ME.md").includes("Biscuit") &&
      reviewItems(read(j.review)).length === 6 && reviewItems(read(j.review)).every((i) => !i.done), j)
    let [, rendered] = await api("GET", `render?path=${j.review}`)
    check("ai-import review block: as text, the count", String(rendered).includes("6 memories to review, 0 ticked"), rendered)

    // Again: nothing changes, nothing doubles.
    const before = read(tripRel)
    j = await runJob({ path: "Imports/chatgpt-export.zip" })
    check("ai-import again: unchanged, no second file, no new memories", j.state === "done" && j.created === 0 && j.unchanged === 3 && j.memories === 0 && read(tripRel) === before &&
      fs.readdirSync(path.join(VAULT, "Chats/ChatGPT")).filter((f) => f.endsWith(".md")).length === 4, j)
    // The user writes above the transcript and adds a key; the chat goes on in ChatGPT; importing again updates it in place.
    write(tripRel, before.replace("---\n\n## You", "rating: 5\n---\n\nMy notes: book the train.\n\n## You"))
    fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport(120))
    j = await runJob({ path: "Imports/chatgpt-export.zip" })
    const after = read(tripRel)
    check("ai-import update: in place, the user's text and keys kept, updated changed", j.updated === 1 && j.unchanged === 2 && after.includes("My notes: book the train.\n\n## You") &&
      after.includes("rating: 5") && after.includes("updated: '2026-09-20 16:12:00'") && after.split("## You").length === 3, [j, after])

    // Claude's (named .dms), with a project and memories.
    j = await runJob({ path: "Imports/claude-export.dms" }, "?minMessages=1")
    const proj = "Chats/Claude/Projects/Garden planning.md"
    check("ai-import claude: chats, a project, the empty one skipped", j.state === "done" && j.source === "claude" && j.created === 2 && j.skipped === 1 && j.projects === 1 && exists(proj) &&
      read(proj).includes("## Instructions") && read(proj).includes("#### Beds"), j)
    {
      const recipes = read(`Chats/Claude/${fs.readdirSync(path.join(VAULT, "Chats/Claude")).find((f) => f.endsWith("Recipe ideas.md"))}`)
      check("ai-import claude: a long attachment is a file of its own, whole, linked; a long tool result kept whole", j.files === 1 &&
        read("Chats/Claude/Attachments/cookbook.pdf.txt") === "A long cookbook page. ".repeat(300) && recipes.includes("*Attached* [[cookbook.pdf.txt]]") &&
        recipes.includes("The end of the page.") && recipes.includes("Attached pantry.txt"), [j, recipes.slice(0, 1500)])
    }
    check("ai-import claude: a chat links its project", read("Chats/Claude/2026-09-21 When do I plant tomatoes.md").includes("project: '[[Chats/Claude/Projects/Garden planning|Garden planning]]'"))
    check("ai-import claude: memories to review", j.memories === 5 && reviewItems(read("Chats/Claude/Memories to review.md")).some((i) => i.fact === "Has a dog named Biscuit"), j)
    j = await runJob({ path: "Imports/claude-export.dms" })
    check("ai-import claude again: unchanged, its attachment's file not doubled", j.created === 0 && j.projects === 0 && j.unchanged === 2 && j.memories === 0 &&
      fs.readdirSync(path.join(VAULT, "Chats/Claude/Attachments")).length === 1, j)
    j = await runJob({ path: "People/Sam Park.md" })
    check("ai-import: something that isn't an export fails, saying why", j.state === "failed" && /conversations/.test(j.error), j)
    const [bs] = await api("POST", "ai-import", {})
    check("ai-import: no export is a 400", bs === 400)

    // Adding ticked memories: through the op MCP's remember is (in-process here), then off the list and under Added.
    const rememberOp = app.catalog().find((e) => e.mcp === "remember")!.id
    const remember = async (args: Any) => (await app.callOp(rememberOp, args, { client: "mcp", agent: "ai-import", label: "ChatGPT", source: "chatgpt" })).text
    const rel = "Chats/ChatGPT/Memories to review.md"
    let list = read(rel)
    list = list.replace("- [ ] **Me** · I have a dog named Biscuit.", "- [x] **Me** · I have a dog named Biscuit.")
      .replace("- [ ] **How to work with me** · Prefer concise answers with bullet points.", "- [x] **How to work with me** · Prefer concise answers with bullet points.")
      .replace("- [ ] **Me** · Works as a product designer at Lighthouse.", "- [x] **Sam Park** · Works as a product designer at Lighthouse.")
      .replace("- [ ] **Me** · Is planning a trip to Lisbon in October.", "- [x] **Nobody Here** · Is planning a trip to Lisbon in October.")
    write(rel, list)
    const results = await applyReview(list, "ChatGPT", remember)
    write(rel, afterApply(read(rel), results))
    const me = read("ME.md"), sam = read("People/Sam Park.md"), done = read(rel)
    check("ai-import apply: a fact in ME.md under About me, a preference under How to work with me", /## About me\n[\s\S]*- I have a dog named Biscuit\./.test(me) && /## How to work with me\n[\s\S]*- Prefer concise answers with bullet points\./.test(me), me)
    check("ai-import apply: a person's in their file, with its source", /Works as a product designer at Lighthouse\. \(from ChatGPT, \d{4}-\d\d-\d\d\)/.test(sam), sam)
    check("ai-import apply: added ones leave the list for Added, a failed one stays ticked with why", results.filter((x) => x.error).length === 1 &&
      done.includes("## Added\n\n- ") && done.includes("\n- ME.md, About me · I have a dog named Biscuit.") && done.includes("\n- ME.md, How to work with me · Prefer concise answers") &&
      done.includes("\n- [[Sam Park]] · Works as a product designer") && !done.includes("### From ChatGPT's custom instructions\n\n- [ ] **Me** · I have a dog") &&
      /- \[x\] \*\*Nobody Here\*\* · Is planning a trip to Lisbon in October\.\n {4}- Couldn't add it: No one called 'Nobody Here'/.test(done) && reviewItems(done).length === 3, done.slice(done.indexOf("## To review")))
    const again = await applyReview(done.replace("**Nobody Here**", "**Me**"), "ChatGPT", remember)
    const done2 = afterApply(done.replace("**Nobody Here**", "**Me**"), again)
    check("ai-import apply: fixed and applied again, its error line goes", !done2.includes("Couldn't add") && done2.includes("- ME.md, About me · Is planning a trip") && reviewItems(done2).length === 2, done2)
    // Re-importing never brings an added memory back.
    write(rel, done2)
    fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport(240))
    j = await runJob({ path: "Imports/chatgpt-export.zip" })
    check("ai-import again after adding: no memory comes back", j.memories === 0 && reviewItems(read(rel)).length === 2, [j, read(rel)])
    // The ops: apply (the app's Add) through people.remember, in-process; run on an export in the vault, waiting for it.
    write(rel, read(rel).replace(/- \[ \] \*\*/, "- [x] **"))
    const [as, ab] = await api("POST", "ops/ai-import.apply", { path: rel })
    check("ai-import.apply: the ticked memory added, off the list", as === 200 && ab.added === 1 && !ab.failed && !reviewItems(read(rel)).some((i) => i.done) && reviewItems(read(rel)).length === 1, [as, ab, read(rel)])
    const [ns, nb] = await api("POST", "ops/ai-import.apply?as=text", { path: rel })
    check("ai-import.apply: nothing ticked, says so", ns === 200 && nb === "Nothing ticked to add.", [ns, nb])
    const [rs, rb] = await api("POST", "ops/ai-import.run?as=text", { path: "chatgpt-export.zip", wait: true })
    check("ai-import.run: an export in the vault (by its name), waited for, said like vau import", rs === 200 && /^ChatGPT: \d+ chats in Chats\/ChatGPT\/: 0 new/.test(rb), [rs, rb])
    const [js, jb] = await api("POST", "ops/ai-import.job", {})
    check("ai-import.job: the latest import", js === 200 && jb.state === "done" && jb.name === "chatgpt-export.zip", [js, jb])
    check("ai-import routes: upload and import aren't held, the op run neither; apply is (it writes the vault)", app.unlocked("POST", ["ai-import"]) && app.streams("POST", ["ai-import"]) && app.streams("POST", ["ai-import", "upload"])
      // (an op route holds the vault itself, for a write that doesn't say lock: false: App.callOp)
      && app.opNamed("ai-import.run")?.op.lock === false && app.opNamed("ai-import.apply")?.op.kind === "write" && app.opNamed("ai-import.apply")?.op.lock !== false)

    // Big: 1500 chats stream through without holding the server (the event loop keeps turning).
    const many = Array.from({ length: 1500 }, (_, i) => ({ uuid: `b16b16b1-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Chat ${i}`, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:05:00Z",
      chat_messages: [{ uuid: `${i}a`, text: `Question ${i} ${"x".repeat(2000)}`, sender: "human", created_at: "2026-09-01T10:00:00Z" }, { uuid: `${i}b`, text: `Answer ${i}`, sender: "assistant", created_at: "2026-09-01T10:01:00Z" }] }))
    fs.writeFileSync(path.join(VAULT, "Imports/big.zip"), zipFiles({ "conversations.json": JSON.stringify(many) }))
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    const t0 = Date.now()
    j = await runJob({ path: "Imports/big.zip" }, "?folder=Big")
    clearInterval(timer)
    check("ai-import big: 1500 chats, in their folder", j.state === "done" && j.created === 1500 && fs.readdirSync(path.join(VAULT, "Big/Claude")).length === 1500, j)
    check("ai-import big: the server kept turning meanwhile (not one long block)", ticks >= 20, { ticks, ms: Date.now() - t0 })
  }
}
