import type { ExtensionInfo } from "../types"

export function enabledExtensionsFirst(extensions: ExtensionInfo[]): ExtensionInfo[] {
  return extensions
    .map((extension, index) => ({ extension, index }))
    .sort((a, b) => {
      const enabledDiff = Number(b.extension.enabled) - Number(a.extension.enabled)
      return enabledDiff || a.index - b.index
    })
    .map(({ extension }) => extension)
}
