// A pinned list changed one pin at a time, applied to the list as it is then, so a device with an old copy never brings
// back a page unpinned elsewhere. An entry is a path, a heading or block in a note, or a search. Pure: both sides.

/** A search pinned: "search:<query>". */
export const SEARCH = "search:"
/** What an entry is: a file, a heading (or block) in a note, or a search. */
export function pinKind(entry: string): { file: string; heading?: string } | { search: string } {
  if (entry.startsWith(SEARCH)) return { search: entry.slice(SEARCH.length) }
  const m = /^(.*?\.md)#(.+)$/i.exec(entry)
  return m ? { file: m[1], heading: m[2] } : { file: entry }
}
/** The file an entry is in (null: a search). */
export const pinFile = (entry: string) => { const k = pinKind(entry); return "file" in k ? k.file : null }
/** The entry with its file moved to `file` (a search as it is). */
export const withPinFile = (entry: string, file: string) => { const k = pinKind(entry); return "file" in k ? (k.heading ? `${file}#${k.heading}` : file) : entry }

/** `list` with `path` pinned (at the end, or before `before`: moved there when it's pinned already and `before` is
 *  given; null or a page not in the list: the end) or unpinned (`on` false). */
export function placePin(list: string[], path: string, on: boolean, before?: string | null): string[] {
  const rest = list.filter((p) => p !== path)
  if (!on) return rest
  if (list.includes(path) && before === undefined) return list
  const i = before ? rest.indexOf(before) : -1
  return i < 0 ? [...rest, path] : [...rest.slice(0, i), path, ...rest.slice(i)]
}

/** `list` after a file or folder moved from `src` to `dst` (null: to the trash): its pins follow it (its headings'
 *  too), each once. */
export function repinList(list: string[], src: string, dst: string | null): string[] {
  const out: string[] = []
  for (let p of list) {
    const f = pinFile(p)
    if (f !== null && (f === src || f.startsWith(src + "/"))) {
      if (dst === null) continue
      p = withPinFile(p, dst + f.slice(src.length))
    }
    if (!out.includes(p)) out.push(p)
  }
  return out
}
