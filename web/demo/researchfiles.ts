const FILES = import.meta.glob<string>("./research/**/*", { query: "?raw", import: "default", eager: true })

export const RESEARCH_FILES: [string, string][] = Object.entries(FILES).map(([k, text]) => [k.slice("./research/".length), text])
