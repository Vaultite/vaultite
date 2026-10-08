/** "on" from dusk until 6 in the morning. */
export const beam = (dusk: number, hour: number) => (hour >= dusk || hour < 6 ? "on" : "off")
