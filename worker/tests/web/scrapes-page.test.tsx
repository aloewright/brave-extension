// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ScrapeRunRow } from "../../web/src/api"

const mocks = vi.hoisted(() => ({
  client: {
    scrapes: {
      listRuns: vi.fn(),
      listJobs: vi.fn(),
      getRun: vi.fn(),
      runUrl: vi.fn(),
      createJob: vi.fn(),
      runJob: vi.fn(),
      deleteJob: vi.fn()
    }
  }
}))

vi.mock("../../web/src/auth", () => ({
  useAuth: () => ({ client: mocks.client })
}))

import { Scrapes } from "../../web/src/pages/Scrapes"

const fullRun: ScrapeRunRow = {
  id: "s1",
  jobId: "j1",
  source: "server",
  url: "https://example.com/start",
  finalUrl: "https://example.com/final",
  title: "Example Run",
  text: "Complete article text from the scrape. This is much longer than the card preview.",
  html: "<main><p>Complete article text from the scrape.</p></main>",
  links: [{ href: "https://example.com/a", text: "A link" }],
  images: [{ src: "https://example.com/a.png", alt: "A image" }],
  meta: { description: "Example description" },
  status: "ready",
  statusMessage: null,
  contentType: "text/html",
  sizeBytes: 2048,
  durationMs: 325,
  chunkCount: 2,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100
}

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

describe("Scrapes page", () => {
  const createObjectURL = vi.fn((_object: Blob | MediaSource) => "blob:scrape-export")
  const revokeObjectURL = vi.fn()
  let anchorClick: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.client.scrapes.listRuns.mockResolvedValue({ scrapes: [fullRun] })
    mocks.client.scrapes.listJobs.mockResolvedValue({ jobs: [] })
    mocks.client.scrapes.getRun.mockResolvedValue({ scrape: fullRun })
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    })
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    anchorClick.mockRestore()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL
    })
  })

  it("opens a full scrape reader and exports the complete JSON payload", async () => {
    render(<Scrapes />)

    expect(await screen.findByText("Example Run")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Read" }))

    await waitFor(() => expect(mocks.client.scrapes.getRun).toHaveBeenCalledWith("s1"))
    expect(await screen.findByText("Selected run")).toBeInTheDocument()
    expect(screen.getAllByText(/Complete article text from the scrape/).length).toBeGreaterThan(0)
    expect(screen.getByText("https://example.com/a")).toBeInTheDocument()
    expect(screen.getByText("https://example.com/a.png")).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "Download JSON" })[0]!)

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const blob = createObjectURL.mock.calls.at(-1)?.[0]
    expect(blob).toBeInstanceOf(Blob)
    if (!(blob instanceof Blob)) throw new Error("expected Blob export")
    const exported = JSON.parse(await blob.text()) as ScrapeRunRow
    expect(exported).toMatchObject({
      id: "s1",
      html: fullRun.html,
      links: fullRun.links,
      images: fullRun.images,
      meta: fullRun.meta
    })
    expect(anchorClick).toHaveBeenCalled()
  })
})
