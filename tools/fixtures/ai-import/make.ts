/**
 * Made-up exports of ChatGPT and Claude, in their real shapes (no one's real data): the AI import plugin's tests
 * (tools/test_vault.ts) and QA use them.
 *
 *   node tools/fixtures/ai-import/make.ts <dir>     writes chatgpt-export.zip and claude-export.dms (a zip, named the
 *                                                    way Claude's downloads sometimes are) into <dir>
 *
 * ChatGPT's: a chat with an edited prompt and a retried answer (branches), two models, an image, thinking, a memory
 * saved during the chat, the custom instructions and the memory list (hidden context messages); a chat that ran
 * Python, with no title and no current_node; a chat with one message and no answer; and an item that isn't a chat.
 * Claude's: a chat with a retried answer (branches), thinking, an artifact and a change to it, a web search, an
 * attachment with its text and an image without bytes, two models; an older chat with text only, no name, no parents,
 * in a project; an empty chat; projects.json and memories.json.
 */
import fs from "node:fs"
import path from "node:path"
import { zipFiles } from "../../../plugins/core/ai-import/zip.ts"

const T = Date.UTC(2026, 8, 20, 16, 0, 0) / 1000 // 2026-09-20 16:00 UTC, in seconds (ChatGPT's unit)

/** ChatGPT's mapping node. */
const node = (id: string, parent: string | null, children: string[], message: Record<string, unknown> | null) => ({ id, parent, children, message })
const msg = (id: string, role: string, t: number, content: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, author: { role, name: extra.name ?? null, metadata: {} }, create_time: t, update_time: null, content, status: "finished_successfully",
    end_turn: true, weight: 1, metadata: extra.metadata ?? {}, recipient: extra.recipient ?? "all", channel: null })
const text = (...parts: unknown[]) => ({ content_type: "text", parts })

export function chatgptConversations(updated = 0) {
  const trip = {
    title: "Trip to Lisbon", create_time: T, update_time: T + 600 + updated, conversation_id: "6700aaaa-0000-4000-8000-000000000001",
    id: "6700aaaa-0000-4000-8000-000000000001", current_node: "a4", default_model_slug: "gpt-4o", is_archived: false,
    mapping: {
      root: node("root", null, ["sys"], null),
      sys: node("sys", "root", ["ctx"], msg("sys", "system", T, text(""), { metadata: { is_visually_hidden_from_conversation: true } })),
      ctx: node("ctx", "sys", ["mem"], msg("ctx", "user", T, { content_type: "user_editable_context",
        user_profile: "The user provided the following information about themselves. This user profile is shown to you in all conversations they have.\nUser profile:\n```I'm a designer living in Porto. I have a dog named Biscuit.```",
        user_instructions: "The user provided the additional info about how they would like you to respond:\n```Prefer concise answers with bullet points.```" },
        { metadata: { is_visually_hidden_from_conversation: true, is_user_system_message: true } })),
      mem: node("mem", "ctx", ["u1"], msg("mem", "system", T, { content_type: "model_editable_context",
        model_set_context: "1. [2025-01-02]. Prefers metric units.\n2. [2025-02-03]. Works as a product designer at Lighthouse." },
        { metadata: { is_visually_hidden_from_conversation: true } })),
      u1: node("u1", "mem", ["a1"], msg("u1", "user", T + 10, { content_type: "multimodal_text", parts: [
        { content_type: "image_asset_pointer", asset_pointer: "file-service://file-Img001", size_bytes: 68, width: 1, height: 1 },
        "Plan a weekend in Lisbon. This is the beach I liked."] })),
      a1: node("a1", "u1", ["t1"], msg("a1", "assistant", T + 20, { content_type: "thoughts", thoughts: [{ summary: "Planning", content: "Two days, walkable." }] },
        { metadata: { model_slug: "gpt-4o" } })),
      t1: node("t1", "a1", ["b1"], msg("t1", "assistant", T + 25, text("# Day 1\n\nWalk Alfama.\n\n```\n# not a heading\n```\n\n## Day 2\n\nBelém, and the beach \ue200cite\ue202turn0search1\ue201."),
        { metadata: { model_slug: "gpt-4o" } })),
      b1: node("b1", "t1", ["b2"], msg("b1", "assistant", T + 26, { content_type: "code", language: "unknown", text: "Is planning a trip to Lisbon in October." },
        { recipient: "bio", metadata: { model_slug: "gpt-4o" } })),
      b2: node("b2", "b1", ["u2old", "u2"], msg("b2", "tool", T + 27, text("Model set context updated."), { name: "bio" })),
      // The prompt was edited: the old one and its answer are a branch.
      u2old: node("u2old", "b2", ["a2old"], msg("u2old", "user", T + 30, text("What about Porto?"))),
      a2old: node("a2old", "u2old", [], msg("a2old", "assistant", T + 40, text("Porto is three hours north."), { metadata: { model_slug: "gpt-4o" } })),
      u2: node("u2", "b2", ["a3", "a4"], msg("u2", "user", T + 300, text("What about Sintra?"))),
      // The answer was retried: a3 is the first try, a4 the one shown.
      a3: node("a3", "u2", [], msg("a3", "assistant", T + 310, text("Sintra is a day trip (first try)."), { metadata: { model_slug: "gpt-4o" } })),
      a4: node("a4", "u2", [], msg("a4", "assistant", T + 600, text("Sintra makes a good day trip: take the train from Rossio."), { metadata: { model_slug: "o3" } })),
    },
  }
  const py = {
    title: null, create_time: T + 3600, update_time: T + 3700, id: "6700aaaa-0000-4000-8000-000000000002",
    mapping: {
      r: node("r", null, ["u"], null),
      u: node("u", "r", ["c"], msg("u", "user", T + 3600, text("What's 2 to the 20th?"))),
      c: node("c", "u", ["o"], msg("c", "assistant", T + 3610, { content_type: "code", language: "python", text: "print(2 ** 20)" },
        { recipient: "python", metadata: { model_slug: "gpt-4o-mini" } })),
      o: node("o", "c", ["f"], msg("o", "tool", T + 3611, { content_type: "execution_output", text: "1048576" }, { name: "python" })),
      f: node("f", "o", [], msg("f", "assistant", T + 3620, text("It's 1,048,576."), { metadata: { model_slug: "gpt-4o-mini" } })),
    },
  }
  const lonely = {
    title: "Unanswered", create_time: T + 7200, update_time: T + 7200, id: "6700aaaa-0000-4000-8000-000000000003", current_node: "u",
    mapping: { r: node("r", null, ["u"], null), u: node("u", "r", [], msg("u", "user", T + 7200, text("hello?"))) },
  }
  return [trip, py, lonely, { foo: 1 }]
}

/** A 1x1 PNG. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")

export function chatgptExport(updated = 0) {
  return zipFiles({
    "conversations.json": JSON.stringify(chatgptConversations(updated)),
    "user.json": JSON.stringify({ id: "user-x", email: "alice@example.com" }),
    "message_feedback.json": "[]",
    "chat.html": "<html><body>made up</body></html>",
    "file-Img001-beach.png": PNG,
  })
}

const C = "2026-09-21T10:00:00.000000Z"
const at = (min: number) => new Date(Date.parse(C) + min * 60_000).toISOString()
const cmsg = (uuid: string, parent: string, sender: string, min: number, content: unknown[], extra: Record<string, unknown> = {}) =>
  ({ uuid, text: "", content, sender, created_at: at(min), updated_at: at(min), attachments: [], files: [], parent_message_uuid: parent, ...extra })
const ROOT = "00000000-0000-4000-8000-000000000000"

export function claudeConversations() {
  const recipes = {
    uuid: "c1aude00-0000-4000-8000-000000000001", name: "Recipe ideas", summary: "", created_at: at(0), updated_at: at(30), model: "claude-sonnet-4-5",
    account: { uuid: "acc" },
    chat_messages: [
      cmsg("m1", ROOT, "human", 0, [{ type: "text", text: "Ideas for dinner with what's in this list?" }], {
        attachments: [{ file_name: "pantry.txt", file_type: "text/plain", file_size: 30, extracted_content: "rice\nbeans\n```\ntomatoes" },
          { file_name: "cookbook.pdf", file_type: "application/pdf", file_size: 9000, extracted_content: "A long cookbook page. ".repeat(300) }],
        files: [{ file_uuid: "f1", file_name: "fridge.jpg" }] }),
      cmsg("m2", "m1", "assistant", 1, [
        { type: "thinking", thinking: "Rice and beans: a bowl." },
        { type: "text", text: "# A bowl\n\nRice, beans and tomatoes." },
        { type: "tool_use", name: "artifacts", input: { id: "list", type: "text/markdown", title: "Shopping list", command: "create", content: "- Limes\n- Cilantro" } },
        { type: "tool_use", name: "web_search", input: { query: "rice bowl recipes" } },
        { type: "tool_result", name: "web_search", content: [{ type: "knowledge", title: "Rice bowls", url: "https://example.com/bowls" }] },
        { type: "tool_result", name: "web_fetch", content: [{ type: "text", text: `${"A fetched page. ".repeat(400)}The end of the page.` }] },
      ]),
      cmsg("m3", "m2", "human", 5, [{ type: "text", text: "Make it spicy." }]),
      // Retried: m4 the first try, m5 the one shown (newest).
      cmsg("m4", "m3", "assistant", 6, [{ type: "text", text: "Add chili (first try)." }]),
      cmsg("m5", "m3", "assistant", 30, [
        { type: "tool_use", name: "artifacts", input: { id: "list", command: "update", old_str: "- Limes", new_str: "- Limes\n- Chili" } },
        { type: "text", text: "Added chili to the list." },
      ], { model: "claude-opus-4-1" }),
    ],
  }
  const old = {
    uuid: "c1aude00-0000-4000-8000-000000000002", name: "", created_at: at(60), updated_at: at(62), project_uuid: "p1000000-0000-4000-8000-000000000001",
    chat_messages: [
      { uuid: "o1", text: "When do I plant tomatoes?", sender: "human", created_at: at(60) },
      { uuid: "o2", text: "After the last frost.", sender: "assistant", created_at: at(61) },
    ],
  }
  const empty = { uuid: "c1aude00-0000-4000-8000-000000000003", name: "Nothing", created_at: at(90), updated_at: at(90), chat_messages: [] }
  return [recipes, old, empty]
}

export function claudeExport() {
  return zipFiles({
    "conversations.json": JSON.stringify(claudeConversations()),
    "projects.json": JSON.stringify([{ uuid: "p1000000-0000-4000-8000-000000000001", name: "Garden planning", description: "A small garden on the balcony.",
      is_private: true, created_at: at(0), updated_at: at(10), prompt_template: "Answer as a gardener.\n\n# Units\n\nMetric.",
      docs: [{ uuid: "d1", filename: "beds.md", content: "# Beds\n\nTwo beds, one meter each.", created_at: at(0) }] }]),
    "users.json": JSON.stringify([{ uuid: "acc", full_name: "Alice Park", email_address: "alice@example.com" }]),
    "memories.json": JSON.stringify([{
      conversations_memory: "**Work context**\n\nThe user is a product designer at Lighthouse. The user prefers short answers without preamble.\n\n**Personal context**\n\n- Lives in Porto\n- Has a dog named Biscuit",
      project_memories: { "p1000000-0000-4000-8000-000000000001": "The balcony gets afternoon sun." },
      account_uuid: "acc",
    }]),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) { console.error("usage: node tools/fixtures/ai-import/make.ts <dir>"); process.exit(1) }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "chatgpt-export.zip"), chatgptExport())
  fs.writeFileSync(path.join(dir, "claude-export.dms"), claudeExport())
  console.log(`wrote ${dir}/chatgpt-export.zip and ${dir}/claude-export.dms`)
}
