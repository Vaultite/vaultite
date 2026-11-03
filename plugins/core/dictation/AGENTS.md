## Dictation
In the Mac desktop app, ⌘J (`dictation:start`) dictates where the cursor is: a note's editor, or a field (the Ask box, a
chat's input); with neither, it opens the Ask box and dictates there. A tap starts and the next stops (it also stops
after `silence` seconds without speech); held, it listens until it's let go. Words not settled yet show dimmed by the
cursor, never in the file (Apple's revises them; Parakeet's are final at once, ~320 ms behind); settled ones are typed in as the user's own input (`userEvent` `input.dictation`), so the
note only ever holds final text. Browsers and phones don't have it.
- Settings (`.vaultite/plugins/dictation/data.json`): `engine` `auto` | `apple` | `parakeet`, `language` (Apple's,
  `pt-BR`; the Mac's when left out), `silence` (seconds, 0 never). Apple's is macOS 26's on-device recognizer. Parakeet
  (English) is parakeet-unified-en-0.6b run by transcribe.cpp, from the GGUF Handy or Hex downloaded (Hex's
  `~/Library/Application Support/hex/models/`, Hugging Face's cache, Handy's), used where it is; `auto` picks it when
  it's there and the language is English.
- For plugins: `onDictation((event, { view, path }) => …)` hears a session (start, speech, pending, final, pause 700/2000
  ms, end); `speakingIn(view)` says the user is mid-sentence there. The companion holds while they speak and hears them
  at their pauses.
