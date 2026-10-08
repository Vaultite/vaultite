import type { LucideIcon } from "lucide-react"
import { BrandIcon } from "@vaultite"

// OpenCode's square, from Simple Icons.
const PATH = "M22 24H2V0h20zM17 4.8H7v14.4h10z"

export const OpenCodeIcon = ((p) => <BrandIcon d={PATH} fillRule="evenodd" {...p} />) as LucideIcon
