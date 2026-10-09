## Audio recorder
Recordings made in the app ("Start recording audio", `/record` in a note, "Record audio" in a note's menu) are audio
files saved where pasted images go (`Attachments/`, unless the vault's settings say otherwise), named
`Recording 2026-10-01 14.03.12.m4a` (`.webm` from some browsers), and embedded in the note on a line of their own
(a new note named after the recording when none was being edited). When the machine running the server can transcribe
(Apple's on-device speech recognition on macOS 26, built in; else whisper, when it's installed), the transcript is
written under the embed as a folded callout, paragraphs split at pauses:

```
![[Recording 2026-10-01 14.03.12.webm]]
> [!quote]- Transcript
> What was said.
>
> The next paragraph.
```

- Transcribing again replaces the callout under that embed. Edit the transcript freely (fix names dictation got wrong).
- To transcribe an audio file into a note: `POST /api/audio-recorder/transcribe {"path": "Attachments/memo.m4a", "note":
  "Notes/Idea.md"}` (without `note`: the notes that embed it). It's a job: `GET /api/audio-recorder/jobs/<id>` says
  `queued`, `running`, `done` or `failed` (with `error`). `GET /api/audio-recorder/transcriber` says what transcribes here.
- A voice note ("Record a voice note for your inbox", what the iPhone's voice note widget opens): `POST
  /api/audio-recorder/voice {"data": "<base64>", "ext": "m4a", "from": "Computer"}` transcribes it, then the Inbox's
  `inbox.voice` with its words and the recording, kept as an attachment embedded above them (the job's `note` is the
  inbox file; the Inbox's setting `voice_audio` off keeps only the words). One the machine can't transcribe is kept
  as the recording alone: an inbox result embedding it, saying why (the job's `kept`). A recording under 0.7 s is a tap
  by mistake: not saved, and the app says so.
- Settings, `.vaultite/plugins/audio-recorder/data.json`: `{"engine": "auto", "language": "", "auto": true}`.
  `engine`: `auto` (Apple's when this machine has it, else whisper), `apple` or `whisper`. Apple's needs no install: a small
  helper (`transcribe.swift`, built the first time, shipped built in the desktop app) downloads a language's model the
  first time. `language` (`pt`, `en`, `pt-BR`) left out is the Mac's language for Apple's, detected by whisper (Apple's
  hears one language per recording). `model` is whisper's (tiny, base, small, medium, turbo; left out: the best one
  already downloaded of small, base and tiny); `auto: false` transcribes only when asked ("Transcribe audio");
  `transcribe: false` turns transcripts off. Whisper (`pip install openai-whisper`, with ffmpeg) is optional, found on
  its own. Which program runs is the machine's, never the vault's: in the app's `data/config.json`, under
  `"audio-recorder"`, `whisper: "/path/to/whisper"` names it, and `command: "my-transcriber {file}"` uses any other
  program instead (what it prints is the transcript). A program inside the vault is never run; `model` is a name only.
