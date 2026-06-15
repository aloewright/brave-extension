import { describe, expect, it } from "vitest"
import {
  FakeSignalJsonRpcAdapter,
  SignalBridgeManager,
  normalizeSignalMessage
} from "../native-host/signal-bridge.mjs"

function expectNoSecretLeak(value: unknown) {
  const json = JSON.stringify(value)
  expect(json).not.toMatch(/super-secret|token-123|private-key|profile-key|pin-999|raw-bytes/)
  expect(json).not.toMatch(/profileKey|privateKey|accessToken|pinCode|base64/)
}

describe("SignalBridgeManager", () => {
  it("reports fake-runtime status with hardened container metadata", async () => {
    const manager = new SignalBridgeManager({ homeDir: "/tmp/test-home" })

    const reply = await manager.handleMessage({ type: "signal.status", requestId: "status-1" })

    expect(reply.type).toBe("signal.status")
    expect(reply.requestId).toBe("status-1")
    expect(reply.ok).toBe(true)
    expect(reply.status.state).toBe("unlinked")
    expect(reply.status.runtime.kind).toBe("fake")
    expect(reply.status.storagePolicy.chromeStorage).toBe("ui-settings-only")
    expect(reply.status.storagePolicy.cloudSync).toBe(false)
    expect(reply.status.security.network).toBe("none")
    expect(reply.status.security.capDrop).toEqual(["ALL"])
    expect(reply.status.security.readOnlyRootFilesystem).toBe(true)
    expect(reply.status.security.tmpfs).toEqual(expect.arrayContaining(["/tmp", "/run"]))
    expect(reply.status.security.encryptedProfileVolume).toBe(true)
    expect(reply.status.security.localOnlySocket).toBe(true)
  })

  it("moves through link, linked, lock, and unlink states with request ids preserved", async () => {
    const manager = new SignalBridgeManager()

    const start = await manager.handleMessage({
      type: "signal.link.start",
      requestId: "link-start",
      deviceName: "Test Sidebar"
    })
    expect(start.requestId).toBe("link-start")
    expect(start.ok).toBe(true)
    expect(start.status.state).toBe("linking")
    expect(start.link.uri).toMatch(/^sgnl:\/\/linkdevice/)
    expect(start.link.linkUri).toMatch(/^sgnl:\/\/linkdevice/)
    expect(start.link.deviceName).toBe("Test Sidebar")
    expect(start.link.expiresAt).toEqual(expect.any(String))
    expect(Date.parse(start.link.expiresAt)).toBeGreaterThan(Date.now())

    const finish = await manager.handleMessage({
      type: "signal.link.finish",
      requestId: "link-finish"
    })
    expect(finish.requestId).toBe("link-finish")
    expect(finish.ok).toBe(true)
    expect(finish.status.state).toBe("linked")
    expect(finish.status.account.deviceName).toBe("Test Sidebar")

    const lock = await manager.handleMessage({ type: "signal.lock", requestId: "lock-1" })
    expect(lock.requestId).toBe("lock-1")
    expect(lock.ok).toBe(true)
    expect(lock.status.state).toBe("locked")
    expect(lock.status.locked).toBe(true)

    const blocked = await manager.handleMessage({
      type: "signal.messages.list",
      requestId: "blocked-1",
      conversationId: "conversation-a"
    })
    expect(blocked.requestId).toBe("blocked-1")
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe("locked")

    const unlink = await manager.handleMessage({ type: "signal.unlink", requestId: "unlink-1" })
    expect(unlink.requestId).toBe("unlink-1")
    expect(unlink.ok).toBe(true)
    expect(unlink.status.state).toBe("unlinked")
    expect(unlink.status.account).toBeNull()
  })

  it("normalizes conversations, messages, sends, and attachments without leaking secret-like fields", async () => {
    const adapter = new FakeSignalJsonRpcAdapter({
      conversations: [
        {
          conversationId: "conversation-a",
          title: "Ada",
          accessToken: "token-123",
          profileKey: "profile-key",
          participants: [{ number: "+15550100", profileKey: "profile-key", name: "Ada" }],
          lastMessage: {
            conversationId: "conversation-a",
            sourceNumber: "+15550100",
            body: "hello",
            timestamp: 1_700_000_000_000,
            privateKey: "private-key"
          }
        }
      ],
      messages: {
        "conversation-a": [
          {
            id: "message-a",
            sourceNumber: "+15550100",
            sourceName: "Ada",
            conversationId: "conversation-a",
            dataMessage: {
              message: "hi from signal",
              attachments: [
                {
                  id: "attachment-a",
                  contentType: "image/png",
                  size: 42,
                  fileName: "photo.png",
                  base64: "raw-bytes",
                  privateKey: "private-key"
                }
              ]
            },
            accessToken: "token-123",
            pinCode: "pin-999",
            timestamp: 1_700_000_000_000
          }
        ]
      }
    })
    const manager = new SignalBridgeManager({ adapter })

    await manager.handleMessage({ type: "signal.link.start", requestId: "start" })
    await manager.handleMessage({ type: "signal.link.finish", requestId: "finish" })

    const conversations = await manager.handleMessage({
      type: "signal.conversations.list",
      requestId: "conversations"
    })
    expect(conversations.ok).toBe(true)
    expect(conversations.conversations).toHaveLength(1)
    expect(conversations.conversations[0]).toMatchObject({
      id: "conversation-a",
      title: "Ada",
      unreadCount: 0
    })
    expectNoSecretLeak(conversations)

    const messages = await manager.handleMessage({
      type: "signal.messages.list",
      requestId: "messages",
      conversationId: "conversation-a"
    })
    expect(messages.ok).toBe(true)
    expect(messages.messages[0]).toMatchObject({
      id: "message-a",
      conversationId: "conversation-a",
      body: "hi from signal",
      attachments: [
        {
          id: "attachment-a",
          fileName: "photo.png",
          contentType: "image/png",
          size: 42,
          status: "metadata-only"
        }
      ]
    })
    expectNoSecretLeak(messages)

    const attachment = await manager.handleMessage({
      type: "signal.attachments.get",
      requestId: "attachment",
      attachmentId: "attachment-a"
    })
    expect(attachment.ok).toBe(true)
    expect(attachment.attachment.available).toBe(false)
    expect(attachment.attachment.reason).toContain("metadata only")
    expectNoSecretLeak(attachment)

    const sent = await manager.handleMessage({
      type: "signal.message.send",
      requestId: "send",
      conversationId: "conversation-a",
      body: "outbound hello",
      attachments: [{ id: "attachment-local", privateKey: "private-key", base64: "raw-bytes" }]
    })
    expect(sent.ok).toBe(true)
    expect(sent.requestId).toBe("send")
    expect(sent.message.direction).toBe("outgoing")
    expect(sent.message.body).toBe("outbound hello")
    expectNoSecretLeak(sent)
  })

  it("normalizes received adapter envelopes before emitting native events", () => {
    const events: unknown[] = []
    const manager = new SignalBridgeManager({ eventSink: (event) => events.push(event) })

    const event = manager.handleAdapterEnvelope({
      envelopeId: "event-a",
      sourceNumber: "+15550123",
      sourceName: "Grace",
      dataMessage: {
        message: "received body",
        profileKey: "profile-key",
        attachments: [{ id: "att-event", contentType: "text/plain", base64: "raw-bytes" }]
      },
      timestamp: 1_700_000_001_000,
      privateKey: "private-key"
    })

    expect(events).toEqual([event])
    expect(event).toMatchObject({
      type: "signal.message.received",
      ok: true,
      message: {
        id: "event-a",
        body: "received body",
        sender: { name: "Grace", phoneNumber: "+15550123" },
        attachments: [{ id: "att-event", contentType: "text/plain", status: "metadata-only" }]
      }
    })
    expectNoSecretLeak(event)
  })

  it("tolerates null adapter rows by falling back to local bridge state", async () => {
    const adapter = {
      async listConversations() {
        return null
      },
      async listMessages() {
        return null
      },
      async sendMessage(conversationId, body) {
        return { conversationId, body, direction: "outgoing" }
      },
      async getAttachment() {
        return { available: false }
      }
    }
    const manager = new SignalBridgeManager({ adapter })

    await manager.handleMessage({ type: "signal.link.start", requestId: "start" })
    await manager.handleMessage({ type: "signal.link.finish", requestId: "finish" })

    const conversations = await manager.handleMessage({
      type: "signal.conversations.list",
      requestId: "conversations"
    })
    expect(conversations).toMatchObject({
      type: "signal.conversations.list",
      ok: true,
      conversations: []
    })

    const messages = await manager.handleMessage({
      type: "signal.messages.list",
      requestId: "messages",
      conversationId: "conversation-a"
    })
    expect(messages).toMatchObject({
      type: "signal.messages.list",
      ok: true,
      conversationId: "conversation-a",
      messages: []
    })
  })

  it("keeps the standalone message normalizer defensive against raw JSON-RPC fields", () => {
    const message = normalizeSignalMessage({
      id: "raw-a",
      conversationId: "conversation-a",
      body: "plain text is allowed\nwith tabs\tand returns\r\nintact",
      accessToken: "token-123",
      profileKey: "profile-key",
      privateKey: "private-key"
    }, null)

    expect(message.body).toBe("plain text is allowed\nwith tabs\tand returns\r\nintact")
    expectNoSecretLeak(message)
  })
})
