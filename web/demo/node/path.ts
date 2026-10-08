// node:path for the demo's server: POSIX paths.
import path from "path-browserify"

export default path
export const { join, resolve, dirname, basename, extname, relative, isAbsolute, normalize, sep, parse, format } = path
export const posix = path
