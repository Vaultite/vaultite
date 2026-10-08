// How a note looks when opened: its kind (and an idea's status) on the line above the title. Read from the frontmatter
// as it is in the editor.
import { tagsOf, type FileCtx } from "@vaultite"
import { isJournal, kindOf, lookOf, STATUS } from "./format"

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v))

export function StatusPill({ status }: { status?: string | null }) {
  const s = STATUS[status ?? ""]
  if (!s) return null
  return (
    <span className="rounded-full px-2 py-0.5 text-[13px] leading-[18px] font-medium whitespace-nowrap"
      style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}>
      {s.label}
    </span>
  )
}

export function NoteKicker({ fm, body }: FileCtx) {
  // Journal for a note tagged journal (as typed: frontmatter or inline), else its kind.
  const k = lookOf(fm.kind, isJournal(tagsOf(fm, body)))
  return (
    <span className="flex items-center gap-2">
      {k.label}
      {str(fm.kind) === "idea" && <StatusPill status={str(fm.status)} />}
    </span>
  )
}

/** For the Plugins page: a made-up note, as it looks when opened. */
export function NotePreview() {
  const k = kindOf("idea")
  return (
    <article className="p-5">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--notes)" }}>
        <k.icon className="size-[18px]" strokeWidth={2.25} />{k.label}<StatusPill status="exploring" />
      </div>
      <h1 className="text-[28px] leading-[34px] font-bold">Voice-first journaling</h1>
      <div className="mt-5 space-y-3 text-[17px] leading-[26px]">
        <p>Talk through the day on the walk home; Claude turns it into a journal entry and links the people in it.</p>
        <p>Ties into <span style={{ color: "var(--notes)" }} className="font-medium">Vaultite</span> and the daily plan.</p>
      </div>
    </article>
  )
}
