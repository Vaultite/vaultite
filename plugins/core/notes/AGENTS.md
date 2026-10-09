## Notes (`Notes/<Title>.md`)
Ideas, longer notes and journal entries. `POST /api/notes {"ext_id", "title", "body", "kind", "status", "tags"}`
(upserts on `ext_id`), or write the file:
```
---
type: note
kind: idea                  # idea | note
status: seed                # ideas only: seed | exploring | parked | done
tags: [Product]
id: idea-voice-journal      # stable, unique, lowercase with dashes; never change it
created: '2026-09-28 18:00:00'   # UTC; bump updated when you edit
updated: '2026-09-28 18:00:00'
---

Markdown: ## headings, bullets, **bold** for key claims. No "# Title" line: the file name is the title.
```
- A brain-dumped idea is `kind: idea`, `status: seed` (`exploring` if the user is on it). A journal entry is a note
  tagged `Journal`. A smaller idea belonging to a bigger one is its own note linking `[[Bigger note]]`.
- Titles can't contain `: / \ ? * " < > | # ^ [ ]`: use " -" for a colon and put the real title in
  `aliases: ['Real: title']`.

- A journal entry: `tags: [Journal]` or `#journal` in its text, any case.
- Plain Markdown in Notes/ (no `type`, no `id`) is a note too, and the app never rewrites it; its id is its title's
  (`note-<slug>`). A note with `type: note` gets its `id` and dates filled in when it's edited in the app (or made by it). A new one may be "Untitled" until renamed.
- Don't edit a bigger note when adding a smaller idea to it: link it.
- Bodies can use Markdown's extras: callouts (`> [!tip] Title`, `[!warning]-` folded), footnotes (`[^1]` and
  `[^1]: text`), math (`$x^2$`, `$$ ... $$`), ```mermaid diagrams, fenced code with its language, `<details>`.
