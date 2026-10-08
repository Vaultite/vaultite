// node:os for the demo's server: a machine of its own, in the browser.
export const hostname = () => "demo"
export const homedir = () => "/home"
export const tmpdir = () => "/tmp"
export const platform = () => "browser"
export const release = () => ""
export const type = () => "Browser"
export const arch = () => "wasm"
export const userInfo = () => ({ username: "demo", homedir: "/home", uid: 501, gid: 20, shell: null })
export const cpus = () => []
export const EOL = "\n"
export default { hostname, homedir, tmpdir, platform, release, type, arch, userInfo, cpus, EOL }
