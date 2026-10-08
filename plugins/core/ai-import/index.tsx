// AI import's frontend: the import command with one toast following it, how chats look, and the review list's card.
import { useState } from "react"
import { Brain, MessagesSquare, Upload } from "lucide-react"
import { activeFile, definePlugin, Group, Panel, SettingRow } from "@vaultite"
import { reviewItems } from "./note"
import { applyReview, pickExport } from "./upload"

const TINT = "var(--ai-import)"

function ReviewCard({ path, body }: { path: string; body: string }) {
  const [busy, setBusy] = useState(false)
  const items = reviewItems(body)
  const ticked = items.filter((i) => i.done).length
  const add = async () => { setBusy(true); try { await applyReview(path) } finally { setBusy(false) } }
  return (
    <Panel title="Memories to review" icon={Brain} tint={TINT}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        {items.length
          ? `${items.length} to review, ${ticked} ticked. Ticked ones go into ME.md (About me, or How to work with me) or the person's file in People, by their label.`
          : "Nothing left to review."}
      </p>
      {items.length > 0 && (
        <button type="button" onClick={add} disabled={!ticked || busy} data-memory-add
          className="mt-3 cursor-pointer text-[15px] font-semibold text-primary disabled:cursor-default disabled:text-muted-foreground">
          {busy ? "Adding…" : ticked ? `Add ${ticked} ticked` : "Tick the ones to add"}
        </button>
      )}
    </Panel>
  )
}

/** Its settings sheet: the import itself and how to get an export; its options (folder, short chats, images) are a
 *  form from manifest.json's `settings`, under this. */
function SettingsPanel() {
  return (
    <div>
      <Group>
        <SettingRow label="Import from ChatGPT or Claude…" sub="Their export's zip (or its conversations.json): every chat becomes a note" onClick={pickExport} chevron={Upload} />
      </Group>
      <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">
        ChatGPT: Settings, Data controls, Export data. Claude: Settings, Privacy, Export data. Each emails a link to a zip: download it
        and pick it here. Importing again updates chats that changed and never makes a second copy.
      </p>
    </div>
  )
}

function Preview() {
  return (
    <Panel title="AI import" icon={MessagesSquare} tint={TINT}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Brings your history from ChatGPT and Claude: export your data there, then Import from ChatGPT or Claude in the command palette.
        Every chat becomes a note in Chats, Claude's projects too, and what they remembered about you becomes a list you review: only
        what you tick reaches ME.md or People.
      </p>
    </Panel>
  )
}

const isReview = (path: string) => /(^|\/)Memories to review\.md$/.test(path)

export default definePlugin({
  icon: MessagesSquare,
  files: { types: ["chat", "chat-project", "memory-review"], icon: MessagesSquare, tint: TINT,
    kicker: ({ fm }) => (fm.type === "chat-project" ? "Claude project" : fm.type === "memory-review" ? "Memories to review"
      : `${fm.source === "claude" ? "Claude" : fm.source === "chatgpt" ? "ChatGPT" : "AI"} chat`) },
  commands: [
    { id: "ai-import:import", name: "Import from ChatGPT or Claude…", run: pickExport },
    { id: "ai-import:apply", name: "Add ticked memories", when: () => isReview(activeFile()?.path ?? ""), run: () => { const p = activeFile()?.path; if (p) void applyReview(p) } },
  ],
  fileMenu: (path) => (isReview(path) ? [{ label: "Add ticked memories", icon: Brain, section: "actions", run: () => void applyReview(path) }] : []),
  blocks: {
    // ```block-memory-review: in a review list (or `file:` one), its count and the Add button.
    "memory-review": ({ path, body }) => <ReviewCard path={path} body={body} />,
  },
  settingsPanel: () => <SettingsPanel />,
  preview: () => <Preview />,
})
