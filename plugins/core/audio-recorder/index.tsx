// Browsers give the microphone only to secure pages: phones need https.
import { useEffect } from "react"
import { Captions, Mic, Square } from "lucide-react"
import { activeFile, definePlugin, pluginOn } from "@vaultite"
import { Indicator } from "./Indicator"
import { canTranscribe, isAudio, recording, start, stop, transcribe, transcribeHere, transcriber, voiceNote } from "./recorder"

const idle = () => !recording()

function Background() {
  useEffect(() => { void transcriber() }, [])
  return <Indicator />
}


export default definePlugin({
  commands: [
    { id: "audio-recorder:toggle", name: "Start recording audio", run: () => (recording() ? stop() : void start()), icon: Mic,
      nameWhenOn: "Stop recording audio", on: recording },
    { id: "audio-recorder:transcribe", name: "Transcribe audio", when: canTranscribe, run: transcribeHere, icon: Captions },
    { id: "audio-recorder:voice-note", name: "Record a voice note for your inbox", when: () => idle() && pluginOn("inbox"), run: () => void voiceNote(), icon: Mic },
  ],
  slash: () => [recording()
    ? { id: "audio-recorder:stop", title: "Stop recording", section: "Media", keywords: "record audio voice memo stop", icon: Square,
        description: "Stops the recording and adds it to the note.", run: (put) => { put(""); stop() } }
    : { id: "audio-recorder:record", title: "Record audio", section: "Media", keywords: "record audio voice memo microphone dictate", detail: "Microphone",
        icon: Mic, description: "Records from the microphone into this note, transcribed when it can be.", run: (put) => { put(""); void start(activeFile()?.path ?? null) } }],
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
})
