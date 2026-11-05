## Dictation
In the Mac desktop app, ⌘J (`dictation:start`) dictates where the cursor is: a note's editor, or a field (the Ask box, a
chat's input); with neither, it says so and hears nothing. The dictation keys do the same in the window, and in any
other app (`fn`, Dictate anywhere, on by default): into its field, never elsewhere (talking to the companion is its own
Talk keys', the companion's setting `keys`: a key in both talks). `keys` picks them, each alone (default `fn`; also
`right_option`, `right_command`, `double_control`; with another key it's only what it always was): a tap starts and the next stops; held, it listens until it's let go. A
double Control only toggles (macOS's own Keyboard, Dictation, Shortcut as Control twice gets a notice to set it to Off).
Words not settled yet show dimmed by the cursor, never in the file; at each pause they settle and are typed in as the
user's own input (`userEvent` `input.dictation`), so the note only ever holds final text. Browsers and phones don't have
it.
- Settings (`.vaultite/plugins/dictation/data.json`): `engine` `auto` | `apple` | `parakeet`; `language` (Apple's,
  `pt-BR`; the Mac's when left out); `silence` (seconds without speech before a tapped dictation stops; 0, the default,
  never); `replacements`, lines of "said: written" (`at Claude: @claude`), whose said words the recognizer listens for;
  `keep_audio` (this Mac's), the last dictation's audio kept in the app's logs folder as `dictation-last.wav`.
- Apple's is macOS 26's on-device recognizer. Parakeet (English) is parakeet-unified-en-0.6b run by transcribe.cpp, from
  the GGUF Handy or Hex downloaded (Hex's `~/Library/Application Support/hex/models/`, Hugging Face's cache, Handy's),
  used where it is, in two passes: streaming for the dimmed words, then the utterance whole for the final ones. `auto`
  picks it when it's there and the language is English.
- A recognizer getting words wrong: `node tools/dictation_bench.ts --last` (in Vaultite's repo) replays the kept audio
  through both and prints what each heard.
- For plugins: `onDictation((event, { view, path }) => …)` hears a session (start, speech, pending, final, pause 700/2000
  ms, end); `speakingIn(view)` says the user is mid-sentence there. The companion holds while they speak and hears them
  at their pauses.
