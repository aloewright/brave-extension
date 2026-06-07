import { isRepo } from "./page-detect"

export interface RepoInfo {
  owner: string
  name: string
  nameWithOwner: string
  branch?: string
  filePath?: string
}

export function parseRepo(url: URL): RepoInfo | null {
  if (!isRepo(url)) return null
  const p = url.pathname.split("/").filter(Boolean)
  const [owner, name, kind, ref, ...rest] = p
  const info: RepoInfo = { owner, name, nameWithOwner: `${owner}/${name}` }
  if ((kind === "blob" || kind === "tree") && ref) {
    info.branch = ref
    if (rest.length) info.filePath = rest.join("/")
  }
  return info
}
