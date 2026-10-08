// Lucide's icons as one module (core/icons.tsx loads it lazily): every icon by its PascalCase name.
declare module "lucide-react/dist/esm/icons/index.mjs" {
  import type { LucideIcon } from "lucide-react"
  const icons: Record<string, LucideIcon>
  export = icons
}
