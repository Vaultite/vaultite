// Moving the app into Applications from its disk image (main.ts offerMove), apart from the Mac (tested alone): what's
// done about a copy of it already there. Only one that's no newer and isn't running is replaced without a word.
import { compareVersions } from "../core/version.ts"

/** The copy already in Applications: its version (null: unread) and whether it's running. */
export type There = { version: string | null; running: boolean }
/** Replace it; ask first (`buttons`: keeping it, then replacing it); or say why it can't be done now. */
export type Conflict = { kind: "replace" } | { kind: "ask" | "say"; message: string; detail: string; buttons?: [string, string] }

/** What to do about `there`, this copy being `name` `mine` (its version). */
export function moveConflict(name: string, mine: string, there: There): Conflict {
  if (there.running) return { kind: "say", message: `${name} is already open from Applications`,
    detail: `Quit it, then open this copy again to move it there. This copy runs from the disk image meanwhile.` }
  const cmp = there.version ? compareVersions(there.version, mine) : null
  if (cmp === null) return { kind: "ask", message: `Replace the ${name} in Applications?`,
    detail: `Its version can't be read, so it may be newer than this one (${mine}).`, buttons: ["Keep it", "Replace it"] }
  if (cmp > 0) return { kind: "ask", message: `A newer ${name} is in Applications`,
    detail: `It's ${there.version}, this copy is ${mine}: replacing it goes back to ${mine}.`, buttons: ["Keep the newer one", "Replace it"] }
  return { kind: "replace" }
}

/** A bundle's version, from its Info.plist's text (XML, as electron-builder writes it); null if it says none. */
export function plistVersion(plist: string): string | null {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1].trim() || null
}
