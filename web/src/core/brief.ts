const MAX = 80, CODE = /`[^`]*`/g, HIDDEN = "∶"

export function brief(text: string | undefined, values: string[] = []) {
  let t = (text ?? "").trim().replace(CODE, (m) => m.replace(/[:;.]/g, HIDDEN))
  for (let was = ""; was !== t;) { was = t; t = t.replace(/\s*\([^()]*\)/g, "") }
  const [first, ...rest] = t.split(/(?<=[\w'"%`])(?:[.:;!?] | — )/)
  t = first.replace(/[.:,]$/, "")
  if (t.length > MAX) {
    const at = t.slice(0, MAX).search(/,[^,]*$/)
    if (at > 24) t = t.slice(0, at)
  }
  if (rest.length && values.some((v) => t.toLowerCase().startsWith(v.toLowerCase()))) return ""
  t = t.replaceAll(HIDDEN, ":").replace(/`/g, "")
  return t && t[0].toUpperCase() + t.slice(1)
}
