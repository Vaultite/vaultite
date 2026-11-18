import { type Session, sessions } from "./shared.ts"
import { listChanged } from "./list.ts"

const LET_GO_AFTER = 30_000
export const blockedIds = new Set<string>()

export function letGoUnwatched(s: Session, after = LET_GO_AFTER) {
  clearTimeout(s.unwatched)
  if (s.clients.size || !s.backend.events) return
  s.unwatched = setTimeout(() => {
    if (s.clients.size || sessions.get(s.id) !== s) return
    clearTimeout(s.stall)
    sessions.delete(s.id)
    if (s.blocked) blockedIds.add(s.id)
    s.link.close()
    listChanged()
  }, after)
  s.unwatched.unref?.()
}
