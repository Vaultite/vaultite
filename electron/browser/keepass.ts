// A KeePass file opened, and the agents' (agents.kdbx, the user's KeeShare export): its entries and, only as the app fills
// them, an entry's secrets. Run in the passwords process (kdbxproc.ts), never the main one.
import { argon2 } from "./argon2.ts"
import { CryptoEngine, Credentials, Kdbx, KdbxError, ProtectedValue, type KdbxEntry, type KdbxGroup } from "./kdbx/index.ts"
import { messageOf } from "./messageof.ts"
import { otpOf, type Otp } from "./otp.ts"

CryptoEngine.setArgon2Impl(argon2)

/** The tag (KeePassXC's Tags field) that lets agents use an entry without asking the user each time. */
export const FREE_TAG = "agent-free"

/** An entry as logins.ts lists it: never a secret. */
export type Entry = { id: string; title: string; username: string; urls: string[]; free: boolean; expired: boolean; otp: boolean }
export type Secrets = { username: string; password: string; otp: Otp | "steam" | null }
export type Database = { entries: Entry[]; secrets: (id: string) => Secrets | null }

const text = (v: unknown) => (v instanceof ProtectedValue ? v.getText() : typeof v === "string" ? v : "")
export const fieldsOf = (e: KdbxEntry) => Object.fromEntries([...e.fields].map(([k, v]) => [k, text(v)]))

/** An entry's addresses: URL, then KeePassXC's further ones (KP2A_URL, KP2A_URL_1...). */
export const urlsOf = (f: Record<string, string>) => Object.entries(f).filter(([k, v]) => (k === "URL" || /^KP2A_URL(_\d+)?$/.test(k)) && v.trim()).map(([, v]) => v.trim())

/** A KeePass file opened with its password. Errors say what's wrong, never more (no library text, which might quote the
 *  file). */
export async function loadKdbx(data: Uint8Array, password: string | Uint8Array): Promise<Kdbx> {
  const key = password instanceof Uint8Array ? ProtectedValue.fromBinary(password.slice()) : ProtectedValue.fromString(password)
  try {
    return await Kdbx.load(new Uint8Array(data).buffer, new Credentials(key))
  } catch (e) {
    const code = e instanceof KdbxError ? e.code : "", memory = code === "Unsupported" && /^argon2 memory/.test(messageOf(e))
    throw new Error(code === "InvalidKey" ? "the password doesn't open it" : memory ? "its key settings ask for more than 1 GB of memory to open, more than the app allows"
      : code === "Unsupported" ? "it's a KeePass file this app can't read (a key file or a hardware key?)"
      : "it isn't a KeePass database (.kdbx), or it's damaged")
  }
}

/** The file opened with its password: its entries (the recycle bin's left out). */
export async function openDatabase(data: Uint8Array, password: string | Uint8Array): Promise<Database> {
  const db = await loadKdbx(data, password)
  const bin = db.meta.recycleBinUuid?.id
  const found: KdbxEntry[] = []
  const walk = (g: KdbxGroup) => {
    if (bin && g.uuid.id === bin) return
    found.push(...g.entries)
    for (const sub of g.groups) walk(sub)
  }
  walk(db.getDefaultGroup())
  const byId = new Map(found.map((e) => [e.uuid.id, e]))
  const now = Date.now()
  return {
    entries: found.map((e) => {
      const f = fieldsOf(e)
      return {
        id: e.uuid.id, title: f.Title ?? "", username: f.UserName ?? "",
        urls: urlsOf(f),
        free: e.tags.some((t) => t.trim().toLowerCase() === FREE_TAG),
        expired: !!e.times.expires && !!e.times.expiryTime && e.times.expiryTime.getTime() < now,
        otp: otpOf(f) !== null,
      }
    }),
    secrets: (id) => {
      const e = byId.get(id)
      if (!e) return null
      const f = fieldsOf(e)
      return { username: f.UserName ?? "", password: f.Password ?? "", otp: otpOf(f) }
    },
  }
}
