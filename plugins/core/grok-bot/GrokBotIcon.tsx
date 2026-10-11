import type { LucideIcon } from "lucide-react"
import { BrandIcon } from "@vaultite"

// A round face with two eyes cut out: a plain mark of our own, not Grok Bot's logo.
const PATH = "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20ZM8.3 9.2a1.2 1.2 0 0 1 2.4 0v3.2a1.2 1.2 0 0 1-2.4 0ZM13.3 9.2a1.2 1.2 0 0 1 2.4 0v3.2a1.2 1.2 0 0 1-2.4 0Z"

export const GrokBotIcon = ((p) => <BrandIcon d={PATH} fillRule="evenodd" {...p} />) as LucideIcon
