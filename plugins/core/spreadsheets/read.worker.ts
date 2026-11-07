// A workbook read off the main thread (Workbook.tsx): any file can come from anywhere, so a big or broken one never
// freezes the app, and one that takes too long is stopped with its worker.
import { read } from "./xlsx/xlsx.mjs"

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ book: read(e.data, { type: "array", dense: true, cellDates: true }) })
  } catch (err) {
    // (SheetJS throws strings too)
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
