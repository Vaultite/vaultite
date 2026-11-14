import { entryOf, openLiterature } from "./client.ts"
import { safeHtml } from "./safe.ts"
import type { EntryAnswer } from "./wire.ts"

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text) e.textContent = text
  return e
}

function link(label: string, href: string) {
  const a = el("a", "vau-cite-action", label)
  a.href = href
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  return a
}

function fill(box: HTMLElement, key: string, e: EntryAnswer) {
  box.textContent = ""
  if (!e.found) {
    box.append(el("div", "vau-cite-none", `@${key} isn't in your library`))
    return
  }
  const ref = el("div", "vau-cite-ref")
  ref.innerHTML = safeHtml(e.html)
  const actions = el("div", "vau-cite-actions")
  const note = el("button", "vau-cite-action", e.note ? "Literature note" : "New literature note")
  note.type = "button"
  note.addEventListener("mousedown", (ev) => ev.preventDefault())
  note.addEventListener("click", () => { void openLiterature(e.key) })
  actions.append(note)
  if (e.links.doi) actions.append(link("DOI", e.links.doi))
  else if (e.links.url) actions.append(link("Web page", e.links.url))
  if (e.links.zotero) actions.append(link("Show in Zotero", e.links.zotero))
  const from = el("div", "vau-cite-from", [`@${e.key}`, e.from].filter(Boolean).join(" · "))
  box.append(ref, actions, from)
}

export function citationCard(keys: string[], path: string): HTMLElement {
  const card = el("div", "vau-cite-card")
  card.dataset.citeCard = keys.join(" ")
  for (const key of keys.slice(0, 8)) {
    const box = el("div", "vau-cite-entry")
    box.append(el("div", "vau-cite-loading", "Loading…"))
    card.append(box)
    void entryOf(key, path).then((e) => fill(box, key, e), () => { box.textContent = "Couldn't load this reference" })
  }
  return card
}
