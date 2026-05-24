import { Hono } from "hono"
import type { Env } from "../env"
import { AGENT_PLAN_MODEL, AI_GATEWAY_ID } from "../env"
import { ulid } from "../ulid"

type AgentRole = "user" | "assistant" | "tool" | "system" | "observation"
type AgentCloudUse = { planning: boolean; vision: boolean; ocr: boolean }

interface AgentSessionRow {
  id: string
  objective: string
  status: string
  next_step: string
  compact_summary: string
  token_estimate: number
  memory_refs: string
  last_observation: string | null
  pending_consent: string | null
  created_at: number
  updated_at: number
}

interface AgentMessageRow {
  id: string
  session_id: string
  role: AgentRole
  content_text: string
  observation: string | null
  token_estimate: number
  created_at: number
}

interface AgentPlanResult {
  status: string
  nextStep: string
  stopCondition: string
  reply: string
  provider: string
  model?: string
  gateway?: string
}

const agent = new Hono<{ Bindings: Env }>()
const COMPACT_AFTER_TOKENS = 3200
const MAX_OBSERVATION_CHARS = 48_000
const MAX_MESSAGE_CHARS = 16_000

agent.post("/sessions", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    sessionId?: string
    objective?: string
    observation?: unknown
    compactSummary?: string
  } | null
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const now = Date.now()
  const id = cleanId(body.sessionId) || ulid()
  const existing = await getSession(c.env, id)
  const objective = cleanText(body.objective ?? existing?.objective ?? "", 2000)
  const observation = body.observation === undefined ? (existing?.last_observation ?? null) : serializeObservation(body.observation)
  const compactSummary = cleanText(body.compactSummary ?? existing?.compact_summary ?? "", 6000)
  const nextStep = existing?.next_step || "Observe the page and plan the next browser action."
  const tokenEstimate = estimateTokens([objective, compactSummary, observation ?? ""])

  if (existing) {
    await updateSession(c.env, id, {
      objective,
      status: existing.status,
      next_step: nextStep,
      compact_summary: compactSummary,
      token_estimate: tokenEstimate,
      memory_refs: existing.memory_refs,
      last_observation: observation,
      pending_consent: existing.pending_consent,
      updated_at: now,
    })
  } else {
    await c.env.DB.prepare(
      `INSERT INTO browser_agent_sessions
        (id, objective, status, next_step, compact_summary, token_estimate, memory_refs,
         last_observation, pending_consent, created_at, updated_at)
       VALUES (?, ?, 'planning', ?, ?, ?, '[]', ?, NULL, ?, ?)`,
    )
      .bind(id, objective, nextStep, compactSummary, tokenEstimate, observation, now, now)
      .run()
  }

  return c.json({ session: presentSession((await getSession(c.env, id))!) }, existing ? 200 : 201)
})

agent.get("/sessions/:id", async (c) => {
  const session = await getSession(c.env, c.req.param("id"))
  if (!session) return c.json({ error: { code: "not_found", message: "no such agent session" } }, 404)
  const messages = await listMessages(c.env, session.id, 25)
  return c.json({
    session: presentSession(session),
    messages: messages.map(presentMessage),
  })
})

agent.post("/sessions/:id/messages", async (c) => {
  const session = await getSession(c.env, c.req.param("id"))
  if (!session) return c.json({ error: { code: "not_found", message: "no such agent session" } }, 404)
  const body = (await c.req.json().catch(() => null)) as {
    role?: AgentRole
    content?: string
    observation?: unknown
  } | null
  if (!body || !body.role || typeof body.content !== "string") {
    return c.json({ error: { code: "bad_request", message: "role and content required" } }, 400)
  }
  const msg = await appendMessage(c.env, session.id, body.role, body.content, body.observation)
  const next = await refreshSessionEstimate(c.env, session.id)
  return c.json(
    {
      message: presentMessage(msg),
      session: presentSession(next),
      compactRecommended: next.token_estimate >= COMPACT_AFTER_TOKENS,
    },
    201,
  )
})

agent.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    sessionId?: string
    message?: string
    objective?: string
    observation?: unknown
    cloudUse?: Partial<AgentCloudUse>
  } | null
  if (!body || typeof body.message !== "string") {
    return c.json({ error: { code: "bad_request", message: "message required" } }, 400)
  }
  const message = cleanText(body.message, MAX_MESSAGE_CHARS)
  if (!message) {
    return c.json({ error: { code: "bad_request", message: "message required" } }, 400)
  }

  const cloudUse = normalizeCloudUse(body.cloudUse)
  const cloudObservation = cloudUse.planning ? serializeObservation(body.observation) : null
  const id = cleanId(body.sessionId) || ulid()
  let session = await getSession(c.env, id)
  if (!session) {
    const now = Date.now()
    const objective = cleanText(body.objective || message, 2000)
    await c.env.DB.prepare(
      `INSERT INTO browser_agent_sessions
        (id, objective, status, next_step, compact_summary, token_estimate, memory_refs,
         last_observation, pending_consent, created_at, updated_at)
       VALUES (?, ?, 'planning', 'Observe the page and plan the next browser action.', '', ?, '[]', ?, NULL, ?, ?)`,
    )
      .bind(id, objective, estimateTokens([objective, cloudObservation ?? ""]), cloudObservation, now, now)
      .run()
    session = (await getSession(c.env, id))!
  }

  await appendMessage(c.env, id, "user", message, cloudUse.planning ? body.observation : undefined)
  const cloudPlan =
    cloudUse.planning && cloudObservation ? await buildCloudPlan(c.env, message, cloudObservation, session).catch(() => null) : null
  const plan = cloudPlan ?? buildDeterministicPlan(message, cloudObservation ?? "", session)
  await appendMessage(c.env, id, "assistant", plan.reply, undefined)
  await updateSession(c.env, id, {
    objective: cleanText(body.objective || session.objective || message, 2000),
    status: plan.status,
    next_step: plan.nextStep,
    compact_summary: session.compact_summary,
    token_estimate: estimateTokens([session.compact_summary, message, plan.reply, cloudObservation ?? ""]),
    memory_refs: session.memory_refs,
    last_observation: cloudObservation ?? session.last_observation,
    pending_consent: null,
    updated_at: Date.now(),
  })
  const updated = await maybeCompact(c.env, id)
  return c.json({
    session: presentSession(updated),
    reply: plan.reply,
    plan: {
      objective: updated.objective,
      status: updated.status,
      nextStep: updated.next_step,
      stopCondition: plan.stopCondition,
    },
    provider: plan.provider,
    cloudUse,
    model: plan.model,
    gateway: plan.gateway,
    compacted: updated.compact_summary !== session.compact_summary,
  })
})

agent.post("/sessions/:id/compact", async (c) => {
  const session = await getSession(c.env, c.req.param("id"))
  if (!session) return c.json({ error: { code: "not_found", message: "no such agent session" } }, 404)
  const compacted = await compactSession(c.env, session)
  return c.json({ session: presentSession(compacted), compacted: true })
})

agent.post("/sessions/:id/memory", async (c) => {
  const session = await getSession(c.env, c.req.param("id"))
  if (!session) return c.json({ error: { code: "not_found", message: "no such agent session" } }, 404)
  const body = (await c.req.json().catch(() => null)) as {
    key?: string
    value?: string
  } | null
  if (!body || !body.key || !body.value) {
    return c.json({ error: { code: "bad_request", message: "key and value required" } }, 400)
  }
  const id = ulid()
  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO browser_agent_memories (id, session_id, key, value, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, session.id, cleanText(body.key, 200), cleanText(body.value, 8000), now)
    .run()
  return c.json(
    {
      memory: {
        id,
        key: body.key,
        value: body.value,
        createdAt: new Date(now).toISOString(),
      },
    },
    201,
  )
})

agent.get("/sessions/:id/memory/search", async (c) => {
  const session = await getSession(c.env, c.req.param("id"))
  if (!session) return c.json({ error: { code: "not_found", message: "no such agent session" } }, 404)
  const q = cleanText(c.req.query("q") || "", 200)
  if (!q) return c.json({ results: [] })
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  const { results } = await c.env.DB.prepare(
    `SELECT id, key, value, created_at
       FROM browser_agent_memories
      WHERE session_id = ? AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC
      LIMIT 20`,
  )
    .bind(session.id, like, like)
    .all<{ id: string; key: string; value: string; created_at: number }>()
  return c.json({
    results: (results ?? []).map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  })
})

async function getSession(env: Env, id: string): Promise<AgentSessionRow | null> {
  return (await env.DB.prepare("SELECT * FROM browser_agent_sessions WHERE id = ?").bind(id).first<AgentSessionRow>()) ?? null
}

async function updateSession(env: Env, id: string, patch: Omit<AgentSessionRow, "id" | "created_at">): Promise<void> {
  await env.DB.prepare(
    `UPDATE browser_agent_sessions SET
       objective = ?, status = ?, next_step = ?, compact_summary = ?, token_estimate = ?,
       memory_refs = ?, last_observation = ?, pending_consent = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      patch.objective,
      patch.status,
      patch.next_step,
      patch.compact_summary,
      patch.token_estimate,
      patch.memory_refs,
      patch.last_observation,
      patch.pending_consent,
      patch.updated_at,
      id,
    )
    .run()
}

async function appendMessage(
  env: Env,
  sessionId: string,
  role: AgentRole,
  content: string,
  observation: unknown,
): Promise<AgentMessageRow> {
  const text = cleanText(content, MAX_MESSAGE_CHARS)
  const obs = observation === undefined ? null : serializeObservation(observation)
  const row: AgentMessageRow = {
    id: ulid(),
    session_id: sessionId,
    role,
    content_text: text,
    observation: obs,
    token_estimate: estimateTokens([text, obs ?? ""]),
    created_at: Date.now(),
  }
  await env.DB.prepare(
    `INSERT INTO browser_agent_messages
       (id, session_id, role, content_text, observation, token_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.session_id, row.role, row.content_text, row.observation, row.token_estimate, row.created_at)
    .run()
  return row
}

async function listMessages(env: Env, sessionId: string, limit: number): Promise<AgentMessageRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM browser_agent_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(sessionId, Math.min(limit, 100))
    .all<AgentMessageRow>()
  return (results ?? []).reverse()
}

async function refreshSessionEstimate(env: Env, sessionId: string): Promise<AgentSessionRow> {
  const session = (await getSession(env, sessionId))!
  const messages = await listMessages(env, sessionId, 20)
  const estimate = estimateTokens([
    session.objective,
    session.compact_summary,
    session.last_observation ?? "",
    ...messages.map((m) => m.content_text),
  ])
  await updateSession(env, sessionId, {
    ...session,
    token_estimate: estimate,
    updated_at: Date.now(),
  })
  return (await getSession(env, sessionId))!
}

async function maybeCompact(env: Env, sessionId: string): Promise<AgentSessionRow> {
  const session = await refreshSessionEstimate(env, sessionId)
  if (session.token_estimate < COMPACT_AFTER_TOKENS) return session
  return compactSession(env, session)
}

async function compactSession(env: Env, session: AgentSessionRow): Promise<AgentSessionRow> {
  const messages = await listMessages(env, session.id, 12)
  const summary = [
    `Objective: ${session.objective || "Unspecified"}`,
    `Status: ${session.status}`,
    `Next: ${session.next_step}`,
    session.compact_summary ? `Prior summary: ${session.compact_summary}` : "",
    "Recent:",
    ...messages.slice(-6).map((m) => `- ${m.role}: ${cleanText(m.content_text, 500)}`),
  ]
    .filter(Boolean)
    .join("\n")
  const compactSummary = cleanText(summary, 5000)
  await updateSession(env, session.id, {
    ...session,
    compact_summary: compactSummary,
    token_estimate: estimateTokens([session.objective, session.next_step, compactSummary, session.last_observation ?? ""]),
    updated_at: Date.now(),
  })
  return (await getSession(env, session.id))!
}

function normalizeCloudUse(value: Partial<AgentCloudUse> | undefined): AgentCloudUse {
  return {
    planning: value?.planning === true,
    vision: value?.vision === true,
    ocr: value?.ocr === true,
  }
}

async function buildCloudPlan(env: Env, message: string, observationJson: string, session: AgentSessionRow): Promise<AgentPlanResult> {
  const prompt = [
    "Return strict JSON only with keys status, nextStep, stopCondition, reply.",
    "You are planning one safe browser-agent step. You do not execute actions.",
    "Use the capped observation as authorized page context.",
    `Objective: ${session.objective || message}`,
    `User message: ${cleanText(message, 2000)}`,
    `Observation JSON: ${cleanText(observationJson, 12000)}`,
  ].join("\n")

  const res = (await env.AI.run(
    AGENT_PLAN_MODEL,
    {
      messages: [
        {
          role: "system",
          content: "You are a privacy-scoped browser planner. Respond with compact strict JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 700,
    },
    { gateway: { id: AI_GATEWAY_ID } },
  )) as {
    response?: string
    result?: string
    choices?: Array<{ message?: { content?: string } }>
  }

  const raw = extractAiText(res)
  const parsed = parseJson(extractJson(raw)) as {
    status?: string
    nextStep?: string
    stopCondition?: string
    reply?: string
  } | null
  const deterministic = buildDeterministicPlan(message, observationJson, session)
  const hasUsableCloudPlan = Boolean(parsed && (parsed.status || parsed.nextStep || parsed.stopCondition || parsed.reply))
  if (!hasUsableCloudPlan) {
    return deterministic
  }
  const status = cleanText(parsed!.status || deterministic.status, 80) || "planning"
  const nextStep = cleanText(parsed!.nextStep || deterministic.nextStep, 500)
  const stopCondition = cleanText(parsed!.stopCondition || deterministic.stopCondition, 500)
  const reply = preserveText(parsed!.reply || raw || deterministic.reply, 2000)

  return {
    status,
    nextStep,
    stopCondition,
    reply,
    provider: "cloudflare-ai-gateway",
    model: AGENT_PLAN_MODEL,
    gateway: AI_GATEWAY_ID,
  }
}

function extractAiText(
  res:
    | {
        response?: string
        result?: string
        choices?: Array<{ message?: { content?: string } }>
      }
    | undefined,
): string {
  if (!res) return ""
  if (typeof res.response === "string") return res.response
  if (typeof res.result === "string") return res.result
  const choice = res.choices?.[0]?.message?.content
  return typeof choice === "string" ? choice : ""
}

function extractJson(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/)
  return match ? match[0] : raw
}

function buildDeterministicPlan(message: string, observationJson: string, session: AgentSessionRow): AgentPlanResult {
  const obs = parseJson(observationJson) as {
    title?: string
    nodes?: unknown[]
    limits?: { nodesTruncated?: boolean }
  } | null
  const nodeCount = Array.isArray(obs?.nodes) ? obs.nodes.length : 0
  const objective = session.objective || message
  const nextStep =
    nodeCount > 0
      ? "Use the observed element refs/selectors to choose the smallest safe browser action, then observe again."
      : "Ask for or collect more page context before taking a browser action."
  const reply = [
    `Objective: ${objective}`,
    `Status: observed ${nodeCount} visible page node${nodeCount === 1 ? "" : "s"}${obs?.title ? ` on "${obs.title}"` : ""}.`,
    "Plan: identify the target element, perform one consent-gated action, then re-observe before continuing.",
    `Next step: ${nextStep}`,
  ].join("\n")
  return {
    status: "planning",
    nextStep,
    stopCondition: "Stop when the requested page state is reached or a required user consent/input is missing.",
    reply,
    provider: "worker-deterministic",
  }
}

function presentSession(row: AgentSessionRow) {
  return {
    id: row.id,
    objective: row.objective,
    status: row.status,
    nextStep: row.next_step,
    compactSummary: row.compact_summary,
    tokenEstimate: row.token_estimate,
    memoryRefs: parseJson(row.memory_refs) ?? [],
    lastObservation: parseJson(row.last_observation),
    pendingConsent: parseJson(row.pending_consent),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function presentMessage(row: AgentMessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content_text,
    observation: parseJson(row.observation),
    tokenEstimate: row.token_estimate,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,80}$/.test(value) ? value : null
}

function cleanText(value: unknown, max: number): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text
}

function preserveText(value: unknown, max: number): string {
  const text = String(value ?? "").trim()
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text
}

function serializeObservation(value: unknown): string {
  return cleanText(JSON.stringify(value ?? null), MAX_OBSERVATION_CHARS)
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function estimateTokens(parts: string[]): number {
  const chars = parts.join("\n").length
  const words = parts.join(" ").trim().split(/\s+/).filter(Boolean).length
  return Math.ceil(Math.max(chars / 4, words * 1.3) + parts.length * 4)
}

export default agent
