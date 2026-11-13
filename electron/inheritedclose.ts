import { closeInherited, INHERITED } from "./inherited.ts"

closeInherited(process.env[INHERITED] ?? "")
delete process.env[INHERITED]
