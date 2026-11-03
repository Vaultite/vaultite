// Apps agents never see (the screen plugin's private_apps, its manifest the starting list): no text, no picture, not even
// their window titles. For the desktop app's helper and the server alike (no Node).

/** Whether an app (its bundle id and name) is on the list, by name or bundle id, in any case; `com.1password.*` covers
 *  a vendor's. */
export function privateApp(a: { bundle?: string; name?: string }, list: readonly string[]) {
  const bundle = (a.bundle ?? "").toLowerCase(), name = (a.name ?? "").toLowerCase()
  return list.some((x) => {
    const e = x.trim().toLowerCase()
    if (!e) return false
    if (e.endsWith(".*")) return bundle.startsWith(e.slice(0, -1))
    return e === name || e === bundle
  })
}
