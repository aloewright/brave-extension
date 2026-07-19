import { homedir } from "os"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from "fs"
import { delimiter, join } from "path"
import { execFile, spawn, spawnSync } from "child_process"
import { createConnection } from "net"

const DEFAULT_DEVICE_NAME = "Brave Dev Sidebar"
const SIGNAL_LAUNCH_AGENT_LABEL = "com.aidev.sidebar.signal"
const SIGNAL_DAEMON_PORT = 17583
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

function localServiceSecurityForStatus(homeDir) {
  return {
    network: "signal-service",
    localTransport: "tcp-loopback",
    profilePermissions: "owner-only",
    cloudSync: false,
    profilePath: join(homeDir, ".ai-dev-sidebar", "signal", "profiles", "default")
  }
}

function prepareSignalCliForGatekeeper(command) {
  if (process.platform !== "darwin") return command
  const candidates = command.includes("/")
    ? [command]
    : (process.env.PATH || "").split(delimiter).map((dir) => join(dir, command))
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (!executable) return command
  const resolved = realpathSync(executable)
  const toolsDir = join(homedir(), ".ai-dev-sidebar", "tools")
  const prepared = join(toolsDir, "signal-cli")
  const sourceStat = statSync(resolved)
  const preparedIsCurrent = existsSync(prepared) &&
    statSync(prepared).size === sourceStat.size &&
    statSync(prepared).mtimeMs >= sourceStat.mtimeMs
  if (!preparedIsCurrent) {
    mkdirSync(toolsDir, { recursive: true, mode: 0o700 })
    const temporary = `${prepared}.${process.pid}.tmp`
    copyFileSync(resolved, temporary)
    chmodSync(temporary, 0o755)
    renameSync(temporary, prepared)
  }
  for (const attribute of ["com.apple.quarantine", "com.apple.provenance", "com.apple.macl"]) {
    spawnSync("/usr/bin/xattr", ["-d", attribute, prepared], { stdio: "ignore" })
  }
  return prepared
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function installSignalLaunchAgent(command, dataDir) {
  const home = homedir()
  const signalDir = join(home, ".ai-dev-sidebar", "signal")
  const agentDir = join(home, "Library", "LaunchAgents")
  const plistPath = join(agentDir, `${SIGNAL_LAUNCH_AGENT_LABEL}.plist`)
  mkdirSync(signalDir, { recursive: true, mode: 0o700 })
  mkdirSync(agentDir, { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${SIGNAL_LAUNCH_AGENT_LABEL}</string>
<key>ProgramArguments</key><array>
<string>${xmlEscape(command)}</string><string>--config</string><string>${xmlEscape(dataDir)}</string>
<string>daemon</string><string>--tcp</string><string>127.0.0.1:${SIGNAL_DAEMON_PORT}</string>
<string>--receive-mode</string><string>manual</string>
</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xmlEscape(join(signalDir, "daemon.out.log"))}</string>
<key>StandardErrorPath</key><string>${xmlEscape(join(signalDir, "daemon.err.log"))}</string>
</dict></plist>
`
  const changed = !existsSync(plistPath) || readFileSync(plistPath, "utf8") !== plist
  if (changed) writeFileSync(plistPath, plist, { mode: 0o600 })
  const domain = `gui/${process.getuid()}`
  const loaded = spawnSync("/bin/launchctl", ["print", `${domain}/${SIGNAL_LAUNCH_AGENT_LABEL}`], {
    stdio: "ignore"
  }).status === 0
  if (loaded && changed) {
    spawnSync("/bin/launchctl", ["bootout", `${domain}/${SIGNAL_LAUNCH_AGENT_LABEL}`], { stdio: "ignore" })
  }
  if (!loaded || changed) {
    const result = spawnSync("/bin/launchctl", ["bootstrap", domain, plistPath], {
      encoding: "utf8"
    })
    if (result.status !== 0) {
      throw new Error((result.stderr || "Could not start the local Signal service.").trim())
    }
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

export class SignalCliJsonRpcAdapter extends FakeSignalJsonRpcAdapter {
  constructor(options = {}) {
    super(options)
    this.command = options.command || "signal-cli"
    this.dataDir = options.dataDir || join(homedir(), ".ai-dev-sidebar", "signal", "profiles", "default")
    this.spawnImpl = options.spawnImpl || spawn
    this.execFileImpl = options.execFileImpl || execFile
    this.prepareCommandImpl = options.prepareCommandImpl || prepareSignalCliForGatekeeper
    this.useLaunchAgent = options.useLaunchAgent ?? process.platform === "darwin"
    this.commandPrepared = false
    this.process = null
    this.stdoutBuffer = ""
    this.nextRequestId = 1
    this.pending = new Map()
    this.linkedAccount = null
    this.accountListProcesses = new Set()
  }

  async startLink() {
    const result = await this.rpc("startLink")
    const linkUri = cleanString(result?.deviceLinkUri)
    if (!linkUri.startsWith("sgnl://linkdevice?")) {
      throw new Error("signal-cli did not return a linked-device URI.")
    }
    return { linkUri }
  }

  async finishLink(linkUri, deviceName) {
    const result = await this.rpc(
      "finishLink",
      { deviceLinkUri: linkUri, deviceName },
      120_000
    )
    this.linkedAccount = await this.getLinkedAccount()
    return { ...result, account: this.linkedAccount }
  }

  async getLinkedAccount() {
    this.prepareCommand()
    if (this.useLaunchAgent) {
      const accountsPath = join(this.dataDir, "data", "accounts.json")
      if (!existsSync(accountsPath)) return null
      const accounts = JSON.parse(readFileSync(accountsPath, "utf8") || "[]")
      return Array.isArray(accounts) ? accounts[0] || null : null
    }
    const launch = this.launchSpec([
      "--config", this.dataDir, "--output", "json", "listAccounts"
    ])
    const accounts = await new Promise((resolve, reject) => {
      let child
      child = this.execFileImpl(
        launch.command,
        launch.args,
        { maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (child) this.accountListProcesses.delete(child)
          if (error) {
            reject(
              error.code === "ENOENT"
                ? new Error("signal-cli is not installed. Install it with `brew install signal-cli`.")
                : error
            )
            return
          }
          try {
            const parsed = JSON.parse(stdout || "[]")
            resolve(Array.isArray(parsed) ? parsed : [])
          } catch {
            reject(new Error("signal-cli returned an invalid account list."))
          }
        }
      )
      if (child) this.accountListProcesses.add(child)
    })
    return Array.isArray(accounts) ? accounts[0] || null : null
  }

  async rpc(method, params, timeoutMs = 15_000) {
    await this.ensureProcess()
    const id = `signal-${this.nextRequestId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`${method} timed out waiting for signal-cli.`))
        }
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      const line = `${JSON.stringify({ jsonrpc: "2.0", method, params, id })}\n`
      if (this.process.stdin?.write) this.process.stdin.write(line)
      else this.process.write(line)
    })
  }

  async ensureProcess() {
    if (this.process && (this.process.exitCode === null || this.process.destroyed === false)) return
    this.prepareCommand()
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    if (this.useLaunchAgent) {
      installSignalLaunchAgent(this.command, this.dataDir)
      this.process = await this.connectToDaemon()
      return
    }
    await new Promise((resolve, reject) => {
      const launch = this.launchSpec([
        "--config", this.dataDir, "jsonRpc", "--receive-mode", "manual"
      ])
      const child = this.spawnImpl(
        launch.command,
        launch.args,
        { stdio: ["pipe", "pipe", "ignore"] }
      )
      let settled = false
      const fail = (error) => {
        if (!settled) {
          settled = true
          reject(
            error?.code === "ENOENT"
              ? new Error("signal-cli is not installed. Install it with `brew install signal-cli`.")
              : error
          )
        }
      }
      child.once("error", fail)
      child.once("spawn", () => {
        settled = true
        this.process = child
        child.stdout.on("data", (chunk) => this.handleStdout(chunk))
        child.on("exit", (code, signal) => this.handleExit(code, signal))
        resolve()
      })
    })
  }

  async connectToDaemon() {
    let lastError
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await new Promise((resolve, reject) => {
          const socket = createConnection({ host: "127.0.0.1", port: SIGNAL_DAEMON_PORT })
          const onError = (error) => {
            socket.destroy()
            reject(error)
          }
          socket.once("error", onError)
          socket.once("connect", () => {
            socket.off("error", onError)
            socket.on("error", () => this.handleExit(null, null))
            socket.on("data", (chunk) => this.handleStdout(chunk))
            socket.on("close", () => this.handleExit(null, null))
            resolve(socket)
          })
        })
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw lastError || new Error("Could not connect to the local Signal service.")
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString("utf8")
    while (this.stdoutBuffer.includes("\n")) {
      const newline = this.stdoutBuffer.indexOf("\n")
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const pending = this.pending.get(String(message.id))
      if (!pending) continue
      this.pending.delete(String(message.id))
      if (message.error) {
        pending.reject(new Error(cleanString(message.error.message, "signal-cli request failed.")))
      } else {
        pending.resolve(message.result)
      }
    }
  }

  prepareCommand() {
    if (this.commandPrepared) return
    this.command = this.prepareCommandImpl(this.command) || this.command
    this.commandPrepared = true
  }

  launchSpec(args) {
    if (process.platform !== "darwin") return { command: this.command, args }
    return {
      command: "/bin/launchctl",
      args: ["asuser", String(process.getuid()), this.command, ...args]
    }
  }

  handleExit(code, signal) {
    this.process = null
    const error = new Error(`signal-cli exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  dispose() {
    if (this.process?.destroyed === false) this.process.end()
    else if (this.process && this.process.exitCode === null) this.process.kill("SIGTERM")
    this.process = null
    for (const child of this.accountListProcesses) {
      if (child.exitCode === null) child.kill("SIGTERM")
    }
    this.accountListProcesses.clear()
    const error = new Error("Signal bridge stopped.")
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
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
          return this.withRequest(msg, await this.refreshStatus())
        case "signal.link.start":
          return this.withRequest(msg, await this.startLink(msg.deviceName))
        case "signal.link.finish":
          return this.withRequest(msg, await this.finishLink(msg.deviceName))
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

  dispose() {
    if (typeof this.adapter.dispose === "function") this.adapter.dispose()
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
      security: this.runtime.kind === "signal-cli"
        ? localServiceSecurityForStatus(this.homeDir)
        : securityForStatus(this.homeDir),
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
      container: this.runtime.kind === "signal-cli"
        ? {
            network: "signal-service",
            inboundPorts: "loopback-only",
            rootFilesystem: "host",
            user: "current-user",
            profileStorage: "local-user-profile",
            socket: "tcp-loopback"
          }
        : {
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

  async refreshStatus() {
    if (this.pendingLink || typeof this.adapter.getLinkedAccount !== "function") {
      return this.statusResponse()
    }
    const linkedAccount = await this.adapter.getLinkedAccount()
    if (linkedAccount) {
      this.account = {
        deviceName: this.account?.deviceName || this.profileLabel,
        identifier: cleanString(linkedAccount.number || linkedAccount.uuid),
        linkedAt: this.account?.linkedAt || now()
      }
      this.state = this.locked ? "locked" : "linked"
    } else {
      this.account = null
      this.state = "unlinked"
      this.locked = false
    }
    return this.statusResponse()
  }

  async startLink(deviceName) {
    const name = cleanString(deviceName, this.profileLabel) || this.profileLabel
    const started = typeof this.adapter.startLink === "function"
      ? await this.adapter.startLink(name)
      : null
    const uri = cleanString(started?.linkUri) ||
      `sgnl://linkdevice?uuid=${encodeURIComponent(makeId("link"))}&pub_key=fake-local-bridge`
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

  async finishLink(deviceName) {
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
    const result = typeof this.adapter.finishLink === "function"
      ? await this.adapter.finishLink(this.pendingLink.linkUri, name)
      : null
    this.account = {
      deviceName: name,
      identifier: cleanString(result?.account?.number || result?.account?.uuid),
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
