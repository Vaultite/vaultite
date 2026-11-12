// PUT /api/file: the vault's route and an outside file's both plan a save here, as web/src/core/autosave.ts sends it.
import { z } from "zod"
import { merge3 } from "../textedit.ts"
import { applyEdit, textHash } from "../texthash.ts"

export const TextEdit = z.object({ at: z.int().nonnegative(), cut: z.int().nonnegative(), add: z.string() })

/** `lean`: answer only how the file differs from what was sent. */
export const SaveBody = z.object({
  path: z.string().optional(),
  text: z.string().optional(),
  base: z.string().nullable().optional(),
  baseHash: z.string().optional(),
  edit: TextEdit.optional(),
  lean: z.boolean().optional(),
})
export type SaveBody = z.infer<typeof SaveBody>

/** changed: its base isn't on disk, so send the base (412); write: `sent` is the text before merging. */
export type SavePlan = { kind: "gone" } | { kind: "changed" } | { kind: "bad"; why: string } | { kind: "conflict" } | { kind: "write"; text: string; sent: string }

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse at the boundary
export function saveBody(raw: unknown): { ok: true; body: SaveBody } | { ok: false; why: string } {
  const r = SaveBody.safeParse(raw)
  if (r.success) return { ok: true, body: r.data }
  const at = r.error.issues[0]?.path[0]
  return { ok: false, why: at === "edit" ? BAD_EDIT : at === "text" ? "text must be a string" : `${String(at)}: ${r.error.issues[0]?.message}` }
}
const BAD_EDIT = "edit is {at, cut, add}, an edit of the text whose baseHash is sent"

export function planSave(cur: string | null, body: SaveBody & { text: string }): SavePlan {
  const base = body.base ?? null, baseHash = body.baseHash ?? null
  if (cur === null && (base !== null || baseHash !== null)) return { kind: "gone" }
  if (cur !== null && base === null && baseHash !== null && (body.edit !== undefined || cur !== body.text) && textHash(cur) !== baseHash) return { kind: "changed" }
  let text = body.text
  if (body.edit !== undefined) {
    const made = cur !== null && baseHash !== null ? applyEdit(cur, body.edit) : null
    if (made === null) return { kind: "bad", why: BAD_EDIT }
    text = made
  }
  const sent = text
  if (cur !== null && base !== null && cur !== base && cur !== text) {
    const merged = merge3(base, text, cur)
    if (merged === null) return { kind: "conflict" }
    text = merged
  }
  return { kind: "write", text, sent }
}
