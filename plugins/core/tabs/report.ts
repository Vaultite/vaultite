import { z } from "zod"

export const ReportPane = z.looseObject({ id: z.string(), to: z.string(), path: z.string().optional(), behind: z.string().optional(), focused: z.boolean().optional(),
  floating: z.boolean().optional(), zoomed: z.boolean().optional() })
export const ReportTab = z.looseObject({ id: z.string(), active: z.boolean().optional(), pinned: z.boolean().optional(), name: z.string().optional(), group: z.string().optional(),
  panes: z.array(ReportPane) })
const GroupFields = { id: z.string(), name: z.string(), color: z.string(), collapsed: z.boolean().optional() }
export const ReportGroup = z.looseObject({ ...GroupFields, tabs: z.number() })
export const Report = z.looseObject({ tabs: z.array(ReportTab), groups: z.array(ReportGroup), window: z.string().optional(),
  windows: z.array(z.looseObject({ id: z.string(), tabs: z.array(ReportTab) })).optional() })
export type ReportPane = z.infer<typeof ReportPane>
export type ReportTab = z.infer<typeof ReportTab>
export type ReportGroup = z.infer<typeof ReportGroup>
export type Report = z.infer<typeof Report>
export const Placed = z.looseObject({ pane: z.string(), tab: z.string() })
export const Grouped = z.looseObject({ group: z.looseObject({ ...GroupFields, tabs: z.array(ReportTab) }) })
export const Ungrouped = z.looseObject({ ungrouped: z.string().optional(), removed: z.array(z.string()).optional() })
export const Archived = z.looseObject({ archived: z.array(z.looseObject({ id: z.string(), to: z.string(), title: z.string().optional(), archived: z.string() })) })
