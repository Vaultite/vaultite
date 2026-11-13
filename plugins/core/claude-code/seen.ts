import { get, splitMachine } from "@vaultite"

export type Seen = { title: string; cwd: string; model: string }
const key = (id: string) => `vaultite.chat.seen.${id}`
const mem = new Map<string, Seen | null>()

export function seenOf(id: string): Seen | null {
  if (!mem.has(id)) { try { mem.set(id, JSON.parse(localStorage.getItem(key(id)) ?? "null") as Seen | null) } catch { mem.set(id, null) } }
  return mem.get(id) ?? null
}

export function see(id: string, s: Seen) {
  const was = seenOf(id)
  if (was && was.title === s.title && was.cwd === s.cwd && was.model === s.model) return
  mem.set(id, s)
  try { localStorage.setItem(key(id), JSON.stringify(s)) } catch { /* private mode */ }
}

export async function listedOf(id: string): Promise<Seen | null> {
  const r = await get<{ sessions: { id: string; title?: string; cwd: string; model?: string }[] }>("claude-code/chats")
  const s = r.sessions.find((x) => x.id === id || splitMachine(x.id)[0] === splitMachine(id)[0])
  return s && (s.title || s.cwd) ? { title: s.title ?? "", cwd: s.cwd, model: s.model ?? "" } : null
}
