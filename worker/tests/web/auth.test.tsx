// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TokenGate, useAuth, readStoredToken, storeToken } from "../../web/src/auth"

function Inside() {
  const { token } = useAuth()
  return <div data-testid="token">{token}</div>
}

function mockFetchSuccess() {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ conversations: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  ))
}

function mockFetch401() {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: "unauthorized", message: "bad" } }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  ))
}

describe("TokenGate", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("renders the login form when no token is stored", () => {
    render(<TokenGate><Inside /></TokenGate>)
    expect(screen.getByPlaceholderText("paste token")).toBeInTheDocument()
    expect(screen.queryByTestId("token")).toBeNull()
  })

  it("accepts a valid token, stores it, and reveals the children", async () => {
    mockFetchSuccess()
    render(<TokenGate><Inside /></TokenGate>)
    fireEvent.change(screen.getByPlaceholderText("paste token"), { target: { value: "abc" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))
    await waitFor(() => expect(screen.getByTestId("token")).toHaveTextContent("abc"))
    expect(readStoredToken()).toBe("abc")
  })

  it("surfaces a friendly message on 401 and keeps the form rendered", async () => {
    mockFetch401()
    render(<TokenGate><Inside /></TokenGate>)
    fireEvent.change(screen.getByPlaceholderText("paste token"), { target: { value: "bad" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't accepted/))
    expect(screen.queryByTestId("token")).toBeNull()
    expect(readStoredToken()).toBe("")
  })

  it("hydrates from localStorage on mount", () => {
    storeToken("preset")
    render(<TokenGate><Inside /></TokenGate>)
    expect(screen.getByTestId("token")).toHaveTextContent("preset")
  })
})
