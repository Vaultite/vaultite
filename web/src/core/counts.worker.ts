import { countText } from "./counts"

self.onmessage = (e: MessageEvent<{ id: number; body: string; code: boolean; nb: boolean }>) => {
  const { id, body, code, nb } = e.data
  self.postMessage({ id, counts: countText(body, code, nb) })
}
