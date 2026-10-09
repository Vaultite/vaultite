## AI import (`Chats/<ChatGPT|Claude>/<YYYY-MM-DD> <Title>.md`)
ChatGPT's and Claude's official exports, imported: `POST /api/ai-import` with the zip (or its conversations.json) as
the body (`?minMessages=1&images=true&folder=Chats`), or `{"path": "<a zip in the vault>"}`; `vau import <zip>` (a file
on this computer); the op `ai-import.run` (an export already in the vault); or "Import from ChatGPT or Claude…" in the app. It answers a job (`GET /api/ai-import/jobs/<id>`: `state` queued, running,
done or failed, `chats`, `created`, `updated`, `unchanged`, `skipped`, `memories`, `review`). A chat is one file:
````
---
type: chat
source: chatgpt                # chatgpt | claude
ext_id: chatgpt-6700aaaa-...   # the export's id: importing again updates this file, never a second one
models: [gpt-4o, o3]
project: '[[Chats/Claude/Projects/Garden planning|Garden planning]]'   # Claude, when it's in a project
messages: 6
url: https://chatgpt.com/c/6700aaaa-...
created: '2026-09-20 16:00:00'  # UTC
updated: '2026-09-20 16:10:00'
---

Your own notes about it go here, above the transcript.

## You · 2026-09-20 09:00

The prompt.

## ChatGPT · 09:00

The answer (its own headings moved two levels down; thinking, tool calls and outputs as folded callouts).
````
- Every `## ` heading of a chat is a turn. A re-import rewrites the importer's keys and the turns, and keeps what's
  above the first turn and any key it doesn't write. Don't edit a transcript by hand: write about it above it, or in
  a note linking it. Claude's projects are `type: chat-project` notes in `Chats/Claude/Projects/`.
- Memories are never written straight into `ME.md` or `People/`. They go to `Chats/<AI>/Memories to review.md`
  (`type: memory-review`): one task per memory, `- [ ] **Me** · Lives in Porto.`, the bold label saying where it
  goes (`Me`: About me; `How to work with me`; or a person's name as in People/). The user ticks the ones to keep and
  fixes labels; then the op `ai-import.apply` (`vau ai-import.apply "Chats/ChatGPT/Memories to review.md"`, or Add in its
  card) adds the ticked ones with `people.remember` (MCP's `remember`) and moves them under `## Added`; one that can't be added stays ticked
  with why under it. Don't tick memories for the user.
- Nothing is cut: ChatGPT's images go into `Chats/ChatGPT/Attachments/`, and an attachment or a project's file too long
  to read inline (over 4000 characters) becomes a text file there, linked from its turn (embedded in a project's note).
  Its settings are below.
