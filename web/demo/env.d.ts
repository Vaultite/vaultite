/// <reference types="vite/client" />
// The demo server's modules from vite.demo.config.ts, and path-browserify (Node's POSIX path).
declare module "virtual:demo-plugins" {}
declare module "virtual:demo-plugin-files" { const files: string[]; export default files; export const loaded: Record<string, unknown> }
declare module "path-browserify" { import path from "node:path"; export default path.posix }
