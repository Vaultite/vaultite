## Archive
Archiving a file moves it into `.archive/` inside its own folder (`People/.archive/Old friend.md`) and sets
`archived: true`; unarchiving moves it back and removes the key. Links to it are rewritten both ways.
- `vau archive <file>`, `vau unarchive <file>`; `PUT /api/<collection>/<id> {"archived": true}` (or `false`) moves an
  item too.
- The app indexes `.archive/` folders: archived files open, their links resolve, history keeps them. Tools that skip
  dot folders don't see them.
- A file archived by hand (the key written, not moved) stays put: `vau archive tidy` moves those (`--dry` lists them).
- The file tree hides `.archive/` folders unless "Show archived files" is on (its header, or File explorer's settings), hidden files shown or not; an archived file shows there only while it's the open file.
