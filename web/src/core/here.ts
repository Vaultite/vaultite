// Where the app is used from: this Mac (or its tailnet), or Vaultite Connect without owner tools, where what's the
// Mac's is refused. The state says (data.ts); views needing the Mac show OnThisMac there instead of asking.
import { cell } from "@/core/signal"

const here = cell<"mac" | "connect">("mac")
export const setHere = (to: "mac" | "connect") => here.set(to)
/** Used through Vaultite Connect, without owner tools. */
export const overConnect = () => here.get() === "connect"
/** overConnect(), as a hook. */
export const useOverConnect = () => here.use((h) => h === "connect")
