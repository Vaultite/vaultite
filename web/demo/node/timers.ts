// node:timers/promises for the demo's server.
export const setImmediate = <T>(value?: T) => new Promise<T | undefined>((ok) => setTimeout(() => ok(value), 0))
const wait = <T>(ms?: number, value?: T) => new Promise<T | undefined>((ok) => setTimeout(() => ok(value), ms))
export { wait as setTimeout }
export default { setImmediate, setTimeout: wait }
