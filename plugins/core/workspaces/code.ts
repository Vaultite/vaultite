export const CODE = { name: "Code", icon: "bot", sidebars: { left: ["agents:agents"], right: [], collapsed: [], heights: {} } }

export const freeSlot = (slots: number[], used: (n: number) => boolean, here: number) => slots.find((n) => n !== here && !used(n))
