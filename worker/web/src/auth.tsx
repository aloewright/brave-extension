import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ApiError, createApiClient, type ApiClient } from "./api"

const TOKEN_KEY = "sidebar_token"

interface AuthContextValue {
  token: string
  client: ApiClient
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error("useAuth must be used inside <TokenGate>")
  return v
}

export function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

export function storeToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage unavailable; nothing to do */
  }
}

export function TokenGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => readStoredToken())
  const [cookieAuthed, setCookieAuthed] = useState(false)
  const [cookieProbeDone, setCookieProbeDone] = useState(false)
  const oauthError = new URL(window.location.href).searchParams.get("oauth_error")

  const signOut = useCallback(() => {
    storeToken("")
    setToken("")
    setCookieAuthed(false)
    void fetch("/auth/fly/logout", { redirect: "manual" })
  }, [])

  const client = useMemo(() => createApiClient(token), [token])

  const value = useMemo<AuthContextValue>(() => ({ token, client, signOut }), [token, client, signOut])

  useEffect(() => {
    if (token) {
      setCookieProbeDone(true)
      return
    }
    let cancelled = false
    async function probeCookie() {
      try {
        await createApiClient("").conversations.list({ limit: 1 })
        if (cancelled) return
        setCookieAuthed(true)
        if (oauthError) window.history.replaceState({}, "", "/")
      } catch {
        if (!cancelled) setCookieAuthed(false)
      } finally {
        if (!cancelled) setCookieProbeDone(true)
      }
    }
    void probeCookie()
    return () => {
      cancelled = true
    }
  }, [oauthError, token])

  if (!token && !cookieProbeDone) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted">
        Checking session…
      </div>
    )
  }

  if (!token && !cookieAuthed) {
    return (
      <LoginForm
        oauthError={oauthError}
        onSubmit={(t) => {
          storeToken(t)
          setToken(t)
        }}
      />
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function LoginForm({
  oauthError,
  onSubmit
}: {
  oauthError: string | null
  onSubmit: (token: string) => void
}) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setPending(true)
    setError(null)
    try {
      const probe = createApiClient(trimmed)
      // GET an authed endpoint to confirm the token is valid. /api/conversations
      // returns 200 with [] for any valid token; 401 surfaces ApiError.code.
      await probe.conversations.list({ limit: 1 })
      onSubmit(trimmed)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("That token isn't accepted. Double-check the value you set with `wrangler secret put SIDEBAR_TOKEN`.")
      } else {
        setError((err as Error).message)
      }
    } finally {
      setPending(false)
    }
  }

  async function loginWithFly() {
    setError(null)
    window.location.assign("/auth/fly/start")
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-xl font-semibold">txt.fly.pm</h1>
        <p className="text-sm text-muted">
          Sign in with fly.pm or enter your <code className="font-mono text-fg">X-Sidebar-Token</code>.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={loginWithFly}
          className="rounded bg-accent px-3 py-2 text-bg font-medium disabled:opacity-50"
        >
          Continue with fly.pm
        </button>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-fg/15" />
          <span>or</span>
          <span className="h-px flex-1 bg-fg/15" />
        </div>
        <input
          type="password"
          aria-label="X-Sidebar-Token"
          autoComplete="current-password"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border border-fg/20 bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          placeholder="paste token"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded border border-fg/20 px-3 py-2 text-fg font-medium disabled:opacity-50"
        >
          {pending ? "Checking…" : "Sign in"}
        </button>
        {(error || oauthError) && <div className="text-sm text-red-400" role="alert">{error || oauthError}</div>}
      </form>
    </div>
  )
}

export function SignOutButton() {
  const { signOut } = useAuth()
  return (
    <button
      type="button"
      onClick={signOut}
      className="text-xs text-muted hover:text-fg"
      title="Forget the stored token"
    >
      Sign out
    </button>
  )
}
