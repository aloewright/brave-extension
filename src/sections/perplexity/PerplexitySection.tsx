import { useEffect, useMemo, useRef, useState } from "react"

import { PretextTextBlock } from "../../components/PretextTextBlock"
import { LeoIcon } from "../../components/leo"

const STORAGE_KEY = "perplexity.remote-tab.state.v1"
const PERPLEXITY_HOME = "https://www.perplexity.ai/"
const PERPLEXITY_LIBRARY = "https://www.perplexity.ai/library"
const DEFAULT_VIEWPORT = { width: 420, height: 720 }

type LaunchMode = "regular" | "container"

interface StoredState {
  query?: string
  mode?: LaunchMode
  tabId?: number | null
  url?: string
}

interface RemoteTabState {
  tabId: number
  url: string
}

interface ScreencastFrameParams {
  data: string
  sessionId: number
}

const SPECIAL_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  " ": 32
}

function buildPerplexitySearchUrl(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return PERPLEXITY_HOME
  const url = new URL("https://www.perplexity.ai/search/")
  url.searchParams.set("q", trimmed)
  return url.toString()
}

function runtimeError(): Error | null {
  const error = chrome.runtime.lastError
  return error ? new Error(error.message) : null
}

function debuggerAttach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const error = runtimeError()
      if (error && !/already attached/i.test(error.message)) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function debuggerDetach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve())
  })
}

function sendDebugCommand<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      const error = runtimeError()
      if (error) {
        reject(error)
        return
      }
      resolve(result as T)
    })
  })
}

async function getExistingTab(tabId: number | null | undefined): Promise<chrome.tabs.Tab | null> {
  if (!tabId) return null
  try {
    return await chrome.tabs.get(tabId)
  } catch {
    return null
  }
}

async function createContainerTab(url: string): Promise<chrome.tabs.Tab> {
  const contextualIdentities = (chrome as unknown as {
    contextualIdentities?: {
      query(details: { name?: string }): Promise<Array<{ cookieStoreId: string; name: string }>>
      create(details: {
        name: string
        color: string
        icon: string
      }): Promise<{ cookieStoreId: string; name: string }>
    }
  }).contextualIdentities

  if (!contextualIdentities) {
    throw new Error("Brave has not exposed a stable container-tab extension API here yet.")
  }

  const existing = await contextualIdentities.query({ name: "Perplexity" })
  const identity =
    existing[0] ??
    (await contextualIdentities.create({
      name: "Perplexity",
      color: "blue",
      icon: "fingerprint"
    }))

  return (chrome.tabs.create as unknown as (details: {
    url: string
    active: boolean
    pinned: boolean
    cookieStoreId: string
  }) => Promise<chrome.tabs.Tab>)({
    url,
    active: false,
    pinned: true,
    cookieStoreId: identity.cookieStoreId
  })
}

async function createManagedTab(url: string, mode: LaunchMode): Promise<chrome.tabs.Tab> {
  if (mode === "container") return createContainerTab(url)
  return chrome.tabs.create({ url, active: false, pinned: true })
}

function getViewportSize(node: HTMLElement | null) {
  if (!node) return DEFAULT_VIEWPORT
  const rect = node.getBoundingClientRect()
  return {
    width: Math.max(320, Math.round(rect.width || DEFAULT_VIEWPORT.width)),
    height: Math.max(420, Math.round(rect.height || DEFAULT_VIEWPORT.height))
  }
}

export function PerplexitySection() {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<LaunchMode>("regular")
  const [remoteTab, setRemoteTab] = useState<RemoteTabState | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>("Ready to create a managed Perplexity tab.")
  const [busy, setBusy] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attachedTabRef = useRef<number | null>(null)
  const screencastTabRef = useRef<number | null>(null)
  const screencastActiveRef = useRef(false)

  const searchUrl = useMemo(() => buildPerplexitySearchUrl(query), [query])

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((res) => {
      const stored = res[STORAGE_KEY] as StoredState | undefined
      if (stored?.query) setQuery(stored.query)
      if (stored?.mode) setMode(stored.mode)
      if (stored?.tabId && stored.url) {
        setRemoteTab({ tabId: stored.tabId, url: stored.url })
      }
    })
  }, [])

  useEffect(() => {
    void chrome.storage.local.set({
      [STORAGE_KEY]: {
        query,
        mode,
        tabId: remoteTab?.tabId ?? null,
        url: remoteTab?.url ?? ""
      } satisfies StoredState
    })
  }, [mode, query, remoteTab])

  const scheduleCapture = (delay = 450) => {
    if (captureTimer.current) clearTimeout(captureTimer.current)
    captureTimer.current = setTimeout(() => {
      void captureRemote()
    }, delay)
  }

  const stopScreencast = async (tabId = screencastTabRef.current) => {
    if (!tabId) return
    try {
      await sendDebugCommand(tabId, "Page.stopScreencast")
    } catch {
      // The tab may already be gone or screencast may never have started.
    }
    if (screencastTabRef.current === tabId) {
      screencastTabRef.current = null
      screencastActiveRef.current = false
    }
  }

  const startScreencast = async (tabId: number) => {
    if (screencastTabRef.current === tabId && screencastActiveRef.current) return true
    if (screencastTabRef.current && screencastTabRef.current !== tabId) {
      await stopScreencast(screencastTabRef.current)
    }
    const size = getViewportSize(viewportRef.current)
    try {
      await sendDebugCommand(tabId, "Page.startScreencast", {
        format: "jpeg",
        quality: 74,
        maxWidth: size.width,
        maxHeight: size.height,
        everyNthFrame: 1
      })
      screencastTabRef.current = tabId
      screencastActiveRef.current = true
      return true
    } catch (err) {
      screencastTabRef.current = null
      screencastActiveRef.current = false
      setStatus(
        err instanceof Error
          ? `Live stream unavailable; using manual refresh. ${err.message}`
          : "Live stream unavailable; using manual refresh."
      )
      return false
    }
  }

  const attachAndPrepare = async (tabId: number) => {
    await debuggerAttach(tabId)
    attachedTabRef.current = tabId
    const size = getViewportSize(viewportRef.current)
    await sendDebugCommand(tabId, "Page.enable")
    await sendDebugCommand(tabId, "Runtime.enable")
    await sendDebugCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false
    })
    return startScreencast(tabId)
  }

  const captureRemote = async () => {
    if (!remoteTab) return
    try {
      const streaming = await attachAndPrepare(remoteTab.tabId)
      if (streaming) {
        setStatus("Live Perplexity stream is active in the rail viewport.")
        return
      }
      const size = getViewportSize(viewportRef.current)
      await sendDebugCommand(remoteTab.tabId, "Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false
      })
      const result = await sendDebugCommand<{ data: string }>(remoteTab.tabId, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 78,
        captureBeyondViewport: false
      })
      setScreenshot(`data:image/jpeg;base64,${result.data}`)
      setStatus("Perplexity view refreshed.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const openRemote = async (url: string) => {
    setBusy(true)
    setStatus("Opening managed Perplexity tab...")
    try {
      const existing = await getExistingTab(remoteTab?.tabId)
      let tab: chrome.tabs.Tab
      if (existing?.id) {
        tab = await chrome.tabs.update(existing.id, { url, active: false, pinned: true })
      } else {
        try {
          tab = await createManagedTab(url, mode)
        } catch (err) {
          if (mode !== "container") throw err
          setStatus(`${err instanceof Error ? err.message : String(err)} Using a regular managed tab instead.`)
          tab = await createManagedTab(url, "regular")
        }
      }
      if (!tab.id) throw new Error("Managed Perplexity tab did not return a tab id.")
      setRemoteTab({ tabId: tab.id, url })
      setScreenshot(null)
      await attachAndPrepare(tab.id)
      scheduleCapture(250)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const closeRemote = async () => {
    if (!remoteTab) return
    setBusy(true)
    try {
      await debuggerDetach(remoteTab.tabId)
      attachedTabRef.current = null
      screencastTabRef.current = null
      screencastActiveRef.current = false
      await chrome.tabs.remove(remoteTab.tabId)
      setRemoteTab(null)
      setScreenshot(null)
      setStatus("Closed the managed Perplexity tab.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const focusRemote = async () => {
    if (!remoteTab) return
    try {
      const tab = await chrome.tabs.get(remoteTab.tabId)
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true })
      await chrome.tabs.update(remoteTab.tabId, { active: true })
      setStatus("Focused the real Perplexity tab.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const remotePoint = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const size = getViewportSize(event.currentTarget)
    return {
      x: Math.max(0, Math.min(size.width, ((event.clientX - rect.left) / rect.width) * size.width)),
      y: Math.max(0, Math.min(size.height, ((event.clientY - rect.top) / rect.height) * size.height))
    }
  }

  const clickRemote = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!remoteTab) return
    setInteractive(true)
    const { x, y } = remotePoint(event)
    try {
      await attachAndPrepare(remoteTab.tabId)
      await sendDebugCommand(remoteTab.tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1
      })
      await sendDebugCommand(remoteTab.tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1
      })
      scheduleCapture(80)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const scrollRemote = async (event: React.WheelEvent<HTMLDivElement>) => {
    if (!remoteTab) return
    event.preventDefault()
    const { x, y } = remotePoint(event)
    try {
      await attachAndPrepare(remoteTab.tabId)
      await sendDebugCommand(remoteTab.tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: event.deltaX,
        deltaY: event.deltaY
      })
      scheduleCapture(80)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const keyRemote = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!remoteTab || !interactive) return
    if (event.metaKey || event.ctrlKey) return
    event.preventDefault()
    try {
      await attachAndPrepare(remoteTab.tabId)
      if (event.key.length === 1) {
        await sendDebugCommand(remoteTab.tabId, "Input.insertText", { text: event.key })
      } else {
        const code = SPECIAL_KEY_CODES[event.key]
        if (!code) return
        await sendDebugCommand(remoteTab.tabId, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code
        })
        await sendDebugCommand(remoteTab.tabId, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code
        })
      }
      scheduleCapture(80)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    const onEvent = (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, unknown>
    ) => {
      if (method !== "Page.screencastFrame" || source.tabId !== attachedTabRef.current) return
      const frame = params as unknown as ScreencastFrameParams | undefined
      if (!frame?.data || typeof frame.sessionId !== "number" || !source.tabId) return
      setScreenshot(`data:image/jpeg;base64,${frame.data}`)
      void sendDebugCommand(source.tabId, "Page.screencastFrameAck", {
        sessionId: frame.sessionId
      }).catch(() => undefined)
    }
    const onDetach = (source: chrome.debugger.Debuggee) => {
      if (source.tabId !== attachedTabRef.current) return
      attachedTabRef.current = null
      screencastTabRef.current = null
      screencastActiveRef.current = false
      setStatus("Perplexity debugger session detached.")
    }
    chrome.debugger.onEvent.addListener(onEvent)
    chrome.debugger.onDetach.addListener(onDetach)
    return () => {
      chrome.debugger.onEvent.removeListener(onEvent)
      chrome.debugger.onDetach.removeListener(onDetach)
      if (captureTimer.current) clearTimeout(captureTimer.current)
      const attachedTab = attachedTabRef.current
      if (attachedTab) {
        void stopScreencast(attachedTab).finally(() => void debuggerDetach(attachedTab))
      }
    }
  }, [])

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-fg" data-testid="perplexity-section">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Perplexity</h1>
            <p className="truncate text-[11px] text-fg/45">Managed tab rendered in the rail</p>
          </div>
          <span className="rounded-full border border-success/25 bg-success/10 px-2 py-1 text-[10px] font-medium text-success">
            remote tab
          </span>
        </div>
      </header>

      <form
        className="border-b border-border bg-card/25 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void openRemote(searchUrl)
        }}
      >
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-fg/45">
          Ask Perplexity in the rail
        </label>
        <div className="flex gap-2">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Perplexity without sharing the current page..."
            className="min-h-[58px] flex-1 resize-none rounded-lg border border-border bg-input px-3 py-2 text-xs leading-5 text-fg outline-none placeholder:text-fg/30 focus:border-primary/60"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-primary px-2 py-2 text-[11px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? (
              <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <LeoIcon name="search" size={15} />
            )}
            Search
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void openRemote(PERPLEXITY_HOME)}
            disabled={busy}
            className="rounded-full border border-border bg-bg/60 px-2 py-1 text-[10px] text-fg/60 hover:bg-accent disabled:opacity-45"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => void openRemote(PERPLEXITY_LIBRARY)}
            disabled={busy}
            className="rounded-full border border-border bg-bg/60 px-2 py-1 text-[10px] text-fg/60 hover:bg-accent disabled:opacity-45"
          >
            Library
          </button>
          <button
            type="button"
            onClick={() => void captureRemote()}
            disabled={busy || !remoteTab}
            className="rounded-full border border-border bg-bg/60 px-2 py-1 text-[10px] text-fg/60 hover:bg-accent disabled:opacity-45"
          >
            Refresh view
          </button>
          <button
            type="button"
            onClick={() => void focusRemote()}
            disabled={!remoteTab}
            className="rounded-full border border-border bg-bg/60 px-2 py-1 text-[10px] text-fg/60 hover:bg-accent disabled:opacity-45"
          >
            Focus tab
          </button>
          <button
            type="button"
            onClick={() => void closeRemote()}
            disabled={busy || !remoteTab}
            className="rounded-full border border-border bg-bg/60 px-2 py-1 text-[10px] text-fg/60 hover:bg-accent disabled:opacity-45"
          >
            Close
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-bg/60 p-1 text-[11px]">
          {(["regular", "container"] as LaunchMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`rounded-md px-2 py-1.5 capitalize transition-colors ${
                mode === item ? "bg-accent text-fg" : "text-fg/45 hover:text-fg"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </form>

      {status && (
        <div className="border-b border-border bg-primary/10 px-3 py-2 text-[11px] leading-5 text-primary">
          {status}
        </div>
      )}

      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label="Perplexity managed browser viewport"
        className={`relative min-h-0 flex-1 overflow-hidden bg-white outline-none ${interactive ? "ring-1 ring-primary/50" : ""}`}
        onClick={clickRemote}
        onWheel={scrollRemote}
        onKeyDown={keyRemote}
      >
        {screenshot ? (
          <img
            src={screenshot}
            alt="Perplexity remote tab"
            draggable={false}
            className="h-full w-full select-none object-fill"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-5 text-center text-bg">
            <div className="max-w-[300px] rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-center text-black/60">
                <LeoIcon name="search" size={18} />
              </div>
              <PretextTextBlock
                text="Press Login or Search to create a pinned managed Perplexity tab. This rail renders that tab here, so Perplexity loads as a real first-party page instead of a blocked iframe."
                className="text-[11px] leading-5 text-black/65"
              >
                Press Login or Search to create a pinned managed Perplexity tab. This rail renders
                that tab here, so Perplexity loads as a real first-party page instead of a blocked
                iframe.
              </PretextTextBlock>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card/20 px-3 py-2 text-[10px] leading-4 text-fg/45">
        Click the viewport once, then type to interact with Perplexity. The rail uses a live
        DevTools screencast stream, so interaction should no longer wait for polling refreshes.
      </div>
    </section>
  )
}
