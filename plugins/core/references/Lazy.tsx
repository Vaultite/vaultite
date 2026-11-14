import { lazy, Suspense } from "react"
import type { SidebarCtx } from "@vaultite"

const Panel = lazy(() => import("./Panel.tsx").then((m) => ({ default: m.ReferencesPanel })))
const View = lazy(() => import("./Panel.tsx").then((m) => ({ default: m.ReferencesView })))
const Settings = lazy(() => import("./Sources.tsx").then((m) => ({ default: m.Sources })))
const Bib = lazy(() => import("./Bibliography.tsx").then((m) => ({ default: m.Bibliography })))

export const LazyPanel = (ctx: SidebarCtx) => <Suspense fallback={null}><Panel {...ctx} /></Suspense>
export const LazyView = () => <Suspense fallback={null}><View /></Suspense>
export const LazySources = () => <Suspense fallback={null}><Settings /></Suspense>
export const LazyBibliography = ({ path, place }: { path: string; place: "page" | "sheet" | "print" }) => <Suspense fallback={null}><Bib path={path} place={place} /></Suspense>
