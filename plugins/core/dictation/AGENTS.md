## Dictation
In the Mac desktop app, ⌘J (`dictation:start`) dictates where the cursor is: a note's editor, a terminal, or a field (the
Ask box, a chat's input). The dictation keys do the same in the window and in any other app (`fn`, Dictate anywhere, on
by default); talking to the companion is its own Talk keys' (the companion's setting `keys`: a key in both talks). `keys`
picks them: `fn_control` (fn⌃ held together, the default), or `fn`, `right_option`, `right_command`, `left_control`, `right_control` alone (with another
key it's only what it always was): a tap starts and the next stops; held, it listens until it's let go; a double tap is
hands-free, past the setting `silence`, until the next press.
Words not settled yet show dimmed by the cursor, never in the file; at each pause they settle and are typed in as the
user's own input (`userEvent` `input.dictation`), so the note only ever holds final text. In a terminal (a shell, Claude
Code) each settled chunk is pasted at its cursor, bracketed when its program asked, on one line (a line break said is a
space) and never with an Enter: nothing runs until the user presses it. Browsers and phones don't have it.
It follows the user: with the menu-bar helper, leaving where it began (another app, tab or field; or begun with nowhere
to type) moves the session to a box under the menu bar, where the words show as they're said. When it stops they land in
the field in front, else the one it began in, else on the clipboard and in the inbox (`from: Dictation`; only the
clipboard when a private app is in front), so said words are never lost. A password field hears nothing. Without the
helper (Vaultite Dev), leaving the window stops it. Each session's way is in `talk/dictation-<day>.jsonl`, no words.
- Settings (`.vaultite/plugins/dictation/data.json`): `engine` `auto` | `soniox` | `apple` | `parakeet`; `language` (Apple's,
  `pt-BR`; the Mac's when left out); `languages` (Soniox's hints, `[en, pt]`; the language and the Mac's when left out); `silence` (seconds without speech before a tapped dictation stops; 0, the default,
  never);
  `keep_audio` (this Mac's), the last dictation's audio kept in the app's logs folder as `dictation-last.wav`;
  `microphone` (this Mac's): `auto` (the default), `default`, `builtin` or a device's name, below.
- The dictionary, Dictionary.md (`type: dictionary`): a "- word" line each (Vorssaint), or "- said: written" for what
  dictation writes instead (`- Olympicos: Olimpicos`), replaced as it's heard. Every recognizer expects its words first,
  then Vaultite's, the agents' names (a plugin adds its own: the service `dictation:terms`), the people's and projects'
  names and the newest notes'; Parakeet takes no hints, only the replacements. Fixing a word just dictated (in a note, a
  terminal or a field, within a minute) adds it, with a toast and its Undo; the same word misheard again adds what it
  was misheard as. A word taken out isn't learned again. `vau dictation add|remove|words`.
- The mic (dictation, the Talk key and the realtime voice alike): a Bluetooth headset's own mic drops it to its call
  profile (24 kHz sound both ways) and back ~2 s after it closes, cutting what plays. So `auto` hears with the system's
  input unless the output is Bluetooth and that input is too: then the built-in mic, else a wired one. `default` is
  always the system's input, `builtin` the Mac's own (none, a closed lid: the system's). A Bluetooth mic used anyway is
  held open after a Talk key's press until the companion's answer is said, a second on. Its device gone or changed
  mid-press, the next one takes over and the press goes on. The press log has the mic and why (`stt`'s `mic`, `mic-change`,
  `mic-release`); `vau companion status`' Voice here line says which it hears with.
- Soniox (cloud, real time, any language, switching on its own) is `auto`'s pick once this machine has its key:
  `vau secret "Soniox API key" | vau dictation key` (kept in data/config.json, never the vault). The same key gives the companion its voice (Soniox's TTS). The socket is open only
  while listening; offline, refused or dropped, this Mac's recognizer finishes from the last settled word.
- Apple's is macOS 26's on-device recognizer. Parakeet (English) is parakeet-unified-en-0.6b run by transcribe.cpp, from
  the GGUF Handy or Hex downloaded (Hex's `~/Library/Application Support/hex/models/`, Hugging Face's cache, Handy's),
  used where it is, in two passes: streaming for the dimmed words, then the utterance whole for the final ones. `auto`
  picks it when it's there and the language is English.
- A recognizer getting words wrong: `node tools/dictation_bench.ts --last` (in Vaultite's repo) replays the kept audio
  through both and prints what each heard.
- For plugins: `onDictation((event, { view, path }) => …)` hears a session (start, speech, pending, final, pause 700/2000
  ms, end); `speakingIn(view)` says the user is mid-sentence there. The companion holds while they speak and hears them
  at their pauses.
