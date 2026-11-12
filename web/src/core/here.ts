import { cell } from "@/core/signal"

const here = cell<"mac" | "connect">("mac")
export const setHere = (to: "mac" | "connect") => here.set(to)
/** Used through Vaultite Connect, without owner tools. */
export const overConnect = () => here.get() === "connect"
/** overConnect(), as a hook. */
export const useOverConnect = () => here.use((h) => h === "connect")
