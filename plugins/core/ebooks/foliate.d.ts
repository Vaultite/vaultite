// foliate-js has no types: the one function the reader takes from it (importing it also defines <foliate-view>).
declare module "foliate-js/view.js" {
  export function makeBook(file: File | Blob | string): Promise<unknown>
}
