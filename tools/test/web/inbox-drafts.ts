import { check } from "../lib.ts"
import { type Any } from "./lib.ts"

// ---------- Inbox: a reply's draft lasts until the server has it (plugins/core/inbox/drafts.ts) ----------
const g = globalThis as Any, was = g.localStorage
const kept = new Map<string, string>()
g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) }
const d = await import("../../../plugins/core/inbox/drafts.ts")
const ok = await d.sendDraft("a", "Yes, go ahead", async () => {
  const during = d.draftOf("a") === "Yes, go ahead" && d.sendingOf("a") === "Yes, go ahead"
  return { during }
})
check("reply drafts: kept while sending, cleared once the server has it", !!ok?.during && d.draftOf("a") === "" && d.sendingOf("a") === null, [ok, d.draftOf("a")])
let failed = false
await d.sendDraft("b", "Try again later", async () => { throw new Error("offline") }).catch(() => { failed = true })
check("reply drafts: a failed send keeps its draft", failed && d.draftOf("b") === "Try again later" && d.hasDraft("b") && d.sendingOf("b") === null)
let posts = 0
void d.sendDraft("c", "Never answered", () => { posts++; return new Promise(() => {}) })
await new Promise((r) => setTimeout(r, 10))
check("reply drafts: a send that never answers keeps its draft (the app killed mid-send finds it)", d.draftOf("c") === "Never answered" && d.sendingOf("c") === "Never answered")
const again = await d.sendDraft("c", "Never answered", async () => { posts++ })
check("reply drafts: no second send while one is on its way", again === undefined && posts === 1, posts)
d.keepDraft("b", "  ")
check("reply drafts: emptied is no draft", !d.hasDraft("b") && !kept.has("vaultite.reply:b"))
g.localStorage = was
