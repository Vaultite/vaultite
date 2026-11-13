type LogFields = Record<string, string | number | boolean | null | undefined>
export type Logger = {
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a caught exception is unknown: logged as it is
  error(message: string, error?: unknown, fields?: LogFields): void
}

export const unlogged = (): Logger => ({ info: () => {}, warn: () => {}, error: () => {} })
let made: (area: string) => Logger = unlogged
export const logTo = (fn: (area: string) => Logger) => { made = fn }
export const logger = (area: string): Logger => ({
  info: (message, fields) => made(area).info(message, fields),
  warn: (message, fields) => made(area).warn(message, fields),
  error: (message, error, fields) => made(area).error(message, error, fields),
})
