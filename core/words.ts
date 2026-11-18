export function brief(summary: string, most = 72) {
  const plain = summary.replace(/ \((?:[^()]|\([^()]*\))*\)/g, "").split(/(?<=\w)\. /)[0].replace(/\.$/, "")
  return plain.length <= most ? plain : `${plain.slice(0, most - 1).replace(/\s+\S*$/, "").replace(/[,:;]$/, "")}…`
}
