// The sites the demo's Browser shows live (web-viewer's framed.ts) and the playground's note on each (worker.ts). Each
// may be framed, runs no trackers and loads nothing from elsewhere. Not vaultite.com: only it may frame it, and it embeds this.

export type DemoSite = { url: string; title: string; note: string; body: string }

export const SITES: DemoSite[] = [
  {
    url: "https://neodisk.app/", title: "Neodisk", note: "Notes/Neodisk.md",
    body: `---
type: note
kind: note
tags: [Mac]
source: https://neodisk.app/
---

Shows what's filling the disk as a map of blocks, biggest first. Free and open source, and it never deletes anything itself.

- [ ] Find what's taking the laptop's last 20 GB before the [[Lisbon trip]] photos come in
- [ ] Send it to [[Bob Carter]]: his Mac is full again
`,
  },
  {
    url: "https://olimpicos.net/", title: "Olimpicos", note: "Notes/Olimpicos.md",
    body: `---
type: note
kind: note
tags: [Learning]
source: https://olimpicos.net/
---

Olympiad problems with their solutions (maths, physics, informatics and more), by competition and year.

- [ ] One problem a day before work, starting with the IMO's
- [ ] Ask [[Dave Kim]] which Putnam problems he'd try first
`,
  },
]
