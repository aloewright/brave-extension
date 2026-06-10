import { MAIL_TWO_FACTOR_API_BASE } from "../lib/mail-2fa"

export type MailTabFetchResult = {
  status: number
  ok: boolean
  text: string
}

export type MailPageFetchOptions = {
  path: string
  method: string
  headers?: Record<string, string>
  body?: string
  /** Called when a temporary background tab is opened (for cleanup). */
  onEphemeralTab?: (tabId: number) => void
}

function isMailFlyPmUrl(url?: string) {
  return /^https?:\/\/mail\.fly\.pm(?:\/|$)/i.test(url ?? "")
}

function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      fn()
    }

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("mail.fly.pm tab load timed out")))
    }, timeoutMs)

    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") {
        finish(resolve)
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish(resolve)
      })
      .catch((err) => finish(() => reject(err)))
  })
}

async function ensureMailFlyPmTab(tabId: number): Promise<number> {
  await waitForTabComplete(tabId)
  const tab = await chrome.tabs.get(tabId)
  if (!isMailFlyPmUrl(tab.url)) {
    throw new Error("mail.fly.pm is not open as a signed-in tab")
  }
  return tabId
}

async function findMailFlyPmTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({
    url: [`${MAIL_TWO_FACTOR_API_BASE}/*`, "http://mail.fly.pm/*"]
  })
  const ready = tabs.find((tab) => tab.id != null && tab.status === "complete" && isMailFlyPmUrl(tab.url))
  if (ready?.id != null) return ready.id
  const loading = tabs.find((tab) => tab.id != null && isMailFlyPmUrl(tab.url))
  if (loading?.id == null) return null
  return ensureMailFlyPmTab(loading.id)
}

async function openEphemeralMailTab(onEphemeralTab?: (tabId: number) => void): Promise<number> {
  const tab = await chrome.tabs.create({
    url: MAIL_TWO_FACTOR_API_BASE,
    active: false
  })
  if (tab.id == null) throw new Error("Failed to open mail.fly.pm tab")
  onEphemeralTab?.(tab.id)
  return ensureMailFlyPmTab(tab.id)
}

async function fetchMailInTab(
  tabId: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<MailTabFetchResult> {
  if (!chrome.scripting?.executeScript) {
    throw new Error("chrome.scripting unavailable")
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (
      fetchBaseUrl: string,
      fetchPath: string,
      fetchMethod: string,
      fetchHeaders: Record<string, string>,
      fetchBody: string
    ) => {
      const url = new URL(fetchPath, fetchBaseUrl).toString()
      const init: RequestInit = {
        method: fetchMethod,
        headers: fetchHeaders,
        credentials: "include"
      }
      if (fetchBody && fetchMethod !== "GET" && fetchMethod !== "HEAD") {
        init.body = fetchBody
      }
      const response = await fetch(url, init)
      const text = await response.text()
      return { status: response.status, ok: response.ok, text }
    },
    args: [MAIL_TWO_FACTOR_API_BASE, path, method, headers, body ?? ""]
  })

  const result = injection?.result as MailTabFetchResult | undefined
  if (!result || typeof result.status !== "number") {
    throw new Error("mail.fly.pm tab fetch returned no result")
  }
  return result
}

/**
 * Fetch mail.fly.pm API routes through a mail.fly.pm tab so Better Auth
 * SameSite cookies attach as first-party page traffic. Background service
 * worker fetches cannot reliably attach the session cookie.
 */
export async function fetchMailViaPageContext(
  options: MailPageFetchOptions
): Promise<MailTabFetchResult | null> {
  const method = options.method.toUpperCase()
  const headers: Record<string, string> = { accept: "application/json" }
  for (const [key, value] of Object.entries(options.headers || {})) {
    const lower = key.toLowerCase()
    if ((lower === "accept" || lower === "content-type") && typeof value === "string") {
      headers[key] = value
    }
  }

  let tabId = await findMailFlyPmTabId()
  let openedEphemeral = false
  if (tabId == null) {
    tabId = await openEphemeralMailTab(options.onEphemeralTab)
    openedEphemeral = true
  }

  try {
    return await fetchMailInTab(tabId, options.path, method, headers, options.body)
  } catch (err) {
    if (!openedEphemeral) {
      tabId = await openEphemeralMailTab(options.onEphemeralTab)
      return fetchMailInTab(tabId, options.path, method, headers, options.body)
    }
    throw err
  }
}
