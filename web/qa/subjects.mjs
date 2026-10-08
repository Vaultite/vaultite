// The people and notes a QA script works on, picked from the vault the server runs on, so the scripts name no one:
//   const v = await subjects(B)
//   v.people        every person, with their file's text and what a script may need from it (see below)
//   v.timeline      people whose file has a `## Timeline` with at least one entry (the first ones in the vault's order)
//   v.linked        a note that links both to another note and to a person: { note, idea, person, ideaText, personText }
//                   (the *Text is what the link shows: the alias of [[Target|Alias]], else the target); null if none
//   v.need(x, what) x, or exit with "the vault needs <what>" (a script that can't run on this vault says why)
const enc = encodeURIComponent
const base = (id) => id.split("/").pop()

/** A person file's parts: a plain one-line paragraph of its own (typing at its end is easy to find again), the first
 * timeline entry's "date · kind ·" (canonical separators), and whether it has a want_to property. */
function parsePerson(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)
  const rest = fm ? text.slice(fm[0].length) : text
  const lines = rest.split("\n")
  let fence = false, plain = null
  for (const l of lines) {
    if (/^```/.test(l)) { fence = !fence; continue }
    if (fence) continue
    if (/^#{1,6} /.test(l)) break
    const t = l.trim()
    if (!plain && t.length >= 3 && t === l && /^[\p{L}\p{N}][^*_`[\]<>#|~=]*$/u.test(t) && text.split(t).length === 2) plain = t
  }
  const tl = rest.indexOf("\n## Timeline")
  const m = tl < 0 ? null : rest.slice(tl).match(/\n[-*] (\d{4}-\d{2}-\d{2}) · ([^·\n]+?) · /)
  return { plain, entry: m ? `${m[1]} · ${m[2]} ·` : null, hasWant: /^want_to:/m.test(fm?.[1] ?? "") }
}

export async function subjects(B) {
  const get = async (p) => (await fetch(B + p)).json()
  const [state, tree] = await Promise.all([get("api/state"), get("api/files")])
  const people = await Promise.all(state.people.filter((p) => !p.archived).map(async (p) => {
    const text = (await get(`api/file?path=${enc(`${p.id}.md`)}`)).text ?? ""
    return { ...p, file: base(p.id), path: `${p.id}.md`, text, ...parsePerson(text) }
  }))
  // Link targets, resolved like the app does: notes by title, file name or alias; people by name, file name, alias or
  // a first name only one person has.
  const firsts = {}
  for (const p of people) { const f = p.name.split(" ")[0].toLowerCase(); firsts[f] = (firsts[f] ?? 0) + 1 }
  const aliases = (x) => (Array.isArray(x.aliases) ? x.aliases : String(x.aliases ?? "").split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean)
  const resolve = (target) => {
    const t = target.split("#")[0].trim().toLowerCase()
    const note = state.notes.find((n) => n.title?.toLowerCase() === t || base(n.id).toLowerCase() === t || aliases(n).includes(t))
    if (note) return { note }
    const person = people.find((p) => p.name.toLowerCase() === t || p.file.toLowerCase() === t || aliases(p).includes(t)
      || (!t.includes(" ") && firsts[t] === 1 && p.name.split(" ")[0].toLowerCase() === t))
    return person ? { person } : {}
  }
  const links = (md) => [...md.replace(/```[\s\S]*?```|`[^`\n]*`/g, "").matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
    .map(([, target, alias]) => ({ ...resolve(target), text: (alias ?? target).trim() }))
  let linked = null
  for (const note of state.notes) {
    const ls = links(note.body ?? "")
    const idea = ls.find((l) => l.note && l.note.id !== note.id), person = ls.find((l) => l.person)
    if (idea && person) { linked = { note, idea: idea.note, ideaText: idea.text, person: person.person, personText: person.text }; break }
  }
  const need = (x, what) => {
    if (x) return x
    console.error(`the vault needs ${what}`); process.exit(2)
  }
  return { state, tree, people, timeline: people.filter((p) => p.entry), linked, links, need, get }
}

/** A page's vault path by its name ("Today"): wherever the vault keeps its dashboards (Dashboards/, Personal/Dashboards/). */
export async function pagePath(B, name) {
  const tree = await (await fetch(B + "api/files")).json()
  return tree.files.find((f) => f.type === "dashboard" && f.path.split("/").pop() === `${name}.md`)?.path ?? `Dashboards/${name}.md`
}

/** A page's address by its name ("Today": file/Dashboards%2FToday.md), as the app writes it after the #. */
export const pageHash = async (B, name) => `file/${enc(await pagePath(B, name))}`
