// Counts a big file's text off the main thread, so typing in it never waits for them (StatusBar).
import { countText } from "./counts"

self.onmessage = (e: MessageEvent<{ id: number; body: string; code: boolean; nb: boolean }>) => {
  const { id, body, code, nb } = e.data
  self.postMessage({ id, counts: countText(body, code, nb) })
}
