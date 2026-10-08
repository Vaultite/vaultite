// Audio recorder: record into the note being written, saved as an attachment and embedded, then
// transcribed on this machine when it can. Phones need https: browsers give the microphone only to secure pages.
import { useEffect } from "react"
import { Captions, Mic, Square } from "lucide-react"
import { activeFile, definePlugin, Panel, pluginOn, useLive } from "@vaultite"
import { Indicator } from "./Indicator"
import { canTranscribe, isAudio, recording, start, stop, transcribe, transcribeHere, transcriber, voiceNote } from "./recorder"

const idle = () => !recording()

function Background() {
  useEffect(() => { void transcriber() }, [])
  return <Indicator />
}

function Preview() {
  const t = useLive<{ available: boolean; name?: string; why?: string }>("audio-recorder/transcriber").data
  return (
    <Panel title="Audio recorder" icon={Mic} tint="var(--red)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Record from the microphone into the note you're writing: Start recording audio in the command palette, /record in a
        note, or Record audio in a note's menu. The recording is saved as an attachment and embedded where the cursor is,
        then transcribed under it. Record a voice note for your inbox sends what you say to the inbox instead, as the
        iPhone's voice note widget does.
      </p>
      <p className="mt-2 text-[15px] leading-[20px] text-muted-foreground">
        {t ? (t.available ? `Transcripts by ${t.name}, on the machine the app runs on.` : t.why) : "Looking for a transcriber…"}
      </p>
    </Panel>
  )
}

export default definePlugin({
  commands: [
    { id: "audio-recorder:start", name: "Start recording audio", when: idle, run: () => void start(), icon: Mic },
    { id: "audio-recorder:stop", name: "Stop recording audio", when: recording, run: stop, icon: Square },
    { id: "audio-recorder:toggle", name: "Start or stop recording audio", run: () => (recording() ? stop() : void start()), icon: Mic },
    { id: "audio-recorder:transcribe", name: "Transcribe audio", when: canTranscribe, run: transcribeHere, icon: Captions },
    // What the iPhone's voice note widget opens: said, transcribed, in the inbox (Inbox's inbox.voice).
    { id: "audio-recorder:voice-note", name: "Record a voice note for your inbox", when: () => idle() && pluginOn("inbox"), run: () => void voiceNote(), icon: Mic },
  ],
  slash: () => [recording()
    ? { id: "audio-recorder:stop", title: "Stop recording", section: "Media", keywords: "record audio voice memo stop", run: (put) => { put(""); stop() } }
    : { id: "audio-recorder:record", title: "Record audio", section: "Media", keywords: "record audio voice memo microphone dictate", detail: "Microphone",
        run: (put) => { put(""); void start(activeFile()?.path ?? null) } }],
  fileMenu: (path) => {
    if (/\.md$/i.test(path) && !path.startsWith(".")) {
      return recording()
        ? [{ label: "Stop recording", icon: Square, run: stop }]
        : [{ label: "Record audio", icon: Mic, section: "more", run: () => void start(path) }]
    }
    if (isAudio(path) && canTranscribe()) return [{ label: "Transcribe audio", icon: Mic, run: () => void transcribe(path) }]
    return []
  },
  background: () => <Background />,
  preview: () => <Preview />,
})
