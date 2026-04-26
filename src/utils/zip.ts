import { zipSync, strToU8 } from "fflate"

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const bag: Record<string, Uint8Array> = {}
  for (const e of entries) {
    bag[uniqueName(bag, e.name)] = e.data
  }
  return zipSync(bag)
}

export function textEntry(name: string, content: string): ZipEntry {
  return { name, data: strToU8(content) }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(",")
  if (idx === -1) return new Uint8Array(0)
  const meta = dataUrl.slice(0, idx)
  const body = dataUrl.slice(idx + 1)
  if (meta.includes(";base64")) {
    const bin = atob(body)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return strToU8(decodeURIComponent(body))
}

function uniqueName(bag: Record<string, Uint8Array>, name: string): string {
  if (!(name in bag)) return name
  const dot = name.lastIndexOf(".")
  const base = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? "" : name.slice(dot)
  let i = 2
  while (`${base}-${i}${ext}` in bag) i++
  return `${base}-${i}${ext}`
}
