import { MousePointerClick } from "lucide-react"
import { ActionButtons, AddButton, definePlugin } from "@vaultite"

// Buttons: the new tab's buttons (newtab.json's `actions`, one list) as a sidebar panel, out of the default; icons in the
// rail, and in a phone drawer's dock when docked. Its tab is the same list a size up.
function ButtonsView() {
  return (
    <div className="pb-10" data-buttons-view>
      <p className="mb-3 flex items-center gap-1.5 text-[13px] text-muted-foreground max-md:text-[15px]">
        The new tab's buttons.<span className="max-md:hidden"> Drag one to reorder it.</span><AddButton />
      </p>
      <div className="size-up-bleed"><div data-size-up><ActionButtons /></div></div>
    </div>
  )
}

export default definePlugin({
  sidebar: {
    buttons: { title: "Buttons", sort: 12, hidden: true, dockable: true, view: "buttons",
      render: ({ open, phone, panel, dock }) => <ActionButtons open={open} phone={phone} panel={panel} dock={dock} />, actions: () => <AddButton /> },
  },
  views: { buttons: { icon: MousePointerClick, title: () => "Buttons", render: () => <ButtonsView /> } },
})
