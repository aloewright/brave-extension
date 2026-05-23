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
 *   - hasPending(pred)   — peek without consuming (for ordering assertions)
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

  // Non-destructive peek: returns true if any already-received frame matches
  // predicate, without consuming it from the queue. Used by the stream test
  // to assert ordering ("exit hasn't arrived yet") without disturbing state.
  hasPending(predicate: (m: AnyMsg) => boolean): boolean {
    return this.queue.some(predicate)
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

  // ─── exec round-trip ───────────────────────────────────────────────
  // Sends a command and asserts the host collects stdout, stderr, and the
  // final exit frame for a single short-lived child process.
  it("exec: collects stdout, stderr, and the exit code from a stub child", async () => {
    // Stub child writes to both streams and exits with a non-zero code so we
    // can verify the host faithfully forwards each channel and the exit code.
    const script =
      "process.stdout.write('out-line\\n'); " +
      "process.stderr.write('err-line\\n'); " +
      "process.exit(7);"
    client = spawnHost({ cmd: process.execPath, args: ["-e", script] }, sessionStatePath)

    client.send({ type: "exec", backend: "claude", command: "hello-prompt", cwd: tmpDir })

    const started = await client.waitFor((m) => m.type === "started")
    expect(typeof started.pid).toBe("number")
    expect(started.backend).toBe("claude")

    // Scope the predicate to frames belonging to *this* child by matching
    // pid; otherwise the host's MCP server startup logs (emitted as pid-less
    // {type:"stderr"} frames from `mcp.start()` and `_registerWithClaudeJson`)
    // race in and fail the `m.pid === started.pid` assertion below.
    const pid = started.pid
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    let exitMsg: AnyMsg | null = null
    while (!exitMsg) {
      const m = await client.waitFor(
        (x) =>
          ((x.type === "stdout" || x.type === "stderr") && x.pid === pid) ||
          (x.type === "exit" && x.pid === pid)
      )
      if (m.type === "stdout") {
        stdoutChunks.push(String(m.data))
        expect(m.backend).toBe("claude")
      } else if (m.type === "stderr") {
        stderrChunks.push(String(m.data))
      } else {
        exitMsg = m
      }
    }
    expect(stdoutChunks.join("")).toContain("out-line")
    expect(stderrChunks.join("")).toContain("err-line")
    expect(exitMsg!.code).toBe(7)
    expect(exitMsg!.backend).toBe("claude")
    expect(exitMsg!.pid).toBe(started.pid)
  })

  // ─── stream round-trip ─────────────────────────────────────────────
  // Streaming is intrinsic to exec: stdout frames are emitted as data
  // arrives. The contract under test is "the host does NOT buffer until
  // exit". Two assertions enforce that:
  //   1. We observe "part-one" before "part-two" arrives in a separate
  //      frame, and
  //   2. At the moment "part-one" lands, the queue contains NO exit frame
  //      for this pid — proving the first chunk was delivered while the
  //      child was still running, not flushed all-at-once at process close.
  it("stream: observes mid-flight chunks before the child exits", async () => {
    const script =
      "process.stdout.write('part-one\\n'); " +
      "setTimeout(() => { process.stdout.write('part-two\\n'); process.exit(0); }, 50);"
    client = spawnHost({ cmd: process.execPath, args: ["-e", script] }, sessionStatePath)

    client.send({ type: "exec", backend: "gemini", command: "stream-prompt", cwd: tmpDir })

    const started = await client.waitFor((m) => m.type === "started")
    const pid = started.pid as number

    // First chunk lands while the child is still inside its setTimeout(50).
    const first = await client.waitFor(
      (m) => m.type === "stdout" && m.pid === pid && String(m.data).includes("part-one")
    )
    expect(first.backend).toBe("gemini")

    // Critical ordering check: at this exact moment the child has NOT yet
    // exited, so no `exit` frame for this pid can possibly be in the queue.
    // If the host buffered output until process close, this assertion would
    // fail (the exit frame would have been queued alongside both chunks).
    expect(client.hasPending((m) => m.type === "exit" && m.pid === pid)).toBe(false)

    const second = await client.waitFor(
      (m) => m.type === "stdout" && m.pid === pid && String(m.data).includes("part-two")
    )
    expect(second.backend).toBe("gemini")

    const exitMsg = await client.waitFor((m) => m.type === "exit" && m.pid === pid)
    expect(exitMsg.code).toBe(0)
  })

  // ─── kill round-trip ───────────────────────────────────────────────
  // Starts a long-running child, then sends "kill" and asserts the host
  // emits a "killed" frame, drops the child from its activeProcesses map,
  // and lets the process exit cleanly.
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

  // ─── session-status round-trip (cold read) ─────────────────────────
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

  // ─── session-status round-trip (state transitions) ─────────────────
  // Verifies status before, during, and after a successful exec — proving
  // the flag flips on success and can be cleared via reset-backend.
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
