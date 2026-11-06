## Sync conflicts
When two devices change a file in iCloud Drive at once, iCloud shows one version and keeps the other apart, out of
sight (macOS's unresolved conflict versions; Finder never shows them). On a Mac whose vault is in iCloud Drive, this
machine looks for them (the whole vault every 10 minutes, a changed file a moment after) and the app says so at the
top of the note: merge it in (clean, merged and saved; where both changed the same lines, settled in place) or keep the
note as it is. Only then is the version resolved, never removed: its text goes to the note's File history first.
- `vau conflicts` (`--scan` to look again now) lists the files that have some; `vau sync-conflicts.read <file>` their
  text. Agents don't settle them: the user does, in the note.
- `GET /api/sync-conflicts/versions?path=` (each version's `id`, `at`, `from`, `label`, `text`, `base` from File
  history and `merge`: same, clean, clashes or none); `POST /api/sync-conflicts/resolve {"path", "id"}`, owner only.
