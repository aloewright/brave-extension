import { useState, useEffect, useCallback, useRef } from "react"
import type { CLIBackend, NativeHostResponse } from "../types"

interface UseNativeHostOptions {
  onStdout?: (data: string, pid: number, backend?: CLIBackend) => void
  onStderr?: (data: string, pid: number, backend?: CLIBackend) => void
  onExit?: (code: number, pid: number, backend?: CLIBackend) => void
  onError?: (error: string, backend?: CLIBackend) => void
  onSessionStarted?: (backend: CLIBackend, pid: number) => void
  onSessionEnded?: (backend: CLIBackend, code: number) => void
  onSessionReset?: (backend: CLIBackend) => void
  onMcpList?: (servers: any[]) => void
  onPtyData?: (sessionId: string, data: string) => void
  onPtyExit?: (sessionId: string, exitCode: number, signal?: number) => void
  onPtySpawned?: (sessionId: string, pid: number) => void
  onPtyError?: (sessionId: string | undefined, error: string) => void
}

export function useNativeHost(opts: UseNativeHostOptions = {}) {
  const [connected, setConnected] = useState(false)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "ai-dev-sidebar" })
    portRef.current = port

    port.onMessage.addListener((msg: any) => {
      if (msg.type === "native-response") {
        const payload = msg.payload as NativeHostResponse
        setConnected(true)

        switch (payload.type) {
          case "stdout":
            optsRef.current.onStdout?.(payload.data, payload.pid || 0, payload.backend)
            break
          case "stderr":
            optsRef.current.onStderr?.(payload.data, payload.pid || 0, payload.backend)
            break
          case "exit":
            optsRef.current.onExit?.(payload.code || 0, payload.pid || 0, payload.backend)
            break
          case "error":
            optsRef.current.onError?.(payload.data, payload.backend)
            break
          case "session-started":
            optsRef.current.onSessionStarted?.(payload.backend!, payload.pid || 0)
            break
          case "session-ended":
            optsRef.current.onSessionEnded?.(payload.backend!, payload.code || 0)
            break
          case "session-reset":
            optsRef.current.onSessionReset?.(payload.backend!)
            break
        }

        // PTY events
        const t = (payload as any).type as string
        if (t === "pty.data") {
          optsRef.current.onPtyData?.((payload as any).sessionId, (payload as any).data)
        } else if (t === "pty.exit") {
          optsRef.current.onPtyExit?.(
            (payload as any).sessionId,
            (payload as any).exitCode ?? 0,
            (payload as any).signal
          )
        } else if (t === "pty.spawned") {
          optsRef.current.onPtySpawned?.((payload as any).sessionId, (payload as any).pid ?? 0)
        } else if (t === "pty.error") {
          optsRef.current.onPtyError?.((payload as any).sessionId, (payload as any).error)
        }

        // mcp responses come back with type "mcp" — payload.data is JSON
        if ((payload as any).type === "mcp") {
          try {
            const parsed = JSON.parse((payload as any).data || "[]")
            if (Array.isArray(parsed)) {
              optsRef.current.onMcpList?.(parsed)
            }
          } catch {}
        }
      }

      if (msg.type === "native-disconnected") {
        setConnected(false)
        optsRef.current.onError?.("Native host disconnected: " + msg.error)
      }

      if (msg.type === "scrape-result") {
        if ((optsRef.current as any).onScrape) {
          (optsRef.current as any).onScrape(msg.payload)
        }
      }

      if (msg.type === "selection") {
        if ((optsRef.current as any).onSelection) {
          (optsRef.current as any).onSelection(msg.payload)
        }
      }
    })

    port.onDisconnect.addListener(() => {
      setConnected(false)
    })

    // Ping to check connection
    port.postMessage({ type: "native-send", payload: { type: "ping" } })

    return () => {
      port.disconnect()
      portRef.current = null
    }
  }, [])

  const send = useCallback((payload: any) => {
    portRef.current?.postMessage({ type: "native-send", payload })
  }, [])

  const exec = useCallback((command: string, backend: CLIBackend, cwd?: string) => {
    send({ type: "exec", command, backend, cwd })
  }, [send])

  const execRaw = useCallback((command: string, args?: string[], cwd?: string) => {
    send({ type: "exec-raw", command, args, cwd })
  }, [send])

  const kill = useCallback((pid: number) => {
    send({ type: "kill", pid })
  }, [send])

  const resetBackend = useCallback((backend: CLIBackend) => {
    send({ type: "reset-backend", backend })
  }, [send])

  const getMCPServers = useCallback((configPath?: string) => {
    send({ type: "mcp", action: "list", configPath })
  }, [send])

  const addMCPServer = useCallback((server: any, configPath?: string) => {
    send({ type: "mcp", action: "add", server, configPath })
  }, [send])

  const ptySpawn = useCallback(
    (sessionId: string, opts?: { cwd?: string; cols?: number; rows?: number; env?: Record<string, string> }) => {
      send({ type: "pty.spawn", sessionId, ...(opts || {}) })
    },
    [send]
  )

  const ptyWrite = useCallback(
    (sessionId: string, data: string) => {
      send({ type: "pty.write", sessionId, data })
    },
    [send]
  )

  const ptyResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      send({ type: "pty.resize", sessionId, cols, rows })
    },
    [send]
  )

  const ptyKill = useCallback(
    (sessionId: string) => {
      send({ type: "pty.kill", sessionId })
    },
    [send]
  )

  return {
    connected,
    send,
    exec,
    execRaw,
    kill,
    resetBackend,
    getMCPServers,
    addMCPServer,
    ptySpawn,
    ptyWrite,
    ptyResize,
    ptyKill
  }
}
