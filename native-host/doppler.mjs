import { spawn } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"

const DEFAULT_API_HOST = "https://api.doppler.com"
const DEFAULT_TIMEOUT_MS = 30_000
const LOGIN_TIMEOUT_MS = 5 * 60_000
const OUTPUT_CAP_BYTES = 256 * 1024

export function dopplerDefaultsPath(home = homedir()) {
  return join(home, ".config", "ai-dev-sidebar", "doppler.json")
}

function redact(value) {
  return String(value ?? "").replace(/\bdp\.[A-Za-z0-9._-]+\b/g, "dp.[redacted]")
}

function previewToken(token) {
  if (!token) return null
  return token.length <= 12 ? "set" : `${token.slice(0, 5)}...${token.slice(-4)}`
}

function normalizeDefaults(input = {}) {
  return {
    project: typeof input.project === "string" ? input.project.trim() : "",
    config: typeof input.config === "string" ? input.config.trim() : ""
  }
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function responseHeader(res, name) {
  if (!res?.headers) return ""
  if (typeof res.headers.get === "function") return res.headers.get(name) || ""
  return res.headers[name.toLowerCase()] || res.headers[name] || ""
}

export class DopplerClient {
  constructor({ runCommand, fetchImpl, logger, home } = {}) {
    this.runCommand = runCommand || runCommandDefault
    this.fetch = fetchImpl || globalThis.fetch
    this.log = logger || (() => {})
    this.home = home || homedir()
    this.defaults = this._loadDefaults()
  }

  _loadDefaults() {
    const path = dopplerDefaultsPath(this.home)
    if (!existsSync(path)) return normalizeDefaults()
    try {
      return normalizeDefaults(JSON.parse(readFileSync(path, "utf-8")))
    } catch {
      return normalizeDefaults()
    }
  }

  setDefaults(input = {}) {
    const next = normalizeDefaults({ ...this.defaults, ...input })
    const path = dopplerDefaultsPath(this.home)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 })
    try { chmodSync(path, 0o600) } catch {}
    this.defaults = next
    return next
  }

  getDefaults() {
    return { ...this.defaults }
  }

  async status() {
    const status = {
      cliAvailable: false,
      cliVersion: null,
      tokenSet: false,
      tokenSource: "none",
      tokenPreview: null,
      workplaceName: null,
      workplaceSlug: null,
      authType: null,
      tokenName: null,
      defaults: this.getDefaults(),
      lastCheckedAt: new Date().toISOString(),
      error: null
    }

    try {
      const version = await this._runDoppler(["--version"], { timeoutMs: 10_000 })
      status.cliAvailable = version.code === 0
      status.cliVersion = (version.stdout || version.stderr).trim() || null
    } catch (err) {
      status.error = `Doppler CLI unavailable: ${redact(err.message)}`
    }

    let token
    try {
      const resolved = await this._getToken()
      token = resolved.token
      status.tokenSet = true
      status.tokenSource = resolved.source
      status.tokenPreview = resolved.preview
    } catch (err) {
      status.error = status.error || redact(err.message)
      return status
    }

    try {
      const me = await this._apiJson("/v3/me", { token })
      status.workplaceName = me?.workplace?.name || null
      status.workplaceSlug = me?.workplace?.slug || null
      status.authType = me?.type || null
      status.tokenName = me?.name || null
      status.tokenPreview = me?.token_preview || status.tokenPreview
      status.error = null
    } catch (err) {
      status.error = redact(err.message)
    }

    return status
  }

  async login({ scope = "/", overwrite = true } = {}) {
    const args = ["login", "--yes", "--no-check-version", "--scope", scope || "/"]
    if (overwrite) args.push("--overwrite")

    const result = await this._runDoppler(args, { timeoutMs: LOGIN_TIMEOUT_MS })
    if (result.code !== 0) {
      throw new Error(redact(result.stderr || result.stdout || `doppler login exited ${result.code}`))
    }
    return {
      ok: true,
      stdout: redact(result.stdout).slice(-4000),
      stderr: redact(result.stderr).slice(-4000)
    }
  }

  async downloadSecrets(args = {}) {
    const { token } = await this._getToken()
    const project = stringOrDefault(args.project, this.defaults.project)
    const config = stringOrDefault(args.config, this.defaults.config)
    const names = normalizeSecretNames(args.secrets)
    const url = this._apiUrl("/v3/configs/config/secrets/download")

    if (project) url.searchParams.set("project", project)
    if (config) url.searchParams.set("config", config)
    url.searchParams.set("format", "json")
    if (names.length > 0) url.searchParams.set("secrets", names.join(","))
    if (args.includeDynamicSecrets === true) {
      url.searchParams.set("include_dynamic_secrets", "true")
      if (Number.isFinite(Number(args.dynamicSecretsTtlSec))) {
        url.searchParams.set("dynamic_secrets_ttl_sec", String(Number(args.dynamicSecretsTtlSec)))
      }
    }

    return this._apiJson(url, { token })
  }

  async getSecret(args = {}) {
    const name = typeof args.name === "string" ? args.name.trim() : ""
    if (!name) throw new Error("name required")
    const secrets = await this.downloadSecrets({ ...args, secrets: [name] })
    if (!secrets || typeof secrets !== "object" || !(name in secrets)) {
      throw new Error(`secret ${name} not found`)
    }
    return { name, value: secrets[name] }
  }

  async _getToken() {
    const envToken = process.env.DOPPLER_TOKEN?.trim()
    if (envToken) {
      return { token: envToken, source: "env", preview: previewToken(envToken) }
    }

    const result = await this._runDoppler(["configure", "get", "token", "--plain"], {
      timeoutMs: 10_000
    })
    const token = result.stdout.trim()
    if (result.code !== 0 || !token) {
      throw new Error(redact(result.stderr || "Doppler is not logged in. Run `doppler login` or use Settings."))
    }
    return { token, source: "cli", preview: previewToken(token) }
  }

  _apiUrl(path) {
    const base = process.env.DOPPLER_API_HOST || DEFAULT_API_HOST
    return new URL(path, base)
  }

  async _apiJson(pathOrUrl, { token }) {
    if (typeof this.fetch !== "function") {
      throw new Error("fetch is unavailable in this native host runtime")
    }
    const url = typeof pathOrUrl === "string" ? this._apiUrl(pathOrUrl) : pathOrUrl
    const res = await this.fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json"
      }
    })
    const text = await res.text()
    const body = parseJsonSafe(text)
    if (!res.ok) {
      const message =
        body?.messages?.join(", ") ||
        body?.message ||
        text ||
        `Doppler API request failed (${res.status})`
      throw new Error(redact(message))
    }
    if (body !== null) return body
    const contentType = responseHeader(res, "content-type")
    if (contentType.includes("application/json")) return {}
    return text
  }

  async _runDoppler(args, opts = {}) {
    return this.runCommand(process.env.AI_DEV_SIDEBAR_DOPPLER_BIN || "doppler", args, opts)
  }
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function normalizeSecretNames(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof value === "string") {
    return value.split(",").map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function runCommandDefault(command, args = [], { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill("SIGTERM") } catch {}
      reject(new Error(`${command} ${args.join(" ")} timed out`))
    }, timeoutMs)

    const append = (cur, chunk) => {
      const next = Buffer.concat([cur, chunk])
      return next.length <= OUTPUT_CAP_BYTES ? next : next.slice(next.length - OUTPUT_CAP_BYTES)
    }

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk) })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: code ?? 0,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8")
      })
    })
  })
}
