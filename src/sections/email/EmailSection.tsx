import { useEffect, useMemo, useState } from "react"
import { LeoIcon } from "../../components/leo"

type EmailTab = "inbox" | "activity" | "compose"

type MailInboxItem = {
  id: string
  subject: string
  participants: string
  snippet: string
  receivedAt?: number
  codes: string[]
}

type MailActivityItem = {
  id: string
  type: "open" | "click" | "event"
  email: string
  subject: string
  url?: string
  at?: number
}

type ComposeDraft = {
  to: string
  subject: string
  body: string
}

const QUICK_DRAFT_KEY = "email.quickComposeDraft.v1"

const EMPTY_DRAFT: ComposeDraft = {
  to: "",
  subject: "",
  body: ""
}

export function EmailSection() {
  const [tab, setTab] = useState<EmailTab>("inbox")
  const [inbox, setInbox] = useState<MailInboxItem[]>([])
  const [activity, setActivity] = useState<MailActivityItem[]>([])
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_DRAFT)
  const [pageEmails, setPageEmails] = useState<string[]>([])
  const [loadingInbox, setLoadingInbox] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [inboxError, setInboxError] = useState("")
  const [activityError, setActivityError] = useState("")
  const [toast, setToast] = useState("")

  useEffect(() => {
    void refreshInbox()
    void refreshActivity()
    chrome.storage.local.get(QUICK_DRAFT_KEY).then((result) => {
      const saved = result[QUICK_DRAFT_KEY] as Partial<ComposeDraft> | undefined
      if (saved && typeof saved === "object") {
        setDraft({
          to: typeof saved.to === "string" ? saved.to : "",
          subject: typeof saved.subject === "string" ? saved.subject : "",
          body: typeof saved.body === "string" ? saved.body : ""
        })
      }
    }).catch(() => {})
  }, [])

  const codeCount = useMemo(
    () => inbox.reduce((count, item) => count + item.codes.length, 0),
    [inbox]
  )

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(""), 1500)
  }

  async function refreshInbox() {
    setLoadingInbox(true)
    setInboxError("")
    try {
      const response = await sendRuntimeMessage<{
        ok: boolean
        items?: MailInboxItem[]
        error?: string
      }>({ type: "MAIL_INBOX_LIST_REQUEST" })
      setInbox(response.items ?? [])
      if (!response.ok) setInboxError(response.error || "Could not load inbox")
    } catch (err) {
      setInboxError(err instanceof Error ? err.message : "Could not load inbox")
    } finally {
      setLoadingInbox(false)
    }
  }

  async function refreshActivity() {
    setLoadingActivity(true)
    setActivityError("")
    try {
      const response = await sendRuntimeMessage<{
        ok: boolean
        items?: MailActivityItem[]
        error?: string
      }>({ type: "MAIL_ACTIVITY_LIST_REQUEST" })
      setActivity(response.items ?? [])
      if (!response.ok) setActivityError(response.error || "Could not load activity")
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : "Could not load activity")
    } finally {
      setLoadingActivity(false)
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code)
    showToast("Code copied")
  }

  async function fillCode(code: string) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!activeTab?.id) {
      showToast("No active tab")
      return
    }

    const response = await sendTabMessage<{ ok: boolean; error?: string }>(
      activeTab.id,
      { type: "MAIL_2FA_FILL_CODE", code }
    )
    showToast(response.ok ? "Code filled" : response.error || "No code field found")
  }

  async function saveDraft() {
    await chrome.storage.local.set({ [QUICK_DRAFT_KEY]: draft })
    showToast("Draft saved")
  }

  async function openMailto() {
    if (!draft.to.trim()) {
      showToast("Add a recipient")
      return
    }
    const params = new URLSearchParams()
    if (draft.subject.trim()) params.set("subject", draft.subject.trim())
    if (draft.body.trim()) params.set("body", draft.body)
    const suffix = params.toString() ? `?${params.toString()}` : ""
    await chrome.tabs.create({
      active: true,
      url: `mailto:${encodeURIComponent(draft.to.trim())}${suffix}`
    })
  }

  async function findPageEmails() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!activeTab?.id || !chrome.scripting?.executeScript) {
      showToast("No scannable tab")
      return
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: activeTab.id },
        func: () => {
          const mailtoEmails = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='mailto:']"))
            .map((anchor) => anchor.href.replace(/^mailto:/i, "").split("?")[0] || "")
          const textEmails = (document.body?.innerText || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
          return Array.from(new Set([...mailtoEmails, ...textEmails].map((email) => email.trim()).filter(Boolean))).slice(0, 10)
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          showToast("Could not scan page")
          return
        }
        const emails = results?.[0]?.result ?? []
        setPageEmails(emails)
        showToast(emails.length ? `Found ${emails.length} email${emails.length === 1 ? "" : "s"}` : "No emails found")
      }
    )
  }

  const tabs: { id: EmailTab; label: string; badge?: number }[] = [
    { id: "inbox", label: "Inbox", badge: codeCount || undefined },
    { id: "activity", label: "Activity" },
    { id: "compose", label: "Compose" }
  ]

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg-alt" data-testid="email-section">
      {toast && (
        <div className="absolute bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border border-chart-1/30 bg-chart-1/20 px-3 py-1 text-[11px] text-chart-1">
          {toast}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <LeoIcon name="inbox" size={15} className="text-fg/55" />
        <span className="flex-1 text-xs font-medium text-fg/80">Email</span>
        <button
          className="rounded border border-border bg-card/50 px-2 py-1 text-[10px] text-fg/55 hover:text-fg"
          onClick={() => chrome.tabs.create({ active: true, url: "https://mail.fly.pm" })}
          type="button">
          Open mail
        </button>
      </div>

      <div className="flex border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`flex-1 px-2 py-1.5 text-[11px] transition-colors ${
              tab === item.id
                ? "text-fg border-b-2 border-chart-1 -mb-[1px]"
                : "text-fg/40 hover:text-fg/70"
            }`}
            onClick={() => setTab(item.id)}
            type="button">
            {item.label}
            {item.badge ? (
              <span className="ml-1 rounded bg-chart-1/20 px-1 text-[9px] text-chart-1">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "inbox" && (
          <InboxPane
            error={inboxError}
            items={inbox}
            loading={loadingInbox}
            onCopyCode={(code) => void copyCode(code)}
            onFillCode={(code) => void fillCode(code)}
            onRefresh={() => void refreshInbox()}
          />
        )}
        {tab === "activity" && (
          <ActivityPane
            error={activityError}
            items={activity}
            loading={loadingActivity}
            onRefresh={() => void refreshActivity()}
          />
        )}
        {tab === "compose" && (
          <ComposePane
            draft={draft}
            onChange={setDraft}
            onFindPageEmails={() => void findPageEmails()}
            onOpenMailto={() => void openMailto()}
            onSave={() => void saveDraft()}
            pageEmails={pageEmails}
          />
        )}
      </div>
    </div>
  )
}

function InboxPane({
  error,
  items,
  loading,
  onCopyCode,
  onFillCode,
  onRefresh
}: {
  error: string
  items: MailInboxItem[]
  loading: boolean
  onCopyCode: (code: string) => void
  onFillCode: (code: string) => void
  onRefresh: () => void
}) {
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[10px] uppercase tracking-wider text-fg/30">
          Compact inbox + security codes
        </p>
        <button
          className="rounded border border-border bg-card/40 px-2 py-1 text-[10px] text-fg/55 hover:text-fg"
          onClick={onRefresh}
          type="button">
          Refresh
        </button>
      </div>
      <p className="rounded border border-chart-1/20 bg-chart-1/10 px-2 py-1.5 text-[11px] text-fg/55">
        Passive OTP autofill is active on pages with one-time-code fields. Use Fill for a manual push.
      </p>

      {loading ? <EmptyNote text="Loading inbox..." /> : null}
      {!loading && error ? <EmptyNote text={error} tone="warning" /> : null}
      {!loading && !error && items.length === 0 ? <EmptyNote text="No inbox items found." /> : null}

      {items.map((item) => (
        <div key={item.id} className="rounded border border-border bg-card/35 p-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg">{item.subject || "(no subject)"}</p>
              <p className="truncate text-[10px] text-fg/35">
                {item.participants || "Unknown sender"} · {formatTime(item.receivedAt)}
              </p>
            </div>
          </div>
          {item.snippet ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-fg/45">
              {item.snippet}
            </p>
          ) : null}
          {item.codes.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.codes.map((code) => (
                <div key={`${item.id}-${code}`} className="flex overflow-hidden rounded border border-success/25 bg-success/10">
                  <button
                    className="px-2 py-1 font-mono text-[11px] text-success hover:bg-success/10"
                    onClick={() => onCopyCode(code)}
                    type="button">
                    {code}
                  </button>
                  <button
                    className="border-l border-success/20 px-2 py-1 text-[10px] text-success/80 hover:bg-success/10"
                    onClick={() => onFillCode(code)}
                    type="button">
                    Fill
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ActivityPane({
  error,
  items,
  loading,
  onRefresh
}: {
  error: string
  items: MailActivityItem[]
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[10px] uppercase tracking-wider text-fg/30">
          Recent opens + clicks
        </p>
        <button
          className="rounded border border-border bg-card/40 px-2 py-1 text-[10px] text-fg/55 hover:text-fg"
          onClick={onRefresh}
          type="button">
          Refresh
        </button>
      </div>
      {loading ? <EmptyNote text="Loading activity..." /> : null}
      {!loading && error ? <EmptyNote text={error} tone="warning" /> : null}
      {!loading && !error && items.length === 0 ? <EmptyNote text="No recent email activity found." /> : null}
      {items.map((item) => (
        <div key={item.id} className="rounded border border-border bg-card/35 p-2">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${
              item.type === "open"
                ? "bg-chart-3/15 text-chart-3"
                : item.type === "click"
                ? "bg-chart-1/15 text-chart-1"
                : "bg-accent text-fg/45"
            }`}>
              {item.type}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-fg/70">
              {item.email || "Unknown recipient"}
            </span>
            <span className="text-[10px] text-fg/30">{formatTime(item.at)}</span>
          </div>
          {item.subject ? <p className="mt-1 truncate text-[11px] text-fg/45">{item.subject}</p> : null}
          {item.url ? <p className="mt-1 truncate font-mono text-[10px] text-fg/30">{item.url}</p> : null}
        </div>
      ))}
    </div>
  )
}

function ComposePane({
  draft,
  onChange,
  onFindPageEmails,
  onOpenMailto,
  onSave,
  pageEmails
}: {
  draft: ComposeDraft
  onChange: (draft: ComposeDraft) => void
  onFindPageEmails: () => void
  onOpenMailto: () => void
  onSave: () => void
  pageEmails: string[]
}) {
  const update = (patch: Partial<ComposeDraft>) => onChange({ ...draft, ...patch })

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[10px] uppercase tracking-wider text-fg/30">
          Quick compose
        </p>
        <button
          className="rounded border border-border bg-card/40 px-2 py-1 text-[10px] text-fg/55 hover:text-fg"
          onClick={onFindPageEmails}
          type="button">
          Find emails
        </button>
      </div>

      {pageEmails.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pageEmails.map((email) => (
            <button
              key={email}
              className="rounded-full border border-border bg-card/45 px-2 py-1 text-[10px] text-fg/55 hover:text-fg"
              onClick={() => update({ to: email })}
              type="button">
              {email}
            </button>
          ))}
        </div>
      ) : null}

      <input
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-fg/25 focus:border-chart-1/70"
        onChange={(event) => update({ to: event.target.value })}
        placeholder="to@example.com"
        type="email"
        value={draft.to}
      />
      <input
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-fg/25 focus:border-chart-1/70"
        onChange={(event) => update({ subject: event.target.value })}
        placeholder="Subject"
        type="text"
        value={draft.subject}
      />
      <textarea
        className="min-h-[180px] w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[11px] leading-relaxed text-fg outline-none placeholder:text-fg/25 focus:border-chart-1/70"
        onChange={(event) => update({ body: event.target.value })}
        placeholder="Quick note..."
        value={draft.body}
      />
      <div className="flex gap-2">
        <button
          className="flex-1 rounded border border-border bg-card/45 px-2 py-1.5 text-[11px] text-fg/65 hover:text-fg"
          onClick={onSave}
          type="button">
          Save draft
        </button>
        <button
          className="flex-1 rounded bg-chart-1 px-2 py-1.5 text-[11px] font-medium text-bg hover:bg-chart-1/90"
          onClick={onOpenMailto}
          type="button">
          Send via mailto
        </button>
      </div>
    </div>
  )
}

function EmptyNote({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warning" }) {
  return (
    <div className={`rounded border px-2 py-2 text-center text-[11px] ${
      tone === "warning"
        ? "border-warning/20 bg-warning/10 text-warning/80"
        : "border-border/70 bg-card/25 text-fg/35"
    }`}>
      {text}
    </div>
  )
}

function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response as T)
    })
  })
}

function sendTabMessage<T>(tabId: number, message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message } as T)
        return
      }
      resolve(response as T)
    })
  })
}

function formatTime(value?: number) {
  if (!value) return "recent"
  const diff = Date.now() - value
  if (diff < 60_000) return "now"
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h`
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
