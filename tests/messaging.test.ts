import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sendToScanner, sendToTab } from "../src/utils/messaging"

describe("scanner messaging", () => {
  const originalChrome = globalThis.chrome

  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {},
      scripting: {
        executeScript: vi.fn(async () => [])
      },
      tabs: {
        sendMessage: vi.fn()
      }
    }
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
  })

  it("returns a response without injecting when the scanner is already present", async () => {
    const sendMessage = globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>
    const executeScript = globalThis.chrome.scripting.executeScript as ReturnType<typeof vi.fn>
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ ok: true, result: { url: "https://example.com" } })
    })

    const response = await sendToScanner(17, { type: "scan:run" })

    expect(response).toEqual({ ok: true, result: { url: "https://example.com" } })
    expect(executeScript).not.toHaveBeenCalled()
  })

  it("injects the scanner and retries when an existing tab has no receiver", async () => {
    const sendMessage = globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>
    const executeScript = globalThis.chrome.scripting.executeScript as ReturnType<typeof vi.fn>
    sendMessage
      .mockImplementationOnce((_tabId, _message, callback) => {
        ;(globalThis.chrome.runtime as { lastError?: unknown }).lastError = {
          message: "Could not establish connection. Receiving end does not exist."
        }
        callback(undefined)
        delete (globalThis.chrome.runtime as { lastError?: unknown }).lastError
      })
      .mockImplementationOnce((_tabId, _message, callback) => {
        callback({ ok: true, result: { url: "https://example.com" } })
      })

    const response = await sendToScanner(23, { type: "scan:run" })

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 23 },
      files: ["content/scanner.js"]
    })
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(response).toEqual({ ok: true, result: { url: "https://example.com" } })
  })

  it("returns null when a restricted page rejects scanner injection", async () => {
    const sendMessage = globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>
    const executeScript = globalThis.chrome.scripting.executeScript as ReturnType<typeof vi.fn>
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      ;(globalThis.chrome.runtime as { lastError?: unknown }).lastError = {
        message: "Receiving end does not exist."
      }
      callback(undefined)
      delete (globalThis.chrome.runtime as { lastError?: unknown }).lastError
    })
    executeScript.mockRejectedValue(new Error("Cannot access a chrome:// URL"))

    await expect(sendToScanner(9, { type: "scan:run" })).resolves.toBeNull()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("does not inject over a scanner whose response channel closed", async () => {
    const sendMessage = globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>
    const executeScript = globalThis.chrome.scripting.executeScript as ReturnType<typeof vi.fn>
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      ;(globalThis.chrome.runtime as { lastError?: unknown }).lastError = {
        message: "The message port closed before a response was received."
      }
      callback(undefined)
      delete (globalThis.chrome.runtime as { lastError?: unknown }).lastError
    })

    await expect(sendToScanner(12, { type: "scan:run" })).resolves.toBeNull()
    expect(executeScript).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("normalizes an empty callback response to null", async () => {
    const sendMessage = globalThis.chrome.tabs.sendMessage as ReturnType<typeof vi.fn>
    sendMessage.mockImplementation((_tabId, _message, callback) => callback(undefined))

    await expect(sendToTab(31, { type: "scan:run" })).resolves.toBeNull()
  })
})
