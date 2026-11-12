// The server's libghostty-vt: the module compiled once (on the first terminal), each terminal its own instance.
import fs from "node:fs"
import { Vt, type VtOptions } from "./vt.ts"

let module: WebAssembly.Module | null = null

/** The module, compiled once: a terminal server's screens (termd/screen.ts) each take it to their own thread. */
export const vtModule = () => (module ??= new WebAssembly.Module(fs.readFileSync(new URL("./ghostty-vt.wasm", import.meta.url))))

export function newVt(o: VtOptions) {
  return new Vt(vtModule(), o)
}
