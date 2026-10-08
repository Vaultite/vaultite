import { ActionButtons, AddButton, definePlugin } from "@vaultite"

// Buttons: the new tab's buttons (newtab.json's `actions`, one list) as a sidebar panel, out of the default; icons in the
// rail, and in a phone drawer's dock when docked.
export default definePlugin({
  sidebar: {
    buttons: { title: "Buttons", sort: 12, hidden: true, dockable: true,
      render: ({ open, phone, panel, dock }) => <ActionButtons open={open} phone={phone} panel={panel} dock={dock} />, actions: () => <AddButton /> },
  },
})
