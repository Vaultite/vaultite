type Value = string | number | boolean | null | undefined
export type Fields = Record<string, Value>

export type Logger = {
  info(message: string, fields?: Fields): void
  warn(message: string, fields?: Fields): void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a caught exception is unknown: logged as it is
  error(message: string, error?: unknown, fields?: Fields): void
}

const shown = (v: Value) => { const t = String(v); return t === "" || /[\s="]/.test(t) ? JSON.stringify(t) : t }
const line = (area: string, message: string, fields?: Fields) => {
  const kv = Object.entries(fields ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${shown(v)}`)
  return [`${area}: ${message}`, ...kv].join(" ")
}

export function logger(area: string): Logger {
  return {
    info: (message, fields) => console.log(line(area, message, fields)),
    warn: (message, fields) => console.warn(line(area, message, fields)),
    error: (message, error, fields) => {
      if (error === undefined) console.error(line(area, message, fields))
      else console.error(`${line(area, message, fields)}:`, error instanceof Error ? error : new Error(String(error)))
    },
  }
}
