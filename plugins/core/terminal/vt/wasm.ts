import url from "./ghostty-vt.wasm?url"

let compiled: Promise<WebAssembly.Module> | null = null
export function vtModule() {
  compiled ??= (async () => {
    const res = fetch(url)
    // (served without application/wasm, as iOS's app scheme may: compiled from its bytes instead)
    try { return await WebAssembly.compileStreaming(res) } catch { return WebAssembly.compile(await (await fetch(url)).arrayBuffer()) }
  })()
  compiled.catch(() => { compiled = null })
  return compiled
}
