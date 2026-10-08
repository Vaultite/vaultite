// Lucide's icons as one module (core/icons.tsx loads it lazily): every icon by its PascalCase name.
declare module "lucide-react/dist/esm/icons/index.mjs" {
  import type { LucideIcon } from "lucide-react"
  const icons: Record<string, LucideIcon>
  export = icons
}

// The app's plugins' icons by plugin id, from their manifests (vite.config.ts pluginIcons): a component, or the name of
// one the plugin adds itself (`icons`).
declare module "virtual:plugin-icons" {
  import type { LucideIcon } from "lucide-react"
  const icons: Record<string, LucideIcon | string>
  export default icons
}
