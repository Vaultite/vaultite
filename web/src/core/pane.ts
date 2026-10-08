// Which pane a view is in: the focused one gets the status bar and keyboard commands; outside panes a view counts as
// focused. `hidden`: a tab kept drawn behind another, never focused.
import { createContext, useContext } from "react"

export const PaneContext = createContext<{ group: string; focused: boolean; hidden?: boolean }>({ group: "", focused: true })
export const usePane = () => useContext(PaneContext)
