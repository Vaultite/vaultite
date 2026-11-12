export function lineReader(fn: (line: string) => void) {
  let held: string[] = []
  return (chunk: string) => {
    let at = 0, nl: number
    while ((nl = chunk.indexOf("\n", at)) >= 0) {
      held.push(chunk.slice(at, nl))
      const line = held.length === 1 ? held[0] : held.join("")
      held = []
      at = nl + 1
      fn(line)
    }
    if (at < chunk.length) held.push(chunk.slice(at))
  }
}
