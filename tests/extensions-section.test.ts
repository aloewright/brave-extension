import { describe, expect, it } from "vitest"
import { enabledExtensionsFirst } from "../src/sections/_lx/utils/extensions"
import type { ExtensionInfo } from "../src/sections/_lx/types"

function ext(id: string, enabled: boolean): ExtensionInfo {
  return {
    id,
    enabled,
    name: id,
    description: "",
    version: "1.0.0",
    installType: "normal",
    mayDisable: true,
    type: "extension"
  }
}

describe("enabledExtensionsFirst", () => {
  it("moves enabled pinned extension logos before disabled ones", () => {
    const ordered = enabledExtensionsFirst([
      ext("disabled-a", false),
      ext("enabled-a", true),
      ext("disabled-b", false),
      ext("enabled-b", true)
    ])

    expect(ordered.map((e) => e.id)).toEqual([
      "enabled-a",
      "enabled-b",
      "disabled-a",
      "disabled-b"
    ])
  })

  it("keeps the existing relative order within enabled and disabled groups", () => {
    const ordered = enabledExtensionsFirst([
      ext("enabled-a", true),
      ext("enabled-b", true),
      ext("disabled-a", false),
      ext("disabled-b", false)
    ])

    expect(ordered.map((e) => e.id)).toEqual([
      "enabled-a",
      "enabled-b",
      "disabled-a",
      "disabled-b"
    ])
  })
})
