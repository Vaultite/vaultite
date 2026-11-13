import { useCallback, useEffect, useRef, useState } from "react"
import { plainError, trackSoon, type FormatCtx } from "@vaultite"
import { parseCanvas, unfoldOnDrop, writeCanvas, type CanvasDoc } from "./codec"

export function useBoardDoc(text: string, editable: boolean, onChange: FormatCtx["onChange"]) {
  const [doc, setDoc] = useState<CanvasDoc>(() => { try { return parseCanvas(text) } catch { return { nodes: [], edges: [] } } })
  const [error, setError] = useState<string | null>(() => { try { parseCanvas(text); return null } catch (e) { return plainError(e).reason ?? "" } })
  const docRef = useRef(doc)
  // oxlint-disable-next-line react/refs -- handlers between renders read the doc they just set, before React draws it
  docRef.current = doc
  const last = useRef(text)
  const undo = useRef<CanvasDoc[]>([])
  const redo = useRef<CanvasDoc[]>([])
  const [, setHistory] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useRef<() => void>(() => {})
  const save = useCallback((next: CanvasDoc) => {
    flush.current = () => {
      timer.current = null
      const out = writeCanvas(next, last.current)
      if (out === last.current) return
      last.current = out
      onChange(out)
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush.current(), 300)
  }, [onChange])
  useEffect(() => {
    const off = trackSoon("the board's save", () => timer.current !== null, true)
    return () => { off(); if (timer.current) { clearTimeout(timer.current); flush.current() } }
  }, [])

  const live = (next: CanvasDoc) => { docRef.current = next; setDoc(next); save(next) }
  const commit = (next: CanvasDoc, before: CanvasDoc = docRef.current) => {
    if (!editable || next === before) return
    next = unfoldOnDrop(before, next)
    undo.current.push(before)
    if (undo.current.length > 200) undo.current.shift()
    redo.current = []
    live(next)
    setHistory((h) => h + 1)
  }
  return { doc, setDoc, error, setError, docRef, last, undo, redo, setHistory, live, commit }
}
