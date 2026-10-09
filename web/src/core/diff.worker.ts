// A big line diff off the main thread (diff.ts).
import { diffLines } from "../../../core/linediff.ts"

self.onmessage = (e: MessageEvent<{ id: number; a: string[]; b: string[] }>) => {
  const { id, a, b } = e.data
  self.postMessage({ id, ops: diffLines(a, b) })
}
