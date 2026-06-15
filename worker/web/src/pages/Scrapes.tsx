import { useEffect, useState, type ReactNode } from "react"
import { useAuth } from "../auth"
import type { ScrapeJobRow, ScrapeRunRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"
import { StatusBadge } from "../components/StatusBadge"

type ScheduleType = ScrapeJobRow["scheduleType"]
type DownloadFormat = "json" | "text" | "html"
type AdHocMode = "single" | "subpages"

function formatDate(ms: number | null): string {
  if (!ms) return "Never"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(ms))
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function runTitle(run: ScrapeRunRow): string {
  return run.title || hostLabel(run.finalUrl || run.url)
}

function scheduleLabel(job: ScrapeJobRow): string {
  if (job.scheduleType === "manual") return "Manual"
  if (job.scheduleType === "interval") return `Every ${job.intervalMinutes ?? 60} min`
  return job.cron ? `Cron ${job.cron}` : "Cron"
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function snippet(text: string): string {
  return text.length > 360 ? `${text.slice(0, 360).trim()}...` : text
}

function safeFilenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "scrape"
}

function downloadFilename(run: ScrapeRunRow, ext: string): string {
  const stamp = new Date(run.createdAt).toISOString().replace(/[:.]/g, "-")
  return `${safeFilenamePart(run.title || hostLabel(run.finalUrl || run.url))}-${stamp}.${ext}`
}

function runTextExport(run: ScrapeRunRow): string {
  const links = run.links
    .map((link) => `- ${link.text || link.href}: ${link.href}`)
    .join("\n")
  const images = run.images
    .map((image) => `- ${image.alt || image.src}: ${image.src}`)
    .join("\n")
  const meta = Object.entries(run.meta)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")

  return [
    runTitle(run),
    "",
    `URL: ${run.url}`,
    run.finalUrl ? `Final URL: ${run.finalUrl}` : null,
    `Source: ${run.source}`,
    `Status: ${run.status}${run.statusMessage ? ` - ${run.statusMessage}` : ""}`,
    `Created: ${new Date(run.createdAt).toISOString()}`,
    `Content type: ${run.contentType || "unknown"}`,
    `Size: ${formatBytes(run.sizeBytes)}`,
    `Duration: ${formatDuration(run.durationMs)}`,
    `Chunks: ${run.chunkCount}`,
    "",
    "Text",
    "----",
    run.text || "(no extracted text)",
    "",
    "Links",
    "-----",
    links || "(none)",
    "",
    "Images",
    "------",
    images || "(none)",
    "",
    "Metadata",
    "--------",
    meta || "(none)"
  ].filter((line): line is string => line !== null).join("\n")
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportRun(run: ScrapeRunRow, format: DownloadFormat): void {
  if (format === "json") {
    downloadTextFile(
      downloadFilename(run, "json"),
      JSON.stringify(run, null, 2),
      "application/json;charset=utf-8"
    )
    return
  }
  if (format === "html") {
    downloadTextFile(
      downloadFilename(run, "html"),
      run.html || run.text,
      "text/html;charset=utf-8"
    )
    return
  }
  downloadTextFile(downloadFilename(run, "txt"), runTextExport(run), "text/plain;charset=utf-8")
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</label>
}

function DetailBlock({
  title,
  count,
  children,
  open = false
}: {
  title: string
  count?: number
  children: ReactNode
  open?: boolean
}) {
  return (
    <details open={open} className="rounded border border-fg/10 bg-bg/40 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-fg">
        {title}{typeof count === "number" ? ` (${count.toLocaleString()})` : ""}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

export function Scrapes() {
  const { client } = useAuth()
  const [runs, setRuns] = useState<ScrapeRunRow[] | null>(null)
  const [jobs, setJobs] = useState<ScrapeJobRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runUrl, setRunUrl] = useState("")
  const [runMode, setRunMode] = useState<AdHocMode>("single")
  const [jobUrl, setJobUrl] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [jobSearch, setJobSearch] = useState("")
  const [scheduleType, setScheduleType] = useState<ScheduleType>("manual")
  const [intervalMinutes, setIntervalMinutes] = useState("60")
  const [cron, setCron] = useState("0 * * * *")
  const [submittingRun, setSubmittingRun] = useState(false)
  const [submittingJob, setSubmittingJob] = useState(false)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ScrapeRunRow | null>(null)
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null)
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null)

  function upsertRun(run: ScrapeRunRow) {
    setRuns((current) => current ? [run, ...current.filter((row) => row.id !== run.id)] : [run])
  }

  function upsertRuns(next: ScrapeRunRow[]) {
    setRuns((current) => {
      const existing = current ?? []
      const ids = new Set(next.map((row) => row.id))
      return [...next, ...existing.filter((row) => !ids.has(row.id))]
    })
  }

  async function load() {
    setError(null)
    const [nextRuns, nextJobs] = await Promise.all([
      client.scrapes.listRuns({ limit: 100 }),
      client.scrapes.listJobs({ q: jobSearch.trim() || undefined })
    ])
    setRuns(nextRuns.scrapes)
    setJobs(nextJobs.jobs)
    setSelectedRun((current) => current ? nextRuns.scrapes.find((row) => row.id === current.id) ?? null : null)
  }

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([client.scrapes.listRuns({ limit: 100 }), client.scrapes.listJobs()])
      .then(([nextRuns, nextJobs]) => {
        if (!cancelled) {
          setRuns(nextRuns.scrapes)
          setJobs(nextJobs.jobs)
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
    return () => { cancelled = true }
  }, [client])

  async function submitRun(event: React.FormEvent) {
    event.preventDefault()
    if (!runUrl.trim()) return
    setSubmittingRun(true)
    setError(null)
    try {
      const result = await client.scrapes.runUrl(runUrl.trim(), {
        crawl: runMode === "subpages"
      })
      const scraped = result.scrapes ?? [result.scrape]
      upsertRuns(scraped)
      setSelectedRun(result.scrape)
      setRunUrl("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmittingRun(false)
    }
  }

  async function submitJob(event: React.FormEvent) {
    event.preventDefault()
    if (!jobUrl.trim()) return
    setSubmittingJob(true)
    setError(null)
    try {
      const payload = {
        url: jobUrl.trim(),
        title: jobTitle.trim() || undefined,
        scheduleType,
        intervalMinutes: scheduleType === "interval" ? Number(intervalMinutes) : undefined,
        cron: scheduleType === "cron" ? cron.trim() : undefined
      }
      const { job } = await client.scrapes.createJob(payload)
      setJobs((current) => current ? [job, ...current.filter((row) => row.id !== job.id)] : [job])
      setJobUrl("")
      setJobTitle("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmittingJob(false)
    }
  }

  async function runJob(job: ScrapeJobRow) {
    setRunningJobId(job.id)
    setError(null)
    try {
      const result = await client.scrapes.runJob(job.id)
      setJobs((current) => current?.map((item) => item.id === result.job.id ? result.job : item) ?? current)
      upsertRun(result.scrape)
      setSelectedRun(result.scrape)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunningJobId(null)
    }
  }

  async function deleteJob(job: ScrapeJobRow) {
    setDeletingJobId(job.id)
    setError(null)
    try {
      await client.scrapes.deleteJob(job.id)
      setJobs((current) => current?.filter((item) => item.id !== job.id) ?? current)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingJobId(null)
    }
  }

  async function fetchRunDetails(run: ScrapeRunRow): Promise<ScrapeRunRow> {
    setLoadingRunId(run.id)
    setError(null)
    try {
      const { scrape } = await client.scrapes.getRun(run.id)
      setSelectedRun(scrape)
      setRuns((current) => current?.map((row) => row.id === scrape.id ? scrape : row) ?? current)
      return scrape
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setLoadingRunId(null)
    }
  }

  async function viewRun(run: ScrapeRunRow) {
    setSelectedRun(run)
    await fetchRunDetails(run)
  }

  async function downloadRun(run: ScrapeRunRow, format: DownloadFormat) {
    const key = `${run.id}:${format}`
    setDownloadingRunId(key)
    setError(null)
    try {
      const fullRun = selectedRun?.id === run.id ? selectedRun : await fetchRunDetails(run)
      exportRun(fullRun, format)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDownloadingRunId(null)
    }
  }

  if (error && (!runs || !jobs)) return <ErrorState message={error} />
  if (!runs || !jobs) return <Loading />

  const normalizedJobSearch = jobSearch.trim().toLowerCase()
  const filteredJobs = normalizedJobSearch
    ? jobs.filter((job) => [
      job.title,
      job.url,
      scheduleLabel(job),
      job.lastStatus ?? "",
      job.lastError ?? "",
      hostLabel(job.url)
    ].join(" ").toLowerCase().includes(normalizedJobSearch))
    : jobs

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Scrapes</h1>
          <p className="mt-1 text-sm text-muted">{runs.length} runs · {jobs.length} jobs</p>
        </div>
        <button
          type="button"
          onClick={() => void load().catch((err) => setError((err as Error).message))}
          className="rounded border border-fg/20 px-3 py-2 text-sm font-semibold text-fg hover:bg-fg/10"
        >
          Refresh
        </button>
      </header>

      {error && <ErrorState message={error} />}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={submitRun} className="rounded-lg border border-fg/10 bg-surface p-4">
          <h2 className="text-lg font-semibold">Ad Hoc URL</h2>
          <div className="mt-4 flex flex-col gap-2">
            <FieldLabel>URL</FieldLabel>
            <input
              type="url"
              value={runUrl}
              onChange={(event) => setRunUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <FieldLabel>Scrape mode</FieldLabel>
            <select
              value={runMode}
              onChange={(event) => setRunMode(event.target.value as AdHocMode)}
              className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            >
              <option value="single">Single page only</option>
              <option value="subpages">Page and same-origin link tree</option>
            </select>
            <p className="text-xs leading-5 text-muted">
              Subpages mode recursively follows same-origin links discovered from the starting page.
            </p>
          </div>
          <button
            type="submit"
            disabled={submittingRun || !runUrl.trim()}
            className="mt-4 rounded bg-accent px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            {submittingRun ? "Scraping" : runMode === "subpages" ? "Scrape URL + subpages" : "Scrape URL"}
          </button>
        </form>

        <form onSubmit={submitJob} className="rounded-lg border border-fg/10 bg-surface p-4">
          <h2 className="text-lg font-semibold">Job</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <FieldLabel>URL</FieldLabel>
              <input
                type="url"
                value={jobUrl}
                onChange={(event) => setJobUrl(event.target.value)}
                placeholder="https://example.com/feed"
                className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel>Title</FieldLabel>
              <input
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder="Source name"
                className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel>Schedule</FieldLabel>
              <select
                value={scheduleType}
                onChange={(event) => setScheduleType(event.target.value as ScheduleType)}
                className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="manual">Manual</option>
                <option value="interval">Interval</option>
                <option value="cron">Cron</option>
              </select>
            </div>
            {scheduleType === "interval" && (
              <div className="flex flex-col gap-2">
                <FieldLabel>Minutes</FieldLabel>
                <input
                  type="number"
                  min={5}
                  max={43200}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                  className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              </div>
            )}
            {scheduleType === "cron" && (
              <div className="flex flex-col gap-2">
                <FieldLabel>Cron</FieldLabel>
                <input
                  value={cron}
                  onChange={(event) => setCron(event.target.value)}
                  placeholder="0 * * * *"
                  className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
                />
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={submittingJob || !jobUrl.trim()}
            className="mt-4 rounded bg-accent px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            {submittingJob ? "Creating" : "Create Job"}
          </button>
        </form>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Jobs</h2>
            <p className="mt-1 text-xs text-muted">
              {filteredJobs.length.toLocaleString()} of {jobs.length.toLocaleString()} jobs shown
            </p>
          </div>
          <div className="flex min-w-64 flex-col gap-2">
            <FieldLabel>Search jobs</FieldLabel>
            <input
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Search title, URL, schedule, status..."
              className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
        </div>
        {jobs.length === 0 ? (
          <EmptyState message="No scrape jobs yet." />
        ) : filteredJobs.length === 0 ? (
          <EmptyState message="No scrape jobs match that search." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filteredJobs.map((job) => (
              <li key={job.id} className="rounded-lg border border-fg/10 bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{job.title || hostLabel(job.url)}</div>
                    <a href={job.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-muted hover:text-fg">
                      {job.url}
                    </a>
                  </div>
                  <StatusBadge status={job.lastStatus ?? (job.enabled ? "enabled" : "paused")} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted">
                  <div>
                    <dt className="uppercase tracking-wide">Schedule</dt>
                    <dd className="mt-1 text-fg">{scheduleLabel(job)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Next</dt>
                    <dd className="mt-1 text-fg">{formatDate(job.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Last</dt>
                    <dd className="mt-1 text-fg">{formatDate(job.lastRunAt)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Result</dt>
                    <dd className="mt-1 text-fg">{job.lastError || job.lastStatus || "Not run"}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runJob(job)}
                    disabled={runningJobId === job.id}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {runningJobId === job.id ? "Running" : "Run"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteJob(job)}
                    disabled={deletingJobId === job.id}
                    className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
                  >
                    {deletingJobId === job.id ? "Deleting" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Runs</h2>
          {selectedRun && (
            <button
              type="button"
              onClick={() => setSelectedRun(null)}
              className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10"
            >
              Close reader
            </button>
          )}
        </div>
        {selectedRun && (
          <article className="mb-4 rounded-lg border border-fg/10 bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Selected run</div>
                <h3 className="mt-1 truncate text-xl font-semibold">{runTitle(selectedRun)}</h3>
                <a
                  href={selectedRun.finalUrl || selectedRun.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-xs text-muted hover:text-fg"
                >
                  {selectedRun.finalUrl || selectedRun.url}
                </a>
              </div>
              <StatusBadge status={selectedRun.status} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted md:grid-cols-4">
              <div>
                <dt className="uppercase tracking-wide">Source</dt>
                <dd className="mt-1 text-fg">{selectedRun.source}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Created</dt>
                <dd className="mt-1 text-fg">{formatDate(selectedRun.createdAt)}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Text</dt>
                <dd className="mt-1 text-fg">{wordCount(selectedRun.text).toLocaleString()} words</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Payload</dt>
                <dd className="mt-1 text-fg">{formatBytes(selectedRun.sizeBytes)} / {selectedRun.chunkCount} chunks</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Duration</dt>
                <dd className="mt-1 text-fg">{formatDuration(selectedRun.durationMs)}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Content type</dt>
                <dd className="mt-1 truncate text-fg">{selectedRun.contentType || "unknown"}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Links</dt>
                <dd className="mt-1 text-fg">{selectedRun.links.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Images</dt>
                <dd className="mt-1 text-fg">{selectedRun.images.length.toLocaleString()}</dd>
              </div>
            </dl>

            {selectedRun.status === "failed" && (
              <p className="mt-4 text-sm text-red-300">{selectedRun.statusMessage || "Scrape failed"}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadRun(selectedRun, "json")}
                disabled={downloadingRunId === `${selectedRun.id}:json`}
                className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
              >
                {downloadingRunId === `${selectedRun.id}:json` ? "Preparing" : "Download JSON"}
              </button>
              <button
                type="button"
                onClick={() => void downloadRun(selectedRun, "text")}
                disabled={downloadingRunId === `${selectedRun.id}:text`}
                className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
              >
                {downloadingRunId === `${selectedRun.id}:text` ? "Preparing" : "Download text"}
              </button>
              <button
                type="button"
                onClick={() => void downloadRun(selectedRun, "html")}
                disabled={downloadingRunId === `${selectedRun.id}:html` || !selectedRun.html}
                className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
              >
                {downloadingRunId === `${selectedRun.id}:html` ? "Preparing" : "Download HTML"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <DetailBlock title="Extracted text" open>
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-sm leading-6 text-fg/90">
                  {selectedRun.text || "(no extracted text)"}
                </pre>
              </DetailBlock>
              <DetailBlock title="Links" count={selectedRun.links.length}>
                {selectedRun.links.length === 0 ? (
                  <p className="text-sm text-muted">No links captured.</p>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-auto text-sm">
                    {selectedRun.links.map((link, index) => (
                      <li key={`${link.href}-${index}`} className="min-w-0">
                        <a href={link.href} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                          {link.href}
                        </a>
                        {link.text && <p className="mt-0.5 text-xs text-muted">{link.text}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailBlock>
              <DetailBlock title="Images" count={selectedRun.images.length}>
                {selectedRun.images.length === 0 ? (
                  <p className="text-sm text-muted">No images captured.</p>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-auto text-sm">
                    {selectedRun.images.map((image, index) => (
                      <li key={`${image.src}-${index}`} className="min-w-0">
                        <a href={image.src} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                          {image.src}
                        </a>
                        {image.alt && <p className="mt-0.5 text-xs text-muted">{image.alt}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailBlock>
              <DetailBlock title="Metadata">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-xs leading-5 text-fg/90">
                  {JSON.stringify(selectedRun.meta, null, 2)}
                </pre>
              </DetailBlock>
              <DetailBlock title="Raw HTML">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-xs leading-5 text-fg/90">
                  {selectedRun.html || "(no HTML captured)"}
                </pre>
              </DetailBlock>
            </div>
          </article>
        )}
        {runs.length === 0 ? (
          <EmptyState message="No scrape runs yet." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {runs.map((run) => (
              <li key={run.id} className="rounded-lg border border-fg/10 bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{runTitle(run)}</div>
                    <a href={run.finalUrl || run.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-muted hover:text-fg">
                      {run.finalUrl || run.url}
                    </a>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{run.source}</span>
                  <span>{formatDate(run.createdAt)}</span>
                  <span>{wordCount(run.text).toLocaleString()} words</span>
                  <span>{run.links.length} links</span>
                  <span>{run.images.length} images</span>
                </div>
                {run.status === "failed" ? (
                  <p className="mt-3 text-sm text-red-300">{run.statusMessage || "Scrape failed"}</p>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-fg/90">{snippet(run.text)}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void viewRun(run)}
                    disabled={loadingRunId === run.id}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {loadingRunId === run.id ? "Loading" : selectedRun?.id === run.id ? "Viewing" : "Read"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadRun(run, "json")}
                    disabled={downloadingRunId === `${run.id}:json`}
                    className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
                  >
                    {downloadingRunId === `${run.id}:json` ? "Preparing" : "Download JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadRun(run, "text")}
                    disabled={downloadingRunId === `${run.id}:text`}
                    className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
                  >
                    {downloadingRunId === `${run.id}:text` ? "Preparing" : "Download text"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
