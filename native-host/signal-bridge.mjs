import { homedir } from "os"
import { join } from "path"

const DEFAULT_DEVICE_NAME = "Brave Dev Sidebar"
const SIGNAL_TYPES = new Set([
  "signal.status",
  "signal.link.start",
  "signal.link.finish",
  "signal.conversations.list",
  "signal.messages.list",
  "signal.message.send",
  "signal.attachments.get",
  "signal.lock",
  "signal.unlink"
])

export const SIGNAL_CONTAINER_SECURITY = Object.freeze({
  network: "none",
  capDrop: ["ALL"],
  readOnlyRootFilesystem: true,
  tmpfs: ["/tmp", "/run"],
  encryptedProfileVolume: true,
  localOnlySocket: true,
  noNewPrivileges: true,
  user: "non-root",
  inboundPorts: "none",
  profilePath: join(homedir(), ".ai-dev-sidebar", "signal", "profiles", "default")
})

const SENSITIVE_KEY_RE = /^(accessToken|base64|identityKey|masterKey|pinCode|privateKey|profileKey|secret|token|password)$/i

function now() {
  return Date.now()
}

function makeId(prefix) {
  return `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanString(value, fallback = "") {
  if (typeof value !== "string") return fallback
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
}

function boundedPreview(value) {
  const text = cleanString(value)
  return text.length > 96 ? `${text.slice(0, 93)}...` : text
}

function redactedClone(value) {
  if (Array.isArray(value)) return value.map(redactedClone)
  if (!value || typeof value !== "object") return value
  const out = {}
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) continue
    out[key] = redactedClone(nested)
  }
  return out
}

export function redactSignalPayload(value) {
  return redactedClone(value)
}

function dataMessageFrom(raw) {
  if (raw?.dataMessage && typeof raw.dataMessage === "object") return raw.dataMessage
  const envelope = raw?.envelope && typeof raw.envelope === "object" ? raw.envelope : null
  if (envelope?.dataMessage && typeof envelope.dataMessage === "object") return envelope.dataMessage
  return {}
}

function senderFrom(raw, fallbackName = "Signal") {
  return {
    name:
      cleanString(raw?.sourceName) ||
      cleanString(raw?.senderName) ||
      cleanString(raw?.sender?.name) ||
      fallbackName,
    phoneNumber:
      cleanString(raw?.sourceNumber) ||
      cleanString(raw?.senderNumber) ||
      cleanString(raw?.sender?.phoneNumber)
  }
}

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return []
  return rawAttachments.map((attachment) => ({
    id: cleanString(attachment?.id, makeId("attachment")),
    fileName:
      cleanString(attachment?.fileName) ||
      cleanString(attachment?.name, "attachment"),
    contentType: cleanString(attachment?.contentType, "application/octet-stream"),
    size: Number(attachment?.size || 0),
    status: "metadata-only"
  }))
}

export function normalizeSignalMessage(raw, fallback = {}) {
  const safeFallback = fallback && typeof fallback === "object" ? fallback : {}
  const safe = redactedClone(raw || {})
  const dataMessage = dataMessageFrom(safe)
  const body =
    cleanString(safe.body) ||
    cleanString(safe.message) ||
    cleanString(dataMessage.message) ||
    cleanString(safeFallback.body)
  const conversationId =
    cleanString(safe.conversationId) ||
    cleanString(safe.groupId) ||
    cleanString(dataMessage.groupInfo?.groupId) ||
    cleanString(safeFallback.conversationId, "signal:unknown")
  const direction =
    safe.direction === "outgoing" || safeFallback.direction === "outgoing"
      ? "outgoing"
      : "incoming"
  const attachments = normalizeAttachments(safe.attachments || dataMessage.attachments)

  return {
    id:
      cleanString(safe.id) ||
      cleanString(safe.envelopeId) ||
      cleanString(safeFallback.id, makeId("sigmsg")),
    conversationId,
    direction,
    sender:
      direction === "outgoing"
        ? { name: "You", phoneNumber: "" }
        : senderFrom(safe, cleanString(safeFallback.sender, "Signal")),
    author:
      direction === "outgoing"
        ? "You"
        : senderFrom(safe, cleanString(safeFallback.sender, "Signal")).name,
    body,
    timestamp: safe.timestamp || safe.receivedAt || now(),
    receivedAt: Number(safe.receivedAt || safe.timestamp || now()),
    status: safe.status === "failed" ? "failed" : safe.status === "queued" ? "queued" : "sent",
    attachments
  }
}

function normalizeConversation(raw, messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : []
  const safe = redactedClone(raw || {})
  const last = safe.lastMessage || safeMessages[safeMessages.length - 1] || {}
  const lastMessage = normalizeSignalMessage(last, {
    conversationId: safe.conversationId || safe.id,
    sender: safe.title || "Signal"
  })
  return {
    id:
      cleanString(safe.conversationId) ||
      cleanString(safe.id) ||
      lastMessage.conversationId,
      title:
      cleanString(safe.title) ||
      cleanString(safe.name) ||
      cleanString(lastMessage.sender?.name, "Signal"),
    lastMessagePreview: boundedPreview(lastMessage.body || safe.lastMessagePreview),
    lastTimestamp: Number(safe.updatedAt || lastMessage.receivedAt || now()),
    updatedAt: Number(safe.updatedAt || lastMessage.receivedAt || now()),
    unreadCount: Number(safe.unreadCount || 0),
    isGroup: Boolean(safe.isGroup),
    participants: Array.isArray(safe.participants)
      ? safe.participants.map((participant) => ({
          name: cleanString(participant?.name),
          phoneNumber: cleanString(participant?.number || participant?.phoneNumber)
        }))
      : []
  }
}

function securityForStatus(homeDir) {
  return {
    ...SIGNAL_CONTAINER_SECURITY,
    profilePath: join(homeDir, ".ai-dev-sidebar", "signal", "profiles", "default")
  }
}

export class FakeSignalJsonRpcAdapter {
  constructor(options = {}) {
    this.conversations = options.conversations || []
    this.messages = options.messages || {}
  }

  async listConversations() {
    return this.conversations
  }

  async listMessages(conversationId) {
    return this.messages[conversationId] || []
  }

  async sendMessage(conversationId, body) {
    const message = {
      id: makeId("sent"),
      conversationId,
      direction: "outgoing",
      body,
      timestamp: now()
    }
    this.messages[conversationId] = [...(this.messages[conversationId] || []), message]
    return message
  }

  async getAttachment(attachmentId) {
    return {
      id: cleanString(attachmentId, "attachment"),
      available: false,
      reason: "Attachments are metadata only until the hardened container adapter is enabled."
    }
  }
}

export class SignalBridgeManager {
  constructor(options = {}) {
    this.adapter = options.adapter || new FakeSignalJsonRpcAdapter()
    this.eventSink = options.eventSink || null
    this.homeDir = options.homeDir || homedir()
    this.profileLabel = options.profileLabel || DEFAULT_DEVICE_NAME
    this.runtime = options.runtime || { kind: "fake", container: "not-started" }
    this.state = options.initialState || "unlinked"
    this.locked = false
    this.account = null
    this.pendingLink = null
    this.seedFakeConversation = options.seedFakeConversation !== false && !options.adapter
    this.localConversations = new Map()
    this.localMessages = new Map()
  }

  canHandle(type) {
    return typeof type === "string" && SIGNAL_TYPES.has(type)
  }

  async handleMessage(msg) {
    try {
      switch (msg.type) {
        case "signal.status":
          return this.withRequest(msg, this.statusResponse())
        case "signal.link.start":
          return this.withRequest(msg, this.startLink(msg.deviceName))
        case "signal.link.finish":
          return this.withRequest(msg, this.finishLink(msg.deviceName))
        case "signal.conversations.list":
          return this.withRequest(msg, await this.listConversations())
        case "signal.messages.list":
          return this.withRequest(msg, await this.listMessages(msg.conversationId))
        case "signal.message.send":
          return this.withRequest(msg, await this.sendMessage(msg.conversationId, msg.body))
        case "signal.attachments.get":
          return this.withRequest(msg, await this.getAttachment(msg.attachmentId))
        case "signal.lock":
          return this.withRequest(msg, this.lock())
        case "signal.unlink":
          return this.withRequest(msg, this.unlink())
        default:
          return this.error(msg, "unsupported", `Unsupported Signal request: ${msg.type}`)
      }
    } catch (err) {
      return this.error(msg, "error", err instanceof Error ? err.message : String(err))
    }
  }

  async handle(msg) {
    return this.handleMessage(msg)
  }

  withRequest(msg, payload) {
    return { ...payload, requestId: msg.requestId }
  }

  error(msg, code, error) {
    return { type: "signal.error", requestId: msg?.requestId, ok: false, code, error }
  }

  statusObject() {
    return {
      state: this.state,
      profileLabel: this.profileLabel,
      locked: this.locked,
      runtime: this.runtime,
      account: this.account,
      deviceName: this.account?.deviceName || this.pendingLink?.deviceName || this.profileLabel,
      storagePolicy: {
        chromeStorage: "ui-settings-only",
        cloudSync: false,
        decryptedMessages: "native-host-memory-only"
      },
      security: securityForStatus(this.homeDir),
      updatedAt: now()
    }
  }

  statusResponse() {
    const status = this.statusObject()
    return {
      type: "signal.status",
      ok: true,
      status,
      state: status.state,
      profileLabel: this.profileLabel,
      runtime: "auto",
      linkedDeviceName: status.account?.deviceName,
      updatedAt: status.updatedAt,
      container: {
        network: "none",
        inboundPorts: "none",
        rootFilesystem: "read-only",
        user: "non-root",
        capabilities: "drop-all",
        profileStorage: "encrypted-local-volume",
        socket: "unix"
      }
    }
  }

  startLink(deviceName) {
    const name = cleanString(deviceName, this.profileLabel) || this.profileLabel
    const uri = `sgnl://linkdevice?uuid=${encodeURIComponent(makeId("link"))}&pub_key=fake-local-bridge`
    const expiresAt = new Date(now() + 5 * 60_000).toISOString()
    this.pendingLink = {
      uri,
      linkUri: uri,
      deviceName: name,
      expiresAt
    }
    this.state = "linking"
    this.locked = false
    return {
      type: "signal.link.start",
      ok: true,
      status: this.statusObject(),
      state: "linking",
      link: this.pendingLink,
      linkUri: uri,
      expiresAt: this.pendingLink.expiresAt
    }
  }

  finishLink(deviceName) {
    if (!this.pendingLink) {
      return {
        type: "signal.error",
        ok: false,
        code: "link-not-started",
        error: "Start linking before finishing Signal device setup."
      }
    }
    const name =
      cleanString(deviceName) ||
      cleanString(this.pendingLink.deviceName) ||
      this.profileLabel
    this.account = {
      deviceName: name,
      linkedAt: now()
    }
    this.pendingLink = null
    this.state = "linked"
    this.locked = false
    if (this.seedFakeConversation && this.localConversations.size === 0) {
      this.ensureLocalConversation("signal:self-test", "Signal bridge self-test", "Bridge linked locally.")
    }
    return { ...this.statusResponse(), type: "signal.link.finish" }
  }

  async listConversations() {
    const guard = this.requireLinked()
    if (guard) return guard
    const adapterRows = await this.adapter.listConversations()
    const adapterConversations = Array.isArray(adapterRows) ? adapterRows : []
    const rows = adapterConversations.length > 0
      ? adapterConversations.map((row) => normalizeConversation(row))
      : Array.from(this.localConversations.values())
    return { type: "signal.conversations.list", ok: true, conversations: rows }
  }

  async listMessages(conversationId) {
    const guard = this.requireLinked()
    if (guard) return guard
    const id = cleanString(conversationId)
    if (!id) return { type: "signal.error", ok: false, code: "invalid-request", error: "conversationId is required." }
    const adapterRows = await this.adapter.listMessages(id)
    const adapterMessages = Array.isArray(adapterRows) ? adapterRows : []
    const rows = adapterMessages.length > 0
      ? adapterMessages.map((row) => normalizeSignalMessage(row, { conversationId: id }))
      : (this.localMessages.get(id) || [])
    return { type: "signal.messages.list", ok: true, conversationId: id, messages: rows }
  }

  async sendMessage(conversationId, body) {
    const guard = this.requireLinked()
    if (guard) return guard
    const id = cleanString(conversationId)
    const text = cleanString(body)
    if (!id) return { type: "signal.error", ok: false, code: "invalid-request", error: "conversationId is required." }
    if (!text) return { type: "signal.error", ok: false, code: "invalid-request", error: "message body is required." }
    const raw = await this.adapter.sendMessage(id, text)
    const message = normalizeSignalMessage(raw, {
      conversationId: id,
      direction: "outgoing",
      body: text
    })
    this.appendLocalMessage(message)
    return { type: "signal.message.send", ok: true, conversationId: id, message }
  }

  async getAttachment(attachmentId) {
    const guard = this.requireLinked()
    if (guard) return guard
    const attachment = await this.adapter.getAttachment(attachmentId)
    return {
      type: "signal.attachments.get",
      ok: true,
      attachment: redactedClone(attachment)
    }
  }

  lock() {
    this.state = "locked"
    this.locked = true
    this.pendingLink = null
    return { ...this.statusResponse(), type: "signal.lock" }
  }

  unlink() {
    this.state = "unlinked"
    this.locked = false
    this.account = null
    this.pendingLink = null
    this.localConversations.clear()
    this.localMessages.clear()
    return { ...this.statusResponse(), type: "signal.unlink" }
  }

  handleAdapterEnvelope(envelope) {
    const message = normalizeSignalMessage(envelope)
    const event = { type: "signal.message.received", ok: true, message }
    this.appendLocalMessage(message)
    if (this.eventSink) this.eventSink(event)
    return event
  }

  requireLinked() {
    if (this.state === "linked" && !this.locked) return null
    const code = this.locked || this.state === "locked" ? "locked" : "not-linked"
    return {
      type: "signal.error",
      ok: false,
      code,
      error:
        code === "locked"
          ? "Signal bridge is locked."
          : "Signal bridge is not linked. Link a local Signal device first."
    }
  }

  appendLocalMessage(message) {
    const existing = this.localMessages.get(message.conversationId) || []
    this.localMessages.set(message.conversationId, [...existing, message])
    const current =
      this.localConversations.get(message.conversationId) ||
      this.ensureLocalConversation(
        message.conversationId,
        message.sender?.name || message.conversationId,
        boundedPreview(message.body)
      )
    this.localConversations.set(message.conversationId, {
      ...current,
      lastMessagePreview: boundedPreview(message.body),
      updatedAt: message.receivedAt,
      unreadCount: current.unreadCount + (message.direction === "incoming" ? 1 : 0)
    })
  }

  ensureLocalConversation(id, title, lastMessagePreview) {
    const conversation = {
      id,
      title,
      lastMessagePreview,
      updatedAt: now(),
      unreadCount: 0,
      isGroup: false,
      participants: []
    }
    this.localConversations.set(id, conversation)
    if (!this.localMessages.has(id)) this.localMessages.set(id, [])
    return conversation
  }
}
