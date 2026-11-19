import { lazy, Suspense } from "react"
import { preloadList } from "./chunks"
import { Arriving, type Store } from "@vaultite"

const AllTabsPage = lazy(() => import("./AllTabs"))
const SettingsPanel = lazy(() => import("./Settings"))
const ListLater = lazy(preloadList)

export const AllTabs = ({ store }: { store: Store }) => <Suspense fallback={<Arriving />}><AllTabsPage store={store} /></Suspense>
export const WorkspaceSettings = () => <Suspense fallback={<Arriving />}><SettingsPanel /></Suspense>
export const List = (p: { lit: number; over: number | null; focus: boolean; close: () => void }) => <Suspense fallback={<Arriving />}><ListLater {...p} /></Suspense>
