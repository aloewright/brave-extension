import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// __dirname is not defined under Vitest's ESM loader, so derive it manually.
const __dirname = dirname(fileURLToPath(import.meta.url))
const HOST_PATH = resolve(__dirname, "..", "native-host", "ai-dev-host.mjs")

/**
 * Tiny client for Chrome's native messaging framing (4-byte LE length prefix
 * followed by JSON). Wraps a spawned host child so each test can:
 *
 *   - send(msg)          — write a framed JSON request
 *   - waitFor(predicate) — await the next response matching predicate
 *   - close()            — close stdin and wait for exit
 *
 * The decoder is robust to chunk boundaries: a single Node "data" event can
 * deliver partial frames or several frames at once, and we accumulate into a
 * persistent Buffer until each length-prefixed body is complete.
 */
type AnyMsg = Record<string, unknown>

class HostClient {
  child: ChildProcessWithoutNullStreams
  // Buffer.concat returns Buffer<ArrayBufferLike> in @types/node v22, while
  // Buffer.alloc(0) is Buffer<ArrayBuffer>. Annotate the field as the wider
  // Buffer type so reassignment from concat() type-checks cleanly (PDX-124).
  private buf: Buffer = Buffer.alloc(0)
  private queue: AnyMsg[] = []
  private waiters: Array<{ predicate: (m: AnyMsg) => boolean; resolve: (m: AnyMsg) => void }> = []
  stderr = ""

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString()
    })
  }

  private onData(chunk: Buffer) {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0)
      if (this.buf.length < 4 + len) break
      const body = this.buf.slice(4, 4 + len).toString("utf8")
      this.buf = this.buf.slice(4 + len)
      let parsed: AnyMsg
      try {
        parsed = JSON.parse(body) as AnyMsg
      } catch {
        continue
      }
      const idx = this.waiters.findIndex((w) => w.predicate(parsed))
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1)
        w.resolve(parsed)
      } else {
        this.queue.push(parsed)
      }
    }
  }

  send(msg: AnyMsg) {
    const json = JSON.stringify(msg)
    const header = Buffer.alloc(4)
    header.writeUInt32LE(Buffer.byteLength(json, "utf8"), 0)
    this.child.stdin.write(header)
    this.child.stdin.write(json)
  }

  waitFor(predicate: (m: AnyMsg) => boolean, timeoutMs = 5000): Promise<AnyMsg> {
    const idx = this.queue.findIndex(predicate)
    if (idx >= 0) {
      const [m] = this.queue.splice(idx, 1)
      return Promise.resolve(m)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.predicate === predicate)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(
          new Error(
            `Timeout waiting for native-host response after ${timeoutMs}ms. stderr: ${this.stderr}`
          )
        )
      }, timeoutMs)
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        }
      })
    })
  }

  close(): Promise<number | null> {
    return new Promise((resolve) => {
      this.child.once("close", (code) => resolve(code))
      try {
        this.child.stdin.end()
      } catch {
        // ignore
      }
      // Hard fallback: if the host is wedged on something (it shouldn't be),
      // don't hang the test runner.
      setTimeout(() => {
        if (!this.child.killed) this.child.kill("SIGKILL")
      }, 2000).unref()
    })
  }
}

function spawnHost(execOverride: { cmd: string; args: string[] }, sessionStatePath: string) {
  const child = spawn(process.execPath, [HOST_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      AI_DEV_SIDEBAR_EXEC_OVERRIDE: JSON.stringify(execOverride),
      AI_DEV_SIDEBAR_SESSION_STATE_PATH: sessionStatePath
    }
  })
  return new HostClient(child)
}

describe("native-host integration (PDX-88)", () => {
  let tmpDir: string
  let sessionStatePath: string
  let client: HostClient | null = null

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-dev-host-"))
    sessionStatePath = join(tmpDir, "session-state.json")
    client = null
  })

  afterEach(async () => {
    if (client) {
      await client.close()
      client = null
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("exec: streams stdout chunks and emits started + exit frames", async () => {
    // Stub child: print two distinct chunks (with a flush gap), then exit 0.
    // The host appends the prompt as the final argv — we just ignore it here.
    const script =
      "process.stdout.write('part-one\\n'); " +
      "setTimeout(() => { process.stdout.write('part-two\\n'); process.exit(0); }, 25);"
    client = spawnHost({ cmd: process.execPath, args: ["-e", script] }, sessionStatePath)

    client.send({ type: "exec", backend: "claude", command: "hello-prompt", cwd: tmpDir })

    const started = await client.waitFor((m) => m.type === "started")
    expect(typeof started.pid).toBe("number")
    expect(started.backend).toBe("claude")

    // Collect stdout frames until the process exits. We don't assert on the
    // chunk count (Node may coalesce writes) — we assert the concatenated
    // payload contains both halves, proving streaming works end to end.
    const chunks: string[] = []
    let exitMsg: AnyMsg | null = null
    while (!exitMsg) {
      const m = await client.waitFor((x) => x.type === "stdout" || x.type === "exit")
      if (m.type === "stdout") {
        chunks.push(String(m.data))
        expect(m.pid).toBe(started.pid)
        expect(m.backend).toBe("claude")
      } else {
        exitMsg = m
      }
    }
    const joined = chunks.join("")
    expect(joined).toContain("part-one")
    expect(joined).toContain("part-two")
    expect(exitMsg!.code).toBe(0)
    expect(exitMsg!.backend).toBe("claude")
    expect(exitMsg!.pid).toBe(started.pid)
  })

  it("kill: terminates a long-running child and emits a killed frame", async () => {
    // Stub child: sleep effectively forever so we can reliably kill it.
    const script =
      "process.stdout.write('alive\\n'); setInterval(() => {}, 1000);"
    client = spawnHost({ cmd: process.execPath, args: ["-e", script] }, sessionStatePath)

    client.send({ type: "exec", backend: "gemini", command: "long-running", cwd: tmpDir })
    const started = await client.waitFor((m) => m.type === "started")
    const pid = started.pid as number
    // Wait for at least one stdout chunk so we know the child is up.
    await client.waitFor((m) => m.type === "stdout" && m.pid === pid)

    client.send({ type: "kill", pid })
    const killed = await client.waitFor((m) => m.type === "killed" && m.pid === pid)
    expect(killed.pid).toBe(pid)

    // The OS will deliver SIGTERM; the child closes shortly after. The host
    // also emits an "exit" frame as the process winds down — wait for it so
    // we don't leak a pending child between tests.
    await client.waitFor((m) => m.type === "exit" && m.pid === pid)
  })

  it("session-status: returns the persisted hasSession map as JSON", async () => {
    // Pre-seed a session-state file on disk; the host reads it at startup.
    const seeded = { claude: true, gemini: false, codex: true, copilot: false }
    const { writeFileSync, mkdirSync } = await import("node:fs")
    mkdirSync(dirname(sessionStatePath), { recursive: true })
    writeFileSync(sessionStatePath, JSON.stringify(seeded))

    client = spawnHost({ cmd: process.execPath, args: ["-e", "process.exit(0)"] }, sessionStatePath)
    client.send({ type: "session-status" })
    const reply = await client.waitFor((m) => m.type === "session-status")
    expect(typeof reply.data).toBe("string")
    const parsed = JSON.parse(String(reply.data))
    expect(parsed).toMatchObject(seeded)
  })

  it("session-status: reflects flag flip after a successful exec, then resets", async () => {
    // Successful exec with stdout output flips hasSession[backend] = true.
    const script = "process.stdout.write('ok\\n'); process.exit(0);"
    client = spawnHost({ cmd: process.execPath, args: ["-e", script] }, sessionStatePath)

    // Baseline: nothing persisted yet, all flags false.
    client.send({ type: "session-status" })
    const before = await client.waitFor((m) => m.type === "session-status")
    expect(JSON.parse(String(before.data))).toMatchObject({
      claude: false,
      gemini: false,
      codex: false,
      copilot: false
    })

    // Run a successful exec on the codex backend.
    client.send({ type: "exec", backend: "codex", command: "noop", cwd: tmpDir })
    const started = await client.waitFor((m) => m.type === "started")
    await client.waitFor((m) => m.type === "exit" && m.pid === started.pid)

    client.send({ type: "session-status" })
    const after = await client.waitFor((m) => m.type === "session-status")
    expect(JSON.parse(String(after.data)).codex).toBe(true)

    // reset-backend clears the flag.
    client.send({ type: "reset-backend", backend: "codex" })
    await client.waitFor((m) => m.type === "session-reset" && m.backend === "codex")
    client.send({ type: "session-status" })
    const reset = await client.waitFor((m) => m.type === "session-status")
    expect(JSON.parse(String(reset.data)).codex).toBe(false)
  })
})
