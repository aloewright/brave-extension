// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { HighlightRow } from "../../web/src/api"

const mocks = vi.hoisted(() => ({
  client: {
    highlights: {
      list: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }
}))

vi.mock("../../web/src/auth", () => ({
  useAuth: () => ({ client: mocks.client })
}))

import { Highlights } from "../../web/src/pages/Highlights"

function highlight(overrides: Partial<HighlightRow> = {}): HighlightRow {
  return {
    id: "h1",
    text: "https://85d376fc54617bcb57185547f08e528b.r2.cloudflarestorage.com/03abb7bd876e2d8c2b06e310bf64fea4ee363cdd4450cb6a5176c5c795d485fea832718c25804d70323380100a",
    note: "redacted_long_unbroken_token_fixture_1tPRs5sbBHL1329mojY7mY1g12e7c455",
    tags: JSON.stringify(["03abb7bd876e2d8c2b06e310bf64fea4ee363cdd4450cb6a5176c5c795d485fea"]),
    source_url: "https://dash.cloudflare.com",
    source_title: "R2 Object Storage | Overview | aloe | Cloudflare",
    source_host: "dash.cloudflare.com",
    source_favicon: null,
    context_before: null,
    context_after: null,
    source: "extension",
    chunk_count: 1,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides
  }
}

describe("Highlights page", () => {
  beforeEach(() => {
    mocks.client.highlights.list.mockResolvedValue({ highlights: [highlight()] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("wraps long unbroken highlight text inside its card", async () => {
    render(<Highlights />)

    const text = await screen.findByText(/^https:\/\/85d376/)
    const card = text.closest("li")

    expect(card).toHaveClass("min-w-0")
    expect(card).toHaveClass("overflow-hidden")
    expect(text).toHaveClass("[overflow-wrap:anywhere]")
    expect(text).toHaveClass("break-words")
    expect(screen.getByText(/^redacted_long_unbroken_token_fixture_/)).toHaveClass("[overflow-wrap:anywhere]")
    expect(screen.getByText(/^03abb7/)).toHaveClass("[overflow-wrap:anywhere]")
  })
})
