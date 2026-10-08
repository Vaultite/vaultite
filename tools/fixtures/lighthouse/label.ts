export const label = (b: { beam: string; keepers: number } | null) =>
  b ? `Beam ${b.beam}, ${b.keepers} ${b.keepers === 1 ? "keeper" : "keepers"}` : "Lighting the lamp"
