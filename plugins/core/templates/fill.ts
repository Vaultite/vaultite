export type Formats = { date: string; time: string }
export const FORMATS: Formats = { date: "YYYY-MM-DD", time: "HH:mm" }

export function fillVars(text: string, title: string, format: (d: Date, fmt: string) => string, now = new Date(), formats = FORMATS) {
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi, (_m, name: string, fmt?: string) => {
    const n = name.toLowerCase()
    if (n === "title") return title
    return format(now, fmt?.trim() || (n === "date" ? formats.date : formats.time))
  })
}

const OWN = new Set(["id", "created", "updated", "added"])

function entries(inner: string) {
  const out: [string, string][] = []
  for (const line of inner.split("\n")) {
    const m = /^([^\s#:][^:]*):(?:\s|$)/.exec(line)
    if (m) out.push([m[1].trim(), line])
    else if (out.length && line.trim()) out[out.length - 1][1] += `\n${line}`
  }
  return out
}

const inner = (fm: string) => { const m = /^---\n([\s\S]*?)\n?---/.exec(fm); return m ? m[1] : "" }

export function mergeFm(file: string, template: string) {
  const have = entries(inner(file))
  const keys = new Set(have.map(([k]) => k))
  const add = entries(inner(template)).filter(([k]) => !keys.has(k) && !OWN.has(k))
  if (!add.length) return file
  const lines = [...have.map(([, l]) => l), ...add.map(([, l]) => l)].join("\n")
  return `---\n${lines}\n---\n${file.replace(/^---\n[\s\S]*?\n?---[ \t]*\n?/, "")}`
}

const FM = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/
export function fromTemplate(text: string, into = "") {
  const fm = FM.exec(text)?.[0] ?? "", own = FM.exec(into)?.[0] ?? ""
  const head = fm ? mergeFm(own, fm) : own, rest = text.slice(fm.length)
  return head + (head ? rest : rest.replace(/^\n+/, ""))
}
