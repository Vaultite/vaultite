type At = { at: number }
export function dueAt(o: { profiles: string[]; read: boolean; cookies: Map<string, At & { in: boolean }>; cookiesFor: number; orgs: Map<string, At>; next: Map<string, At>; prs: number }) {
  let at = o.prs
  for (const p of o.profiles) {
    const c = o.cookies.get(p)
    at = Math.min(at, (c?.at ?? 0) + o.cookiesFor, c?.in && o.read ? o.orgs.get(p)?.at ?? 0 : Infinity)
  }
  for (const n of o.next.values()) at = Math.min(at, n.at)
  return at
}
