// Where this machine's app takes its code from the root store (core/update/store.ts): the marker in userData turns it on
// (read at each launch and each update's look); removed, the next launch runs the app's own bundle. Node's own only.
import fs from "node:fs"
import path from "node:path"

export const MARKER = "use-code-store", STORE = "code.noindex"
/** The store this machine's app takes its code from, null where the marker isn't. */
export const storeIn = (userData) => (fs.existsSync(path.join(userData, MARKER)) ? path.join(userData, STORE) : null)
