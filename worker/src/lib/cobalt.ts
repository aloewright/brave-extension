import type { Env } from "../env"

export interface CobaltSuccess {
  status: "tunnel" | "redirect" | "picker"
  url?: string
  filename?: string
}

export interface CobaltError {
  status: "error"
  error: { code: string; context?: unknown }
}

export type CobaltResponse = CobaltSuccess | CobaltError

function cobaltAccessHeaders(env: Env): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (env.COBALT_ACCESS_CLIENT_ID && env.COBALT_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.COBALT_ACCESS_CLIENT_ID
    headers["CF-Access-Client-Secret"] = env.COBALT_ACCESS_CLIENT_SECRET
  }
  return headers
}

export async function requestCobaltDownload(
  env: Env,
  pageUrl: string,
  opts: { videoQuality?: string; downloadMode?: string } = {}
): Promise<CobaltResponse> {
  const base = (env.COBALT_API_URL ?? "https://cobalt-web.lazee.workers.dev/api/").replace(
    /\/?$/,
    "/"
  )
  const res = await fetch(base, {
    method: "POST",
    headers: cobaltAccessHeaders(env),
    body: JSON.stringify({
      url: pageUrl,
      videoQuality: opts.videoQuality ?? "1080",
      downloadMode: opts.downloadMode ?? "auto",
      filenameStyle: "basic",
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`cobalt request failed (${res.status}): ${text.slice(0, 200)}`)
  }

  return (await res.json()) as CobaltResponse
}

export async function fetchCobaltMedia(
  env: Env,
  cobalt: CobaltSuccess
): Promise<{ bytes: Uint8Array; filename: string; mime: string }> {
  if (!cobalt.url) {
    throw new Error("cobalt response missing url")
  }

  const mediaUrl = cobalt.url.startsWith("http")
    ? cobalt.url
    : new URL(cobalt.url, env.COBALT_API_URL ?? "https://cobalt-web.lazee.workers.dev/api/").href

  const res = await fetch(mediaUrl, {
    headers: cobaltAccessHeaders(env),
    redirect: "follow",
  })
  if (!res.ok) {
    throw new Error(`cobalt media fetch failed (${res.status})`)
  }

  const mime = res.headers.get("content-type") ?? "video/mp4"
  const filename = cobalt.filename ?? guessFilename(mediaUrl, mime)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { bytes, filename, mime }
}

function guessFilename(url: string, mime: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop()
    if (last && last.includes(".")) return last
  } catch {
    /* ignore */
  }
  if (mime.includes("webm")) return "video.webm"
  if (mime.includes("quicktime")) return "video.mov"
  return "video.mp4"
}
