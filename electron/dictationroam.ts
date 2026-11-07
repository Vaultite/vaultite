// Where dictated words land when it stops: the field in front, else the one it started in, else the clipboard and the
// inbox, so words said are never lost. The helper's (helper.ts) with its asks stood in by tests. No Electron.
import { joinText } from "../core/dictationtext.ts"

export type InFront = { field?: boolean; secure?: boolean; vaultite?: boolean; editable?: boolean; before?: string; name?: string; bundle?: string }
/** `text`: what went into another app's field, as it went in (joined to what was before it). */
export type Landed = { to: "page" | "front" | "origin" | "clipboard"; name?: string; how?: string; kept?: boolean; text?: string }
export type Landing = {
  /** The focused window's own target takes them (a note, a terminal, a field); `elsewhere`: its page hasn't the keyboard
   *  (a web pane does). Null: no window of ours in front. */
  page: (text: string) => Promise<{ ok: boolean; elsewhere?: boolean } | null>
  front: () => Promise<InFront>
  insert: (text: string) => Promise<{ ok?: boolean; how?: string }>
  origin: (text: string) => Promise<{ ok: boolean; name?: string; text?: string; how?: string }>
  copy: (text: string) => void
  /** Kept in the inbox; false: it couldn't be. */
  capture: (text: string) => Promise<boolean>
  /** A private app's: not to be kept in the vault. */
  secret: (front: InFront) => boolean
}

export async function land(text: string, o: Landing): Promise<Landed> {
  const page = await o.page(text).catch(() => null)
  if (page?.ok) return { to: "page" }
  const f = await o.front().catch((): InFront => ({}))
  const open = f.vaultite ? !!page?.elsewhere && !!f.editable : !!f.field
  if (open && !f.secure) {
    const words = joinText(f.before ?? "", text), r = await o.insert(words).catch(() => null)
    if (r?.ok) return { to: "front", name: f.name, how: r.how, ...(f.vaultite ? {} : { text: words }) }
  }
  const back: Awaited<ReturnType<Landing["origin"]>> = await o.origin(text).catch(() => ({ ok: false }))
  if (back.ok) return { to: "origin", name: back.name, ...(back.text ? { text: back.text } : {}), ...(back.how ? { how: back.how } : {}) }
  o.copy(text)
  return { to: "clipboard", kept: !o.secret(f) && await o.capture(text).catch(() => false) }
}

/** What it says of where they went; "" where the user is already looking. */
export function landedSaid(l: Landed, startedIn?: string) {
  if (l.to === "page") return ""
  if (l.to === "front") return l.name && startedIn && l.name !== startedIn ? `In ${l.name}` : ""
  if (l.to === "origin") return l.name ? `Back in ${l.name}` : "Where you started"
  return l.kept ? "Copied, and in your inbox" : "Copied"
}
