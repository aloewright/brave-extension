// cal.fly.pm /tasks-data requires a Better Auth session cookie. MV3 service
// worker fetch() treats `Cookie` as a forbidden header (manual values from
// chrome.cookies.getAll are dropped) and extension-origin requests do not
// attach site cookies the way a cal.fly.pm tab does. Proxy through a cal tab
// so fetch(..., { credentials: "include" }) runs as same-site page traffic.

export const CAL_TASKS_API_BASE = "https://cal.fly.pm"

export type CalTasksTabFetchResult = {
  status: number
  ok: boolean
  text: string
}

export type CalTasksPageFetchOptions = {
  path: string
  method: string
  headers?: Record<string, string>
  body?: string
  /** Called when a temporary background tab is opened (for cleanup). */
  onEphemeralTab?: (tabId: number) => void
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
      finish(() => reject(new Error("cal.fly.pm tab load timed out")))
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

async function findCalFlyPmTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({
    url: [`${CAL_TASKS_API_BASE}/*`, "http://cal.fly.pm/*"]
  })
  const ready = tabs.find((tab) => tab.id != null && tab.status === "complete")
  if (ready?.id != null) return ready.id
  const loading = tabs.find((tab) => tab.id != null)
  if (loading?.id == null) return null
  await waitForTabComplete(loading.id)
  return loading.id
}

async function openEphemeralCalTab(onEphemeralTab?: (tabId: number) => void): Promise<number> {
  const tab = await chrome.tabs.create({
    url: `${CAL_TASKS_API_BASE}/tasks`,
    active: false
  })
  if (tab.id == null) throw new Error("Failed to open cal.fly.pm tab")
  onEphemeralTab?.(tab.id)
  await waitForTabComplete(tab.id)
  return tab.id
}

async function fetchCalTasksInTab(
  tabId: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<CalTasksTabFetchResult> {
  if (!chrome.scripting?.executeScript) {
    throw new Error("chrome.scripting unavailable")
  }

  // chrome.scripting.executeScript args must be JSON-serializable; `undefined`
  // throws "Value is unserializable" so coerce missing body to an empty string.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (
      fetchPath: string,
      fetchMethod: string,
      fetchHeaders: Record<string, string>,
      fetchBody: string
    ) => {
      const url = new URL(fetchPath, location.origin).toString()
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
    args: [path, method, headers, body ?? ""]
  })

  const result = injection?.result as CalTasksTabFetchResult | undefined
  if (!result || typeof result.status !== "number") {
    throw new Error("cal.fly.pm tab fetch returned no result")
  }
  return result
}

/**
 * Fetch cal task API routes through a cal.fly.pm tab so session cookies attach.
 * Returns null when scripting/tabs are unavailable (caller may fall back).
 */
export async function fetchCalTasksViaPageContext(
  options: CalTasksPageFetchOptions
): Promise<CalTasksTabFetchResult | null> {
  const method = options.method.toUpperCase()
  const headers: Record<string, string> = { accept: "application/json" }
  for (const [key, value] of Object.entries(options.headers || {})) {
    const lower = key.toLowerCase()
    if (lower === "content-type" && typeof value === "string") {
      headers[key] = value
    }
  }

  console.debug("[cal-tasks-proxy] start", { path: options.path, method })
  let tabId = await findCalFlyPmTabId()
  let openedEphemeral = false
  if (tabId == null) {
    console.debug("[cal-tasks-proxy] no existing cal tab, opening ephemeral")
    tabId = await openEphemeralCalTab(options.onEphemeralTab)
    openedEphemeral = true
  } else {
    console.debug("[cal-tasks-proxy] reusing existing cal tab", { tabId })
  }

  try {
    const result = await fetchCalTasksInTab(
      tabId,
      options.path,
      method,
      headers,
      options.body
    )
    console.debug("[cal-tasks-proxy] tab fetch returned", {
      status: result.status,
      ok: result.ok,
      textLen: result.text.length,
      preview: result.text.slice(0, 120),
    })
    return result
  } catch (err) {
    console.debug("[cal-tasks-proxy] tab fetch threw", err instanceof Error ? err.message : err)
    if (!openedEphemeral) {
      tabId = await openEphemeralCalTab(options.onEphemeralTab)
      const retry = await fetchCalTasksInTab(
        tabId,
        options.path,
        method,
        headers,
        options.body
      )
      console.debug("[cal-tasks-proxy] retry fetch returned", {
        status: retry.status,
        ok: retry.ok,
        textLen: retry.text.length,
      })
      return retry
    }
    throw err
  }
}
