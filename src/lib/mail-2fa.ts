export const MAIL_TWO_FACTOR_API_BASE = "https://mail.fly.pm"
export const MAIL_TWO_FACTOR_MAX_AGE_MS = 10 * 60 * 1000

export interface MailThreadSummary {
  id: string
  subject?: string | null
  participants?: string | string[] | null
  snippet?: string | null
  lastMessageAt?: string | number | null
}

export interface MailThreadMessage {
  id?: string
  subject?: string | null
  fromAddr?: string | null
  fromName?: string | null
  textBody?: string | null
  sentAt?: string | number | null
}

export interface MailThreadDetail {
  thread?: {
    id?: string
    subject?: string | null
    participants?: string | string[] | null
  } | null
  messages?: MailThreadMessage[] | null
}

export interface MailTwoFactorCandidate {
  code: string
  threadId: string
  messageId?: string
  subject: string
  receivedAt: number
  score: number
}

const CODE_CONTEXT_RE =
  /\b(?:2fa|mfa|otp|one[-\s]?time|two[-\s]?factor|verification|verify|security|login|sign[-\s]?in|authentication|auth|passcode|code)\b/i
const CODE_TOKEN_RE = /(?<!\d)(?:\d[\s-]?){4,8}(?!\d)/g
const HOST_TOKEN_STOPWORDS = new Set([
  "app",
  "auth",
  "com",
  "co",
  "dev",
  "io",
  "login",
  "net",
  "org",
  "secure",
  "www"
])

export function buildMailTwoFactorListUrl(baseUrl = MAIL_TWO_FACTOR_API_BASE) {
  const url = new URL("/api/v1/threads", baseUrl)
  url.searchParams.set("folder", "inbox")
  url.searchParams.set("limit", "10")
  return url.toString()
}

export function buildMailTwoFactorThreadUrl(
  threadId: string,
  baseUrl = MAIL_TWO_FACTOR_API_BASE
) {
  return new URL(`/api/v1/threads/${encodeURIComponent(threadId)}`, baseUrl).toString()
}

export function findBestMailTwoFactorCode(input: {
  details: MailThreadDetail[]
  pageUrl: string
  summaries?: MailThreadSummary[]
  now?: number
}): MailTwoFactorCandidate | null {
  const now = input.now ?? Date.now()
  const terms = targetTermsForUrl(input.pageUrl)
  const summaryById = new Map((input.summaries ?? []).map((summary) => [summary.id, summary]))
  const candidates = input.details.flatMap((detail) =>
    extractCandidatesFromThread(detail, summaryById, terms, now)
  )
  if (!candidates.length) return null

  const recent = candidates.filter(
    (candidate) => now - candidate.receivedAt <= MAIL_TWO_FACTOR_MAX_AGE_MS
  )
  const eligible = recent.length ? recent : candidates
  const withTargetMatch = eligible.filter((candidate) => candidate.score >= 70)

  if (withTargetMatch.length) {
    return withTargetMatch.sort(compareCandidates)[0] ?? null
  }

  const newestRecent = recent.sort(compareCandidates)
  if (newestRecent.length === 1) return newestRecent[0] ?? null
  return null
}

export function extractMailTwoFactorCodesFromText(text: string): string[] {
  const codes: string[] = []
  for (const match of text.matchAll(CODE_TOKEN_RE)) {
    const token = match[0]
    const code = token.replace(/\D/g, "")
    if (code.length < 4 || code.length > 8) continue
    const start = Math.max(0, match.index - 90)
    const end = Math.min(text.length, (match.index ?? 0) + token.length + 90)
    const context = text.slice(start, end)
    if (!CODE_CONTEXT_RE.test(context)) continue
    if (!codes.includes(code)) codes.push(code)
  }
  return codes
}

function extractCandidatesFromThread(
  detail: MailThreadDetail,
  summaryById: Map<string, MailThreadSummary>,
  targetTerms: string[],
  now: number
): MailTwoFactorCandidate[] {
  const threadId = detail.thread?.id ?? detail.messages?.[0]?.id ?? ""
  if (!threadId) return []
  const summary = summaryById.get(threadId)
  const subject = stringValue(detail.thread?.subject) || stringValue(summary?.subject)
  const participants = stringifyParticipants(detail.thread?.participants ?? summary?.participants)
  const messages = Array.isArray(detail.messages) ? detail.messages : []
  const candidates: MailTwoFactorCandidate[] = []

  for (const message of messages) {
    const receivedAt =
      timestampMs(message.sentAt) || timestampMs(summary?.lastMessageAt) || now
    const haystack = [
      subject,
      participants,
      message.fromName,
      message.fromAddr,
      message.subject,
      message.textBody
    ]
      .filter(Boolean)
      .join("\n")
    const codes = extractMailTwoFactorCodesFromText(haystack)
    for (const code of codes) {
      candidates.push({
        code,
        threadId,
        messageId: message.id,
        subject,
        receivedAt,
        score: scoreCandidate(haystack, targetTerms, receivedAt, now)
      })
    }
  }

  return candidates
}

function scoreCandidate(
  text: string,
  targetTerms: string[],
  receivedAt: number,
  now: number
) {
  const lower = text.toLowerCase()
  let score = CODE_CONTEXT_RE.test(lower) ? 35 : 0
  for (const term of targetTerms) {
    if (term.length >= 3 && lower.includes(term)) score += 35
  }
  const ageMs = Math.max(0, now - receivedAt)
  if (ageMs <= 2 * 60 * 1000) score += 25
  else if (ageMs <= MAIL_TWO_FACTOR_MAX_AGE_MS) score += 15
  return score
}

function compareCandidates(a: MailTwoFactorCandidate, b: MailTwoFactorCandidate) {
  return b.score - a.score || b.receivedAt - a.receivedAt
}

function targetTermsForUrl(pageUrl: string): string[] {
  try {
    const url = new URL(pageUrl)
    const hostParts = url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".")
      .filter((part) => part && !HOST_TOKEN_STOPWORDS.has(part))
    const labels = hostParts.flatMap((part) =>
      part.split(/[-_]/).filter((token) => token.length >= 3)
    )
    return [...new Set([...hostParts, ...labels])]
  } catch {
    return []
  }
}

function stringifyParticipants(value: string | string[] | null | undefined) {
  return Array.isArray(value) ? value.join(" ") : stringValue(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function timestampMs(value: string | number | null | undefined) {
  if (typeof value === "number") return value
  if (typeof value !== "string") return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
