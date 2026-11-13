import { read } from "./xlsx/xlsx.mjs"

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ book: read(e.data, { type: "array", dense: true, cellDates: true }) })
  } catch (err) {
    // (SheetJS throws strings too)
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
