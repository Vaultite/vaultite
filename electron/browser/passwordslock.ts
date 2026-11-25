export function openFor(ms: number, lapsed: () => void) {
  let until = 0, timer: NodeJS.Timeout | undefined
  const isOpen = () => until > Date.now()
  const close = () => { const was = until > 0; until = 0; clearTimeout(timer); return was }
  return {
    isOpen, close,
    open() {
      until = Date.now() + ms
      clearTimeout(timer)
      timer = setTimeout(lapsed, ms)
    },
  }
}
