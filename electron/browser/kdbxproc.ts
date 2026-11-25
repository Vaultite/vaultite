// The passwords process (a utilityProcess): the one place KeePass files are read, keyed and written. No network, no vault.
import { KdbxFiles } from "./kdbxfile.ts"
import { serving } from "./kdbxserve.ts"

for (const k of Object.keys(process.env)) if (k !== "SystemRoot") delete process.env[k]
const port = process.parentPort
const answer = serving(new KdbxFiles(process.argv[2]))
port.on("message", (m) => { void answer(m.data).then((a) => { if (a) port.postMessage(a) }) })
