// The modules app plugins' manifests `exports`, each loaded when a vault plugin asks (vite.config.ts pluginModules).
declare module "virtual:plugin-exports" {
  const loaders: Record<string, () => Promise<unknown>>
  export default loaders
}
